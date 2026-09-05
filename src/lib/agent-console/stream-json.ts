/**
 * Claude Code stream-json renderer for the Coding Agent Console
 * (ADR-0016 S12, dashboard#1144).
 *
 * A hosted agent emits NDJSON in the Claude Code `stream-json` format. This
 * module turns one line of that stream into one or more readable terminal
 * lines with semantic ANSI color. It is a pure function with no DOM and no
 * state. The colors are 16-color SGR codes, so the xterm theme (the locked
 * acid-concrete palette) decides the actual hue.
 *
 * Lines that are not JSON pass through verbatim. Unknown JSON objects render
 * dimmed and compact, so a stray log line never hides the stream.
 */

// ---------------------------------------------------------------------------
// ANSI
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const BRIGHT_BLACK = "\x1b[90m";
/** Bright green maps to the acid accent in the terminal theme. */
const ACID = "\x1b[92m";

const EOL = "\r\n";

/** Maximum width of a one-line tool input or result summary. */
const SUMMARY_WIDTH = 160;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Facts about the run that the stream reveals as it goes. */
export interface AgentRunSummary {
  model?: string;
  sessionId?: string;
  turns?: number;
  costUsd?: number;
  durationMs?: number;
  /** Bank member facts from `member_status` lines (gibson#1706). */
  memberState?: string;
  jobsInFlight?: number;
  cap?: number;
}

/** One rendered stream line: terminal text plus any summary facts it carried. */
interface RenderedLine {
  /** Terminal text, every line terminated with CRLF. */
  text: string;
  /** Summary facts the line carried, if any. */
  summary?: AgentRunSummary;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  model?: string;
  session_id?: string;
  cwd?: string;
  tools?: unknown;
  message?: { content?: unknown; model?: string } | string;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  is_error?: boolean;
  result?: unknown;
  // Bank member lines (gibson#1706, gibson#1716). The daemon tees them into
  // the same NDJSON as the Claude Code stream-json lines.
  job_id?: string;
  goal?: string;
  kind?: string;
  sender?: string;
  state?: string;
  verdict?: string;
  score?: number;
  ref?: string;
  url?: string;
  jobs_in_flight?: number;
  cap?: number;
  claude_version?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Returns the first eight characters of an id, or the id when shorter. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Collapses text to one line and cuts it to the summary width. */
function oneLine(text: string, width = SUMMARY_WIDTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > width ? flat.slice(0, width - 1) + "…" : flat;
}

/** Terminates every line of a text block with CRLF. */
function lines(text: string): string {
  return text.split(/\r?\n/).join(EOL) + EOL;
}

/** Formats a dollar amount with two decimals, four when under a cent. */
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return "$" + usd.toFixed(4);
  return "$" + usd.toFixed(2);
}

/** Formats a duration in milliseconds as `42s` or `3m 05s`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Picks the most telling part of a tool input for a one-line summary. Known
 * tools show their main argument. Other tools show the first string value,
 * or the compact JSON.
 */
function summarizeToolInput(input: unknown): string {
  if (typeof input === "string") return oneLine(input);
  if (!isRecord(input)) return "";
  const preferred = ["command", "file_path", "path", "pattern", "query", "url", "description"];
  for (const key of preferred) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) return oneLine(v);
  }
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0) return oneLine(v);
  }
  try {
    return oneLine(JSON.stringify(input));
  } catch {
    return "";
  }
}

/** Flattens a tool_result content value (string or text blocks) to text. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : ""))
      .filter((t) => t.length > 0)
      .join("\n");
  }
  return "";
}

/** Summarizes a multi-line result as its first line plus a line count. */
function summarizeResult(text: string): string {
  const all = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (all.length === 0) return "";
  const head = oneLine(all[0]);
  return all.length > 1 ? `${head} ${DIM}(+${all.length - 1} lines)${RESET}` : head;
}

// ---------------------------------------------------------------------------
// Renderers per block and event
// ---------------------------------------------------------------------------

function renderAssistantBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return typeof block.text === "string" && block.text.length > 0
        ? lines(block.text)
        : "";
    case "thinking":
      return typeof block.thinking === "string" && block.thinking.length > 0
        ? `${BRIGHT_BLACK}∴ ${oneLine(block.thinking)}${RESET}${EOL}`
        : "";
    case "tool_use": {
      const name = typeof block.name === "string" ? block.name : "tool";
      const input = summarizeToolInput(block.input);
      return `${BOLD}${CYAN}▶ ${name}${RESET}${input ? `  ${DIM}${input}${RESET}` : ""}${EOL}`;
    }
    default:
      return "";
  }
}

