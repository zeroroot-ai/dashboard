"use client";

import * as React from "react";
import { Pause, Play, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/gibson/shared";
import { useEventStream } from "@/src/hooks/useEventStream";
import { useUIStore } from "@/src/stores/ui-store";
import type { Event, EventType } from "@/src/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterType = "all" | EventType;

// ── Badge / indicator config ──────────────────────────────────────────────────

const EVENT_TYPE_BADGE_CLASS: Record<EventType, string> = {
  mission: "border-green-500/60 bg-green-950/50 text-green-400",
  agent:   "border-violet-500/60 bg-violet-950/50 text-violet-400",
  tool:    "border-cyan-500/60 bg-cyan-950/50 text-cyan-400",
  finding: "border-red-500/60 bg-red-950/50 text-red-400",
  llm:     "border-indigo-500/60 bg-indigo-950/50 text-indigo-400",
  system:  "border-zinc-500/50 bg-zinc-800/50 text-zinc-400",
};

const EVENT_TYPE_INDICATOR_CLASS: Record<EventType, string> = {
  mission: "bg-green-500/70",
  agent:   "bg-violet-500/70",
  tool:    "bg-cyan-500/70",
  finding: "bg-red-500/70",
  llm:     "bg-indigo-500/70",
  system:  "bg-zinc-500/50",
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  mission: "Mission",
  agent:   "Agent",
  tool:    "Tool",
  finding: "Finding",
  llm:     "LLM",
  system:  "System",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a Date as HH:MM:SS.mmm for the event timestamp column.
 */
function formatTimestamp(date: Date): string {
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Extract a human-readable description from an event's payload.
 * Tries common keys before falling back to the event type label.
 */
function extractDescription(event: Event): string {
  const p = event.payload;
  if (typeof p.message === "string" && p.message) return p.message;
  if (typeof p.description === "string" && p.description) return p.description;
  if (typeof p.text === "string" && p.text) return p.text;
  if (typeof p.summary === "string" && p.summary) return p.summary;
  return `${EVENT_TYPE_LABELS[event.type]} event from ${event.source}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EventTypeBadge({ type }: { type: EventType }) {
  return (
    <Badge
      className={`border font-mono text-xs uppercase tracking-wide shrink-0 ${EVENT_TYPE_BADGE_CLASS[type]}`}
    >
      {EVENT_TYPE_LABELS[type]}
    </Badge>
  );
}

interface LiveIndicatorProps {
  paused: boolean;
  isConnecting: boolean;
}

function LiveIndicator({ paused, isConnecting }: LiveIndicatorProps) {
  if (isConnecting) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-2.5" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
        </span>
        <span className="text-xs font-mono font-medium text-amber-400">
          CONNECTING...
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`relative flex size-2.5 ${paused ? "opacity-40" : ""}`}
        aria-hidden="true"
      >
        {!paused && (
          <span
            className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75"
            style={{ animationDuration: "1.4s" }}
          />
        )}
        <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
      </span>
      <span
        className={`text-xs font-mono font-medium ${paused ? "text-zinc-500" : "text-green-400"}`}
      >
        {paused ? "PAUSED" : "LIVE"}
      </span>
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const description = extractDescription(event);
  const timestamp = formatTimestamp(event.timestamp);

  return (
    <div className="group relative flex items-start gap-4 py-3 px-4 hover:bg-green-950/10 transition-colors border-b border-green-900/15 last:border-b-0">
      {/* Timeline indicator */}
      <div className="relative flex flex-col items-center shrink-0 pt-0.5">
        <div
          className={`size-2 rounded-full mt-1 ${EVENT_TYPE_INDICATOR_CLASS[event.type]}`}
          aria-hidden="true"
        />
      </div>

      {/* Timestamp */}
      <time
        className="data-value shrink-0 text-xs tabular-nums pt-0.5 min-w-[80px]"
        dateTime={new Date(event.timestamp).toISOString()}
      >
        {timestamp}
      </time>

      {/* Type badge */}
      <div className="shrink-0 pt-0.5">
        <EventTypeBadge type={event.type} />
      </div>

      {/* Description + source */}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <p className="text-sm text-foreground/90 leading-snug">{description}</p>
        <span className="text-xs text-muted-foreground font-mono">
          {event.source}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ALL_EVENT_TYPES: EventType[] = [
  "mission",
  "agent",
  "tool",
  "finding",
  "llm",
  "system",
];

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: "all", label: "All Events" },
  ...ALL_EVENT_TYPES.map((t) => ({ value: t as FilterType, label: EVENT_TYPE_LABELS[t] })),
];

export function EventsContent() {
  const [filter, setFilter] = React.useState<FilterType>("all");

  // Wire event stream — connects SSE and populates the store's eventBuffer
  const { isConnecting, isConnected, error, reconnect } = useEventStream();

  // Read pause state and event buffer from the shared UI store
  const eventBuffer = useUIStore((state) => state.eventBuffer);
  const paused = useUIStore((state) => state.eventsPaused);
  const setEventsPaused = useUIStore((state) => state.setEventsPaused);

  // Snapshot the buffer at the moment the user hit pause so new events
  // don't scroll in while paused.
  const pauseSnapshotRef = React.useRef<Event[]>([]);
  const prevPausedRef = React.useRef(paused);

  React.useEffect(() => {
    // Capture snapshot when transitioning from live → paused
    if (paused && !prevPausedRef.current) {
      pauseSnapshotRef.current = eventBuffer;
    }
    prevPausedRef.current = paused;
  }, [paused, eventBuffer]);

  // When paused, show the snapshot; when live, show the live buffer
  const displayBuffer = paused ? pauseSnapshotRef.current : eventBuffer;

  const visibleEvents = React.useMemo(() => {
    if (filter === "all") return displayBuffer;
    return displayBuffer.filter((e) => e.type === filter);
  }, [displayBuffer, filter]);

  const isDisconnected = !isConnecting && !isConnected;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
            Event Stream
          </h1>
          <LiveIndicator paused={paused} isConnecting={isConnecting} />
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-reconnect indicator — only show when disconnected and not already
              actively reconnecting */}
          {isDisconnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={reconnect}
              className="gap-1.5 font-mono text-xs border-amber-500/40 text-amber-400 hover:bg-amber-950/30"
              aria-label="Reconnect to event stream"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reconnect
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setEventsPaused(!paused)}
            className="gap-1.5 font-mono text-xs"
            aria-pressed={paused}
            disabled={isConnecting}
          >
            {paused ? (
              <>
                <Play className="size-3.5" aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <Pause className="size-3.5" aria-hidden="true" />
                Pause
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Connection error ── */}
      {error && (
        <ErrorAlert
          error={error}
          title="Event stream disconnected"
          retry={reconnect}
        />
      )}

      {/* ── Filter bar ── */}
      <div className="glass-hack rounded-lg p-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider shrink-0">
          Filter:
        </span>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger
            size="sm"
            className="w-[160px] font-mono text-xs border-green-900/40 bg-transparent"
            aria-label="Filter by event type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="font-mono text-xs"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          <span className="text-green-400 font-medium">{visibleEvents.length}</span>
          {" "}event{visibleEvents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Event list ── */}
      <div className="glass-hack rounded-lg overflow-hidden">
        {/* Column headers */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-green-900/20 bg-green-950/10">
          <div className="size-2 shrink-0" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground min-w-[80px]">
            Time
          </span>
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground shrink-0 w-[72px]">
            Type
          </span>
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Description
          </span>
        </div>

        {/* Rows */}
        <div
          role="log"
          aria-live={paused ? "off" : "polite"}
          aria-label="Event stream"
        >
          {isConnecting && visibleEvents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground font-mono">
              Connecting to event stream...
            </div>
          ) : visibleEvents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {filter === "all"
                ? "No events received yet."
                : "No events match the current filter."}
            </div>
          ) : (
            visibleEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
