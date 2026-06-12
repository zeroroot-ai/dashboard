/**
 * System Prompt Builder
 *
 * Constructs dynamic system prompts for the Gibson chatbot with
 * agent personas and layered knowledge-graph, Langfuse, Redis, and
 * platform-inventory context.
 */

import type { GraphContextData } from '@/src/lib/graph/context';
import type { UserActivityContext } from '@/src/lib/chat/user-activity-context';
import type { LangfuseUserContext } from '@/src/lib/chat/langfuse-session-context';
import type { PlatformContext } from '@/src/lib/chat/platform-context';
import { getPersona } from '@/src/lib/chat/personas';

// ============================================================================
// Common Identity
// ============================================================================

const GIBSON_IDENTITY = `You are an AI assistant within the Zero Root AI security platform. Zero Root AI is an autonomous security operations platform that manages missions, deploys agents, and maintains a knowledge graph of discovered assets, vulnerabilities, and findings.

You have access to information from the Zero Root AI knowledge graph, which contains entities such as: Missions, Hosts, Services, Ports, Domains, Subdomains, Endpoints, Technologies, Certificates, Findings, Evidence, Vulnerabilities, and Techniques. These are connected by relationships like HAS_SUBDOMAIN, RESOLVES_TO, HAS_PORT, RUNS_SERVICE, HAS_ENDPOINT, USES_TECHNOLOGY, AFFECTS, HAS_EVIDENCE, USES_TECHNIQUE, DISCOVERED, and BELONGS_TO.

When answering questions:
- Reference specific nodes and findings by name when you have the data.
- If you don't have data about something the user asks, say so clearly rather than guessing.
- Be concise and actionable in your responses.
- Use security terminology appropriate for experienced operators.`;

// ============================================================================
// Context renderers
// ============================================================================

function renderUserActivity(ctx: UserActivityContext): string | null {
  const parts: string[] = [];
  if (ctx.recentMissions.length > 0) {
    parts.push(`Recently viewed missions: ${ctx.recentMissions.map((m) => m.label).join(', ')}.`);
  }
  if (ctx.recentNodes.length > 0) {
    parts.push(`Recently inspected graph nodes: ${ctx.recentNodes.map((n) => n.label).join(', ')}.`);
  }
  if (ctx.recentFindings.length > 0) {
    parts.push(`Recently opened findings: ${ctx.recentFindings.map((f) => f.label).join(', ')}.`);
  }
  if (parts.length === 0) return null;
  return `The operator's recent platform activity:\n${parts.join('\n')}`;
}

function renderLangfuseContext(ctx: LangfuseUserContext): string | null {
  if (ctx.recentTraces.length === 0) return null;
  const lines = ctx.recentTraces.map((t) => {
    const tokens = t.totalTokens > 0 ? ` (${t.totalTokens} tokens)` : '';
    const snippet = t.outputSnippet ? `, "${t.outputSnippet}"` : '';
    return `- ${t.name} at ${t.startTime} [${t.status}]${tokens}${snippet}`;
  });
  return `Recent agent execution traces for this user:\n${lines.join('\n')}`;
}

function renderPlatformContext(ctx: PlatformContext): string | null {
  const parts: string[] = [];
  if (ctx.agents.length > 0) {
    const agentList = ctx.agents.map((a) => `${a.name} (${a.health})`).join(', ');
    parts.push(`Deployed agents: ${agentList}.`);
  }
  if (ctx.tools.length > 0) {
    const toolList = ctx.tools.map((t) => `${t.name}${t.version ? ' v' + t.version : ''}`).join(', ');
    parts.push(`Registered tools: ${toolList}.`);
  }
  if (ctx.plugins.length > 0) {
    const pluginList = ctx.plugins.map((p) => `${p.name}${p.version ? ' v' + p.version : ''} (${p.health})`).join(', ');
    parts.push(`Installed plugins: ${pluginList}.`);
  }
  if (parts.length === 0) return null;
  return `Platform inventory for this tenant:\n${parts.join('\n')}`;
}

// ============================================================================
// Prompt Builder
// ============================================================================

export interface BuildSystemPromptOpts {
  agentId: string;
  graphContext?: GraphContextData;
  graphSummary?: string;
  userActivityContext?: UserActivityContext;
  langfuseContext?: LangfuseUserContext;
  platformContext?: PlatformContext;
  /** The focused node ID if a graph context is active. When set, the model is
   *  instructed to emit a citation marker when it uses data from this node. */
  nodeId?: string;
}

/**
 * Build a layered system prompt for the given persona and optional context.
 *
 * Layer order:
 *   1. Platform identity
 *   2. Persona prompt
 *   3. Tenant graph summary
 *   4. Langfuse recent agent traces
 *   5. Redis user activity
 *   6. Platform inventory (agents / tools / plugins)
 *   7. Focused knowledge-graph node
 */
export function buildSystemPrompt(opts: BuildSystemPromptOpts): string {
  const { agentId, graphContext, graphSummary, userActivityContext, langfuseContext, platformContext, nodeId } = opts;

  const parts: string[] = [];

  // 1. Common identity
  parts.push(GIBSON_IDENTITY);

  // 2. Persona
  parts.push(getPersona(agentId).systemPrompt);

  // 3. Tenant-level graph summary
  if (graphSummary) {
    parts.push(
      `Here is an overview of the operator's knowledge graph data. Use this to answer questions about their security posture, assets, findings, and missions:\n\n${graphSummary}`,
    );
  }

  // 4. Langfuse recent agent traces
  if (langfuseContext) {
    const rendered = renderLangfuseContext(langfuseContext);
    if (rendered) parts.push(rendered);
  }

  // 5. Redis user activity
  if (userActivityContext) {
    const rendered = renderUserActivity(userActivityContext);
    if (rendered) parts.push(rendered);
  }

  // 6. Platform inventory
  if (platformContext) {
    const rendered = renderPlatformContext(platformContext);
    if (rendered) parts.push(rendered);
  }

  // 7. Focused node context
  if (graphContext?.summary) {
    let focusedNodeSection = `The operator currently has the following node selected in the knowledge graph. Use this context to inform your answers:\n\n${graphContext.summary}`;

    if (nodeId) {
      focusedNodeSection +=
        `\n\nWhen you reference specific information from this node in your answer, append a citation marker at the very end of your response in the format: [cite:node:${nodeId}]\nOnly emit a citation if you actually used data from this node. Do not emit citations when answering from general knowledge.`;
    }

    parts.push(focusedNodeSection);
  }

  return parts.join('\n\n');
}