function renderUserBlock(block: ContentBlock): string {
  if (block.type !== "tool_result") return "";
  const summary = summarizeResult(resultText(block.content));
  if (block.is_error) {
    return `${RED}✗ error${RESET}${summary ? `  ${RED}${summary}${RESET}` : ""}${EOL}`;
  }
  return `${GREEN}✓ ok${RESET}${summary ? `  ${DIM}${summary}${RESET}` : ""}${EOL}`;
}

function renderBlocks(
  content: unknown,
  render: (block: ContentBlock) => string,
): string {
  if (typeof content === "string") return lines(content);
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((b) => render(b as ContentBlock))
    .join("");
}

function renderSystem(ev: StreamEvent): RenderedLine {
  const parts: string[] = [];
  const summary: AgentRunSummary = {};
  if (typeof ev.session_id === "string") {
    parts.push(`session ${shortId(ev.session_id)}`);
    summary.sessionId = ev.session_id;
  }
  if (typeof ev.model === "string") {
    parts.push(ev.model);
    summary.model = ev.model;
  }
  if (typeof ev.cwd === "string") parts.push(`cwd ${ev.cwd}`);
  if (Array.isArray(ev.tools)) parts.push(`${ev.tools.length} tools`);
  const label = ev.subtype ? `system ${ev.subtype}` : "system";
  const body = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
  return {
    text: `${BRIGHT_BLACK}◌ ${label}${body}${RESET}${EOL}`,
    summary,
  };
}

function renderResult(ev: StreamEvent): RenderedLine {
  const failed = ev.is_error === true || (ev.subtype ?? "").startsWith("error");
  const summary: AgentRunSummary = {};
  const parts: string[] = [];
  if (typeof ev.num_turns === "number") {
    summary.turns = ev.num_turns;
    parts.push(`${ev.num_turns} ${ev.num_turns === 1 ? "turn" : "turns"}`);
  }
  if (typeof ev.total_cost_usd === "number") {
    summary.costUsd = ev.total_cost_usd;
    parts.push(formatCost(ev.total_cost_usd));
  }
  if (typeof ev.duration_ms === "number") {
    summary.durationMs = ev.duration_ms;
    parts.push(formatDuration(ev.duration_ms));
  }
  if (typeof ev.session_id === "string") {
    summary.sessionId = ev.session_id;
    parts.push(`session ${shortId(ev.session_id)}`);
  }
  const color = failed ? RED : ACID;
  const status = failed ? `failed${ev.subtype ? ` (${ev.subtype})` : ""}` : "done";
  const tail = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
  let text = `${BOLD}${color}── ${status}${tail} ──${RESET}${EOL}`;
  if (failed && typeof ev.result === "string" && ev.result.length > 0) {
    text += `${RED}${oneLine(ev.result)}${RESET}${EOL}`;
  }
  return { text, summary };
}

// ---------------------------------------------------------------------------
// Bank member lines (gibson#1706 lane E3)
//
//   {"type":"job_opened","job_id":"...","goal":"..."}
//   {"type":"job_input","job_id":"...","kind":"turn|answer|wrap_up","sender":"user:..."}
//   {"type":"job_state","job_id":"...","state":"working|waiting|closed","message":"..."}
//   {"type":"job_deliverable","job_id":"...","kind":"merge_request","ref":"...","url":"..."}
//   {"type":"job_closed","job_id":"...","verdict":"accomplished|failed|abandoned","score":0.9}
//   {"type":"member_status","state":"idle|busy|needs_sign_in|draining","jobs_in_flight":1,"cap":2,"claude_version":"..."}
// ---------------------------------------------------------------------------

function jobTag(ev: StreamEvent): string {
  return typeof ev.job_id === "string" && ev.job_id.length > 0 ? `job ${shortId(ev.job_id)}` : "job";
}

