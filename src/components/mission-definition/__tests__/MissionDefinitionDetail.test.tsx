/**
 * MissionDefinitionDetail — component tests.
 *
 * Two fixtures:
 *   1. fullFixture — every author-facing field populated (constraints, workspace,
 *      all six oneof node-config variants, retry/data/reuse policies).
 *   2. minimalFixture — only the required fields set; verifies empty-state
 *      affordances render without error for absent optional sections.
 *
 * Collapsible sections (nodes, workspace) start closed; tests that need content
 * from within those sections use userEvent.click to expand them or use
 * getAllByText / getAllByRole variants to handle repeated text.
 *
 * M6 — mission-author-experience. Closes #187.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MissionDefinitionDetail } from "../MissionDefinitionDetail";
import type { MissionDefinitionJson } from "@/src/hooks/useMissionDefinition";

// -------------------------------------------------------------------------
// Full fixture — every author-facing field populated
// -------------------------------------------------------------------------

const fullFixture: MissionDefinitionJson = {
  id: "def-abc123",
  name: "Full Mission",
  description: "Comprehensive fixture covering all fields.",
  version: "2.0.0",
  targetRef: "production-web",
  source: "https://github.com/example/missions.git",
  installedAt: "2026-01-15T10:00:00Z",
  createdAt: "2026-01-14T08:00:00Z",
  entryPoints: ["agent-node"],
  exitPoints: ["join-node"],
  metadata: { tags: "security,web", priority: "high" },

  constraints: {
    maxDuration: "3600s",
    maxTokens: "500000",
    maxCost: 12.5,
    maxFindings: 50,
    severityThreshold: "medium",
    requireEvidence: true,
    blockedTools: ["shell-executor", "rm-rf"],
    blockedDomains: ["prod.internal.example.com"],
    maxTurnsPerAgent: 20,
    allowedTechniques: ["T1190", "T1059"],
    blockedTechniques: ["T1485"],
    maxTokensPerCall: 8192,
  },

  workspace: {
    repositories: [
      {
        name: "app-repo",
        url: "https://github.com/example/app.git",
        branch: "main",
        credentialName: "github-cred",
        shallow: true,
        dependsOn: [],
      },
    ],
    settings: {
      cleanupOnComplete: true,
      useWorktrees: true,
      lspEnabled: false,
      lspTimeout: "30s",
      baseDirectory: "/workspace",
    },
  },

  nodes: {
    "agent-node": {
      id: "agent-node",
      type: "NODE_TYPE_AGENT",
      name: "Web Crawler",
      description: "Crawls the target for endpoints.",
      dependencies: [],
      timeout: "300s",
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: "BACKOFF_STRATEGY_EXPONENTIAL",
        initialDelay: "2s",
        maxDelay: "60s",
        multiplier: 2,
      },
      dataPolicy: {
        storeInput: true,
        storeOutput: true,
        retention: "86400s",
        encryption: true,
        accessControl: ["role:analyst"],
      },
      reusePolicy: {
        outputScope: "mission",
        inputScope: "run",
        reuse: "always",
      },
      agentConfig: {
        agentName: "web-crawler",
        task: { goal: "Crawl the target website for endpoints and links." },
        maxTokensPerCall: 4096,
      },
    },
    "tool-node": {
      id: "tool-node",
      type: "NODE_TYPE_TOOL",
      name: "Git Clone",
      description: "Clones the repository.",
      dependencies: [],
      toolConfig: {
        toolName: "git-clone",
        input: { url: "https://github.com/example/repo.git", depth: "1" },
      },
    },
    "plugin-node": {
      id: "plugin-node",
      type: "NODE_TYPE_PLUGIN",
      name: "Notify Slack",
      description: "Sends a Slack notification.",
      dependencies: ["agent-node"],
      pluginConfig: {
        pluginName: "slack-notifier",
        method: "send_message",
        params: { channel: "#security", message: "Scan complete." },
      },
    },
    "condition-node": {
      id: "condition-node",
      type: "NODE_TYPE_CONDITION",
      name: "Severity Gate",
      description: "Routes based on finding severity.",
      dependencies: ["tool-node"],
      conditionConfig: {
        expression: "result.severity == 'critical'",
        trueBranch: ["plugin-node"],
        falseBranch: ["join-node"],
        language: "LANGUAGE_CEL",
      },
    },
    "parallel-node": {
      id: "parallel-node",
      type: "NODE_TYPE_PARALLEL",
      name: "Parallel Scanners",
      description: "Runs multiple scanners concurrently.",
      dependencies: ["condition-node"],
      parallelConfig: {
        subNodes: [
          { id: "sub-a", name: "Scanner A", type: "NODE_TYPE_AGENT" },
          { id: "sub-b", name: "Scanner B", type: "NODE_TYPE_AGENT" },
        ],
        maxConcurrency: 2,
      },
    },
    "join-node": {
      id: "join-node",
      type: "NODE_TYPE_JOIN",
      name: "Result Merger",
      description: "Merges results from all scanners.",
      dependencies: ["parallel-node"],
      joinConfig: {
        waitFor: ["sub-a", "sub-b"],
        strategy: "MERGE_STRATEGY_CONCAT",
        aggregator: "",
      },
    },
  },

  edges: [
    { from: "agent-node", to: "plugin-node" },
    { from: "condition-node", to: "join-node" },
  ],
};

// -------------------------------------------------------------------------
// Minimal fixture — only top-level id + name, no optional sections
// -------------------------------------------------------------------------

const minimalFixture: MissionDefinitionJson = {
  id: "def-minimal",
  name: "Minimal Mission",
};

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe("MissionDefinitionDetail — full fixture", () => {
  it("renders the detail container", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByTestId("mission-definition-detail")).toBeTruthy();
  });

  // --- Overview ---
  it("renders id, name, description, version", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("def-abc123")).toBeTruthy();
    expect(screen.getByText("Full Mission")).toBeTruthy();
    expect(screen.getByText("Comprehensive fixture covering all fields.")).toBeTruthy();
    expect(screen.getByText("2.0.0")).toBeTruthy();
  });

  it("renders targetRef and source", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("production-web")).toBeTruthy();
    expect(screen.getByText("https://github.com/example/missions.git")).toBeTruthy();
  });

  it("renders entry and exit points as badges", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    // "agent-node" appears as an entry-point badge AND as a node-card id.
    // getAllByText is correct here — we only need at least one occurrence.
    expect(screen.getAllByText("agent-node").length).toBeGreaterThan(0);
    expect(screen.getAllByText("join-node").length).toBeGreaterThan(0);
  });

  // --- Constraints (all 12 ADR 0004 fields) ---
  it("renders max_duration formatted", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("1h")).toBeTruthy();
  });

  it("renders max_tokens", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("500,000")).toBeTruthy();
  });

  it("renders max_cost in USD", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("$12.5000")).toBeTruthy();
  });

  it("renders max_findings", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("50")).toBeTruthy();
  });

  it("renders severity_threshold", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("medium")).toBeTruthy();
  });

  it("renders require_evidence", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    // "Yes" for requireEvidence: true
    const yesNodes = screen.getAllByText("Yes");
    expect(yesNodes.length).toBeGreaterThan(0);
  });

  it("renders blocked_tools as badges", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("shell-executor")).toBeTruthy();
    expect(screen.getByText("rm-rf")).toBeTruthy();
  });

  it("renders blocked_domains", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("prod.internal.example.com")).toBeTruthy();
  });

  it("renders allowed_techniques", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("T1190")).toBeTruthy();
    expect(screen.getByText("T1059")).toBeTruthy();
  });

  it("renders blocked_techniques", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("T1485")).toBeTruthy();
  });

  it("renders max_tokens_per_call", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    // 8,192 appears as "8,192" in the constraints section
    const nodes = screen.getAllByText("8,192");
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("renders max_turns_per_agent", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("20")).toBeTruthy();
  });

  // --- Workspace ---
  it("renders workspace repository fields after expanding workspace section", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    // Expand the Workspace collapsible (starts closed).
    const workspaceToggle = screen.getByRole("button", { name: "Workspace section toggle" });
    await user.click(workspaceToggle);
    expect(screen.getByText("app-repo")).toBeTruthy();
    expect(screen.getByText("https://github.com/example/app.git")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("github-cred")).toBeTruthy();
  });

  it("renders workspace settings after expanding workspace section", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const workspaceToggle = screen.getByRole("button", { name: "Workspace section toggle" });
    await user.click(workspaceToggle);
    expect(screen.getByText("/workspace")).toBeTruthy();
  });

  // --- Nodes ---
  it("renders nodes section with count", () => {
    render(<MissionDefinitionDetail definition={fullFixture} />);
    expect(screen.getByText("Nodes (6)")).toBeTruthy();
  });

  it("renders agent node config after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    // Expand the "Web Crawler" node card — aria-label is "Toggle Web Crawler".
    const nodeToggle = screen.getByRole("button", { name: "Toggle Web Crawler" });
    await user.click(nodeToggle);
    expect(screen.getByText("web-crawler")).toBeTruthy();
  });

  it("renders tool node config after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Git Clone" });
    await user.click(nodeToggle);
    expect(screen.getByText("git-clone")).toBeTruthy();
  });

  it("renders plugin node config after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Notify Slack" });
    await user.click(nodeToggle);
    expect(screen.getByText("slack-notifier")).toBeTruthy();
    expect(screen.getByText("send_message")).toBeTruthy();
  });

  it("renders condition node CEL expression after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Severity Gate" });
    await user.click(nodeToggle);
    expect(screen.getByText("result.severity == 'critical'")).toBeTruthy();
  });

  it("renders join node wait_for badges after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Result Merger" });
    await user.click(nodeToggle);
    expect(screen.getByText("sub-a")).toBeTruthy();
    expect(screen.getByText("sub-b")).toBeTruthy();
  });

  it("renders per-node retry policy after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Web Crawler" });
    await user.click(nodeToggle);
    expect(screen.getByText("BACKOFF_STRATEGY_EXPONENTIAL")).toBeTruthy();
  });

  it("renders per-node data policy after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Web Crawler" });
    await user.click(nodeToggle);
    expect(screen.getByText("role:analyst")).toBeTruthy();
  });

  it("renders per-node reuse policy after expanding node card", async () => {
    const user = userEvent.setup();
    render(<MissionDefinitionDetail definition={fullFixture} />);
    const nodeToggle = screen.getByRole("button", { name: "Toggle Web Crawler" });
    await user.click(nodeToggle);
    expect(screen.getByText("mission")).toBeTruthy(); // outputScope
    expect(screen.getByText("always")).toBeTruthy();  // reuse
  });
});

describe("MissionDefinitionDetail — minimal fixture (empty-state coverage)", () => {
  it("renders without crashing when optional fields are absent", () => {
    render(<MissionDefinitionDetail definition={minimalFixture} />);
    expect(screen.getByTestId("mission-definition-detail")).toBeTruthy();
  });

  it("renders the name", () => {
    render(<MissionDefinitionDetail definition={minimalFixture} />);
    expect(screen.getByText("Minimal Mission")).toBeTruthy();
  });

  it("renders empty-state dashes for absent overview fields", () => {
    render(<MissionDefinitionDetail definition={minimalFixture} />);
    // Multiple Unset dashes rendered; at least some should be present.
    const dashes = document.querySelectorAll('[aria-label$="not set"]');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("renders Nodes (0) with empty placeholder", () => {
    render(<MissionDefinitionDetail definition={minimalFixture} />);
    expect(screen.getByText("Nodes (0)")).toBeTruthy();
    expect(screen.getByText("No nodes defined.")).toBeTruthy();
  });

  it("renders constraint section without crashing when constraints absent", () => {
    render(<MissionDefinitionDetail definition={minimalFixture} />);
    // The "Constraints" text appears as both the section heading (h2) and the
    // collapsible trigger button. getAllByText handles both.
    expect(screen.getAllByText("Constraints").length).toBeGreaterThan(0);
  });
});