function renderJobEvent(ev: StreamEvent): RenderedLine {
  const tag = jobTag(ev);
  switch (ev.type) {
    case "job_opened": {
      const goal = typeof ev.goal === "string" && ev.goal.length > 0 ? ` · ${oneLine(ev.goal)}` : "";
      return { text: `${BOLD}${CYAN}◆ ${tag} opened${RESET}${DIM}${goal}${RESET}${EOL}` };
    }
    case "job_input": {
      const kind = typeof ev.kind === "string" ? ev.kind : "input";
      const from = typeof ev.sender === "string" && ev.sender.length > 0 ? ` from ${ev.sender}` : "";
      return { text: `${CYAN}→ ${tag} ${kind}${from}${RESET}${EOL}` };
    }
    case "job_state": {
      const state = typeof ev.state === "string" ? ev.state : "state";
      const msg = typeof ev.message === "string" && ev.message.length > 0 ? ` · ${oneLine(ev.message)}` : "";
      const color = state === "waiting" ? ACID : BRIGHT_BLACK;
      return { text: `${color}◇ ${tag} ${state}${msg}${RESET}${EOL}` };
    }
    case "job_deliverable": {
      const parts = [ev.kind, ev.ref, ev.url].filter((v): v is string => typeof v === "string" && v.length > 0);
      return { text: `${GREEN}⇧ ${tag} ${parts.join(" ")}${RESET}${EOL}` };
    }
    case "job_closed": {
      const verdict = typeof ev.verdict === "string" ? ev.verdict : "closed";
      const score = typeof ev.score === "number" ? ` ${ev.score.toFixed(2)}` : "";
      const color = verdict === "accomplished" ? ACID : verdict === "failed" ? RED : BRIGHT_BLACK;
      return { text: `${BOLD}${color}── ${tag} closed ${verdict}${score} ──${RESET}${EOL}` };
    }
    default:
      return { text: "" };
  }
}

function renderMemberStatus(ev: StreamEvent): RenderedLine {
  const summary: AgentRunSummary = {};
  const parts: string[] = [];
  if (typeof ev.state === "string") {
    summary.memberState = ev.state;
    parts.push(ev.state.replace(/_/g, " "));
  }
  if (typeof ev.jobs_in_flight === "number" && typeof ev.cap === "number") {
    summary.jobsInFlight = ev.jobs_in_flight;
    summary.cap = ev.cap;
    parts.push(`${ev.jobs_in_flight}/${ev.cap}`);
  }
  if (typeof ev.claude_version === "string" && ev.claude_version.length > 0) parts.push(`claude ${ev.claude_version}`);
  return { text: `${BRIGHT_BLACK}● member ${parts.join(" · ")}${RESET}${EOL}`, summary };
}

function renderUnknown(line: string, ev: StreamEvent): RenderedLine {
  const label = typeof ev.type === "string" ? ev.type : "json";
  return { text: `${BRIGHT_BLACK}${label} ${oneLine(line)}${RESET}${EOL}` };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders one raw stream line. A line that does not parse as a JSON object
 * passes through verbatim with a CRLF. A JSON object renders by its `type`.
 */
export function renderAgentLine(line: string): RenderedLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return { text: line + EOL };
  let ev: unknown;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return { text: line + EOL };
  }
  if (!isRecord(ev)) return { text: line + EOL };
  const event = ev as StreamEvent;
  switch (event.type) {
    case "assistant": {
      const summary: AgentRunSummary = {};
      const message = isRecord(event.message) ? event.message : undefined;
      if (typeof message?.model === "string") summary.model = message.model;
      return {
        text: renderBlocks(message?.content, renderAssistantBlock),
        summary,
      };
    }
    case "user": {
      const message = isRecord(event.message) ? event.message : undefined;
      return { text: renderBlocks(message?.content, renderUserBlock) };
    }
    case "system":
      return renderSystem(event);
    case "result":
      return renderResult(event);
    case "job_opened":
    case "job_input":
    case "job_state":
    case "job_deliverable":
    case "job_closed":
      return renderJobEvent(event);
    case "member_status":
      return renderMemberStatus(event);
    default:
      return renderUnknown(trimmed, event);
  }
}

/** Merges the facts a rendered line carried into a running summary. */
export function mergeSummary(
  base: AgentRunSummary,
  next: AgentRunSummary | undefined,
): AgentRunSummary {
  if (!next) return base;
  let changed = false;
  const out: AgentRunSummary = { ...base };
  for (const key of Object.keys(next) as (keyof AgentRunSummary)[]) {
    const v = next[key];
    if (v !== undefined && v !== base[key]) {
      (out as Record<string, unknown>)[key] = v;
      changed = true;
    }
  }
  return changed ? out : base;
}
