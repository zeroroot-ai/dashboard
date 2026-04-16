/**
 * Mission Editor Templates
 *
 * Pre-built YAML templates for the mission editor. Each template is a complete,
 * valid Gibson mission definition that users can load and customize.
 *
 * Templates cover the most common security assessment patterns and serve as
 * both starting points and documentation for the mission YAML format.
 */

import type { MissionTemplate } from '@/src/types/mission-creation';

// ============================================================================
// EditorTemplate Interface
// ============================================================================

/**
 * A template entry for the mission YAML editor.
 * Extends MissionTemplate with editor-specific display metadata.
 */
export interface EditorTemplate {
  /** Unique stable identifier for this template */
  id: string;
  /** Display name shown in the template picker */
  name: string;
  /** Short description of what this template does */
  description: string;
  /** Category used for grouping in the UI */
  category: MissionTemplate['category'];
  /** Tags for search and filtering */
  tags: string[];
  /** Approximate lines of YAML (used for display only) */
  lineCount: number;
  /** Difficulty level */
  difficulty: MissionTemplate['difficulty'];
  /** Estimated wall-clock runtime when executed */
  estimatedDuration: string;
  /** Whether to pin this template to the top of the list */
  isFeatured: boolean;
  /** The full YAML content to load into the editor */
  yamlContent: string;
}

// ============================================================================
// Template 1 — full-reference
// ============================================================================

const FULL_REFERENCE_YAML = `# ============================================================
# Gibson Mission Definition — Full Reference
# ============================================================
# This template documents every available field.
# Remove sections you don't need.
# ============================================================

# --- Mission Metadata ---
name: full-reference-mission          # REQUIRED: Alphanumeric, dashes, underscores, spaces
description: |                        # Detailed description of mission objectives (max 2000 chars)
  Complete reference mission showing every available
  configuration field with inline documentation.
version: "1.0.0"                      # Semantic version of this mission definition
tags: [security, reference, recon]    # Categorization tags (max 20, each max 50 chars)
author: security-team                 # Author or team responsible for this mission

# --- Mission Duration ---
max_duration: 2h                      # Hard wall-clock limit: s=seconds, m=minutes, h=hours, d=days

# --- Workspace Configuration ---
# Clone Git repositories so agents can read/write code during the mission.
# Agents access cloned repos via harness.Workspace("<name>").
workspace:
  repositories:
    - name: target-repo               # REQUIRED: Unique name used by agents to access this repo
      url: https://github.com/org/repo.git  # REQUIRED: HTTPS or SSH (git@github.com:org/repo.git)
      branch: main                    # Branch to checkout (defaults to repo default branch)
      shallow: true                   # Shallow clone (--depth 1) for faster clones of large repos
      # credential_name: my-cred      # Reference to a stored credential for private repos
      # depends_on: [other-repo]      # Clone ordering: wait for these repos before cloning this one
  cleanup_on_complete: true           # Delete workspace directories after mission completes
  use_worktrees: false                # Give each agent an isolated Git worktree (prevents conflicts)
  lsp_enabled: false                  # Start language servers for code validation
  # lsp_timeout: "5s"                 # Max time to wait for LSP validation responses
  # base_directory: /tmp/gibson       # Override base directory for workspace clones

# --- Dependencies ---
# Components that must be registered before the mission can run.
# Available agents: gibson-opencode, dns-recon, service-enum,
#   web-fingerprint, api-discovery, code-analyzer, gitlab-scanner
# Available tools:  nmap, httpx, nuclei, dnsx, subfinder, wappalyzer
# Available plugins: gitlab
dependencies:
  agents:                             # Agent component names (auto-installed when mission is installed)
    - service-enum
    - web-fingerprint
  tools:                              # Tool component names
    - nmap
    - httpx
    - nuclei
  plugins: []                         # Plugin component names

# --- Target ---
# Inline target definition. Can also be a string reference to a named target.
target:
  type: domain                        # One of: domain, url, ip, cidr, repository, api
  seeds:
    - \${TARGET_DOMAIN}               # Use \${VAR} syntax for runtime substitution

# --- Mission Config ---
# Arbitrary key/value config passed to all agents via task context.
config:
  scan_profile: standard              # Mission-wide scan profile hint for agents
  company_name: "Acme Corp"           # Contextual metadata passed to LLM agents
  primary_domain: "\${TARGET_DOMAIN}" # Can reference substitution variables

# --- Constraints ---
# Operational boundaries enforced by the daemon during execution.
constraints:
  max_concurrent_agents: 3           # Maximum agents running simultaneously
  max_memory_per_agent: 2Gi          # Memory limit per agent pod
  max_cpu_per_agent: 2000m           # CPU limit per agent pod (millicores)

# --- Guardrails ---
# Safety limits to prevent runaway cost or unintended actions.
guardrails:
  max_tokens: 500000                  # Maximum total LLM tokens to consume across the mission
  max_api_calls: 10000               # Maximum outbound API/tool calls
  rate_limit:
    requests_per_minute: 60          # Per-minute outbound request cap
    requests_per_hour: 1000          # Per-hour outbound request cap
  allowed_agents:                    # Whitelist: only these agents may execute (empty = all allowed)
    - service-enum
    - web-fingerprint
  blocked_agents: []                  # Blacklist: these agents are always refused
  allowed_tools:                     # Whitelist: only these tools may execute (empty = all allowed)
    - nmap
    - httpx
    - nuclei
  blocked_tools: []                   # Blacklist: these tools are always refused
  require_confirmation: true          # Require operator approval before executing agent actions
  allow_external_requests: true      # Allow agents to make external network requests
  sandbox_mode: false                # Restrict to sandbox-safe capabilities only

# --- Reporting ---
reporting:
  formats:                           # Report output formats to generate on completion
    - json                           # Machine-readable findings
    - html                           # Human-readable web report
    - sarif                          # Static Analysis Results Interchange Format (SAST tooling)
    - markdown                       # Plaintext Markdown report
  severity_threshold: info           # Minimum severity to include: critical, high, medium, low, info
  include_evidence: true             # Embed raw tool output as evidence in findings
  include_remediation: true          # Include remediation guidance for each finding
  destinations:                      # Where to deliver completed reports
    - type: file                     # Write to filesystem: file, webhook, s3, slack, jira, email
      config:
        path: /reports/\${TARGET_DOMAIN}.html

# --- Schedule ---
# Run this mission on a recurring cron schedule.
schedule:
  enabled: false                     # Toggle scheduling on/off without removing config
  cron: "0 2 * * 1"                  # Standard cron expression (Mon 02:00 UTC)
  timezone: UTC                      # IANA timezone name for cron evaluation

# --- Environment ---
# Variables and secrets injected into the agent execution environment.
environment:
  variables:
    TARGET_DOMAIN: "\${TARGET_DOMAIN}" # Explicit variable pass-through
    SCAN_PROFILE: standard
  secrets:
    - gitlab-token                   # Secret name in the Gibson credential store

# --- Notifications ---
# Event-driven alerts delivered to configured channels.
notifications:
  on_start:                          # Channels to notify when mission starts
    - slack-ops
  on_complete:                       # Channels to notify on successful completion
    - slack-ops
    - email-security
  on_error:                          # Channels to notify on mission failure
    - pagerduty
  on_finding:
    severity: high                   # Minimum severity to trigger a real-time alert
    channels:
      - slack-findings

# --- Nodes ---
# The DAG of work units. Supported types: agent, tool, plugin, condition, parallel.
# Nodes execute when all their depends_on nodes have completed successfully.
nodes:

  # -- Agent Node --
  # Delegates a task to an LLM-driven agent. The agent receives the task
  # object, calls tools, and produces findings via the Harness interface.
  - id: service-enum                 # REQUIRED: Unique node ID (alphanumeric, dashes, underscores)
    type: agent                      # REQUIRED: agent | tool | plugin | condition | parallel
    name: Service Enumeration        # Human-readable display name
    description: Enumerate open ports and services on the target
    agent: service-enum              # Registered agent component name
    depends_on: []                   # Node IDs that must complete before this node starts
    timeout: 30m                     # Per-node timeout; overrides mission max_duration for this node
    task:
      goal: |                        # Natural language task passed to the agent's LLM
        Perform comprehensive service enumeration on \${TARGET_DOMAIN}.
        Identify open ports, service versions, and known CVEs.
      context:                       # Structured context merged into the agent's working memory
        targets:
          - "\${TARGET_DOMAIN}"
        port_range: "22,80,443,8080,8443"
        enable_nuclei: true
    retry:                           # Retry policy for this node on failure
      max_retries: 2                 # Maximum retry attempts (0 = no retries)
      backoff: exponential           # constant | linear | exponential
      initial_delay: 10s             # Delay before first retry
      max_delay: 2m                  # Cap on delay between retries (exponential only)
      multiplier: 2.0                # Backoff multiplier (exponential only)
    data_policy:                     # Controls what data this node can read/write
      read_from: []                  # Node IDs whose outputs this node may read
      write_to: []                   # Node IDs that may read this node's output
    metadata:
      owner: security-team           # Arbitrary key/value metadata

  # -- Tool Node --
  # Directly invokes a stateless proto-based tool worker without an LLM agent.
  - id: http-probe
    type: tool
    name: HTTP Probe
    description: Probe discovered hosts for HTTP services
    tool: httpx                      # Registered tool component name
    depends_on: [service-enum]
    timeout: 10m
    input:                           # Tool-specific input parameters
      targets:
        - "\${TARGET_DOMAIN}"
      follow_redirects: true
      status_codes: [200, 301, 302, 403, 404, 500]
      threads: 50
    retry:
      max_retries: 1
      backoff: constant
      initial_delay: 5s

  # -- Plugin Node --
  # Invokes a method on a stateful plugin (e.g. GitLab integration).
  - id: create-issue
    type: plugin
    name: Create GitLab Issue
    description: Open a tracking issue for findings
    plugin: gitlab                   # Registered plugin component name
    method: create_issue             # Plugin method to invoke
    depends_on: [http-probe]
    timeout: 5m
    params:                          # Plugin method parameters
      project: org/security-tracking
      title: "Scan results: \${TARGET_DOMAIN}"
      labels: [security, automated]
    retry:
      max_retries: 3
      backoff: linear
      initial_delay: 5s

  # -- Condition Node --
  # Evaluates a CEL expression and routes execution to true_branch or false_branch.
  - id: check-findings
    type: condition
    name: Check for Critical Findings
    description: Route to remediation if critical findings were discovered
    depends_on: [create-issue]
    condition:
      expression: "nodes['http-probe'].result.finding_count > 0"  # CEL expression
      true_branch: [notify-critical]   # Node IDs to execute when expression is true
      false_branch: [finalize]         # Node IDs to execute when expression is false

  # -- Parallel Node --
  # Executes a set of sub-nodes concurrently and waits for all to complete.
  - id: parallel-scans
    type: parallel
    name: Parallel Technology Detection
    description: Run multiple detection tools concurrently
    depends_on: []
    sub_nodes:                       # These nodes execute simultaneously
      - id: wappalyzer-scan
        type: tool
        tool: wappalyzer
        input:
          url: "https://\${TARGET_DOMAIN}"
      - id: nuclei-scan
        type: tool
        tool: nuclei
        input:
          target: "\${TARGET_DOMAIN}"
          templates: cves,vulnerabilities

  # Placeholder terminal nodes referenced above
  - id: notify-critical
    type: agent
    agent: gibson-opencode
    depends_on: []
    task:
      goal: Generate a critical findings summary and notify the security team.

  - id: finalize
    type: agent
    agent: gibson-opencode
    depends_on: []
    task:
      goal: Generate a clean bill of health report — no critical findings were detected.

# --- Retry Policy (Mission-Level Default) ---
# Applied to any node that does not declare its own retry policy.
retry_policy:
  max_retries: 1
  backoff: exponential
  initial_delay: 30s
  max_delay: 5m
  multiplier: 2.0

# --- Data Policy (Mission-Level Default) ---
# Controls cross-node data sharing defaults.
data_policy:
  read_from: []
  write_to: []

# --- Edges ---
# Explicit DAG edges. In most cases depends_on is sufficient; use edges for
# conditional routing or when you need to annotate a connection with a condition.
edges:
  - from: service-enum               # Source node ID
    to: http-probe                   # Destination node ID
    # condition: "result.status == 'success'"  # Optional CEL guard on this edge
`;

// ============================================================================
// Template 2 — quick-network-scan
// ============================================================================

const QUICK_NETWORK_SCAN_YAML = `name: quick-network-scan
description: Fast port scan and HTTP probe against a single target domain.
version: "1.0.0"
tags: [network, recon, quick]

target:
  type: domain
  seeds:
    - \${TARGET_DOMAIN}

dependencies:
  agents: [service-enum, web-fingerprint]
  tools: [nmap, httpx]

nodes:
  - id: port-scan
    type: agent
    agent: service-enum
    task:
      goal: |
        Scan \${TARGET_DOMAIN} for open ports and identify running services.
        Focus on common ports: 22, 80, 443, 8080, 8443.
      context:
        targets:
          - "\${TARGET_DOMAIN}"
        ports: "22,80,443,8080,8443"
    timeout: 5m

  - id: http-probe
    type: agent
    agent: web-fingerprint
    depends_on: [port-scan]
    task:
      goal: |
        Probe discovered HTTP/HTTPS services on \${TARGET_DOMAIN}.
        Identify web server, headers, and basic technology stack.
      context:
        targets:
          - "\${TARGET_DOMAIN}"
    timeout: 5m
`;

// ============================================================================
// Template 3 — web-assessment
// ============================================================================

const WEB_ASSESSMENT_YAML = `name: web-assessment
description: |
  Web application assessment combining HTTP probing, vulnerability scanning,
  and technology fingerprinting for a target URL or domain.
version: "1.0.0"
tags: [web, assessment, httpx, nuclei, wappalyzer]

target:
  type: url
  seeds:
    - \${TARGET_URL}

dependencies:
  agents: [web-fingerprint]
  tools: [httpx, nuclei, wappalyzer]

guardrails:
  max_tokens: 200000
  allow_external_requests: true
  require_confirmation: true

reporting:
  formats: [json, html, sarif]
  severity_threshold: low
  include_evidence: true
  include_remediation: true

nodes:
  - id: http-probe
    type: tool
    tool: httpx
    input:
      targets:
        - "\${TARGET_URL}"
      follow_redirects: true
      threads: 25
      timeout: 10
    timeout: 10m

  - id: vuln-scan
    type: tool
    tool: nuclei
    depends_on: [http-probe]
    input:
      target: "\${TARGET_URL}"
      templates: cves,vulnerabilities,exposures,misconfiguration
      severity: low,medium,high,critical
      rate_limit: 100
    timeout: 20m
    retry:
      max_retries: 2
      backoff: exponential
      initial_delay: 15s
      max_delay: 2m
      multiplier: 2.0

  - id: tech-fingerprint
    type: tool
    tool: wappalyzer
    depends_on: [http-probe]
    input:
      url: "\${TARGET_URL}"
    timeout: 5m

  - id: summarize
    type: agent
    agent: web-fingerprint
    depends_on: [vuln-scan, tech-fingerprint]
    task:
      goal: |
        Analyse the HTTP probe, vulnerability scan, and technology fingerprint
        results for \${TARGET_URL}. Produce a prioritised findings report
        covering discovered technologies, vulnerabilities, and recommended
        remediation steps.
      context:
        target_url: "\${TARGET_URL}"
    timeout: 10m
`;

// ============================================================================
// Template 4 — full-recon
// ============================================================================

const FULL_RECON_YAML = `name: full-recon
description: |
  Full external reconnaissance pipeline: subdomain enumeration, DNS resolution,
  port scanning, HTTP probing, vulnerability detection, and technology
  fingerprinting. Suitable for initial attack-surface discovery.
version: "1.0.0"
tags: [recon, full, subfinder, dnsx, nmap, httpx, nuclei, wappalyzer]

target:
  type: domain
  seeds:
    - \${TARGET_DOMAIN}

dependencies:
  agents: [dns-recon, service-enum, web-fingerprint]
  tools: [subfinder, dnsx, nmap, httpx, nuclei, wappalyzer]

guardrails:
  max_tokens: 1000000
  max_api_calls: 50000
  rate_limit:
    requests_per_minute: 120
    requests_per_hour: 5000
  allow_external_requests: true
  require_confirmation: true

reporting:
  formats: [json, html, sarif, markdown]
  severity_threshold: info
  include_evidence: true
  include_remediation: true

nodes:
  # Stage 1: Passive subdomain discovery
  - id: subdomain-enum
    type: tool
    tool: subfinder
    input:
      domain: "\${TARGET_DOMAIN}"
      sources: [crtsh, hackertarget, threatcrowd, virustotal]
      recursive: true
      timeout: 300
    timeout: 10m

  # Stage 2: DNS resolution of discovered subdomains
  - id: dns-resolve
    type: tool
    tool: dnsx
    depends_on: [subdomain-enum]
    input:
      domains_from_node: subdomain-enum
      record_types: [A, AAAA, CNAME, MX, TXT, NS]
      resolver_list: [8.8.8.8, 1.1.1.1]
      concurrency: 100
    timeout: 10m

  # Stage 3: Port scan resolved hosts
  - id: port-scan
    type: agent
    agent: service-enum
    depends_on: [dns-resolve]
    task:
      goal: |
        Perform comprehensive port scanning on all resolved hosts for \${TARGET_DOMAIN}.
        Identify open ports, service banners, and OS fingerprints.
      context:
        domain: "\${TARGET_DOMAIN}"
        port_range: "21,22,25,53,80,110,135,139,143,443,445,993,995,1433,3306,3389,5432,8080,8443,8888"
        enable_service_detection: true
        enable_os_detection: true
        timing_template: 3
    timeout: 30m
    retry:
      max_retries: 1
      backoff: constant
      initial_delay: 30s

  # Stage 4a: HTTP probe (parallel with 4b)
  - id: parallel-web
    type: parallel
    depends_on: [port-scan]
    sub_nodes:
      - id: http-probe
        type: tool
        tool: httpx
        input:
          domains_from_node: dns-resolve
          follow_redirects: true
          threads: 50
          status_codes: [200, 301, 302, 403, 404, 500, 503]
          include_chain: true

      # Stage 4b: Technology fingerprinting (parallel with 4a)
      - id: tech-fingerprint
        type: tool
        tool: wappalyzer
        input:
          domains_from_node: dns-resolve
          timeout: 15

  # Stage 5: Vulnerability scanning against live HTTP targets
  - id: vuln-scan
    type: agent
    agent: web-fingerprint
    depends_on: [parallel-web]
    task:
      goal: |
        Run nuclei against all live web targets discovered for \${TARGET_DOMAIN}.
        Prioritise CVE templates, misconfigurations, and exposed admin panels.
      context:
        domain: "\${TARGET_DOMAIN}"
        enable_nuclei: true
        nuclei_templates: "cves,vulnerabilities,exposures,misconfiguration,default-logins"
        severity: low,medium,high,critical
        rate_limit: 150
    timeout: 45m
    retry:
      max_retries: 2
      backoff: exponential
      initial_delay: 30s
      max_delay: 5m
      multiplier: 2.0

  # Stage 6: Consolidate and report
  - id: report
    type: agent
    agent: gibson-opencode
    depends_on: [vuln-scan]
    task:
      goal: |
        Synthesise all findings from the full reconnaissance pipeline for
        \${TARGET_DOMAIN}. Produce an executive summary, a prioritised
        vulnerability list, and a remediation roadmap. Commit the report
        as results.md if a workspace repository is configured.
      context:
        domain: "\${TARGET_DOMAIN}"
    timeout: 15m
`;

// ============================================================================
// Template 5 — api-discovery
// ============================================================================

const API_DISCOVERY_YAML = `name: api-discovery
description: Automated REST/GraphQL API endpoint discovery and surface mapping.
version: "1.0.0"
tags: [api, discovery, recon]

target:
  type: url
  seeds:
    - \${TARGET_URL}

dependencies:
  agents: [api-discovery]

guardrails:
  allow_external_requests: true
  require_confirmation: true

nodes:
  - id: discover
    type: agent
    agent: api-discovery
    task:
      goal: |
        Discover all API endpoints exposed by \${TARGET_URL}.
        Map REST routes, GraphQL schemas, and any OpenAPI/Swagger specifications.
        Identify authentication mechanisms and flag unauthenticated endpoints.
      context:
        target_url: "\${TARGET_URL}"
        follow_redirects: true
        check_swagger: true
        check_graphql: true
        wordlist: api-endpoints-large
    timeout: 20m
`;

// ============================================================================
// editorTemplates Array
// ============================================================================

export const editorTemplates: EditorTemplate[] = [
  {
    id: 'full-reference',
    name: 'Full Reference',
    description:
      'Complete mission YAML documenting every available field with inline comments. Use this as a starting point or reference guide.',
    category: 'custom',
    tags: ['reference', 'documentation', 'all-fields'],
    lineCount: 220,
    difficulty: 'advanced',
    estimatedDuration: 'varies',
    isFeatured: true,
    yamlContent: FULL_REFERENCE_YAML,
  },
  {
    id: 'quick-network-scan',
    name: 'Quick Network Scan',
    description: 'Fast port scan followed by HTTP probing. Ideal for a first look at an unknown target.',
    category: 'network',
    tags: ['network', 'recon', 'quick', 'nmap', 'httpx'],
    lineCount: 38,
    difficulty: 'beginner',
    estimatedDuration: '~10m',
    isFeatured: false,
    yamlContent: QUICK_NETWORK_SCAN_YAML,
  },
  {
    id: 'web-assessment',
    name: 'Web Assessment',
    description: 'HTTP probing, Nuclei vulnerability scanning, and Wappalyzer technology fingerprinting for a web target.',
    category: 'web',
    tags: ['web', 'httpx', 'nuclei', 'wappalyzer', 'vulnerabilities'],
    lineCount: 72,
    difficulty: 'intermediate',
    estimatedDuration: '~45m',
    isFeatured: false,
    yamlContent: WEB_ASSESSMENT_YAML,
  },
  {
    id: 'full-recon',
    name: 'Full Recon',
    description:
      'Complete external reconnaissance: subfinder subdomain enumeration, dnsx resolution, nmap port scan, httpx probe, nuclei vuln scan, and wappalyzer fingerprinting with parallel stages.',
    category: 'recon',
    tags: ['recon', 'subfinder', 'dnsx', 'nmap', 'httpx', 'nuclei', 'wappalyzer', 'full'],
    lineCount: 145,
    difficulty: 'advanced',
    estimatedDuration: '~2h',
    isFeatured: true,
    yamlContent: FULL_RECON_YAML,
  },
  {
    id: 'api-discovery',
    name: 'API Discovery',
    description: 'Single-agent REST and GraphQL endpoint discovery with OpenAPI/Swagger detection.',
    category: 'api',
    tags: ['api', 'rest', 'graphql', 'discovery', 'swagger'],
    lineCount: 30,
    difficulty: 'beginner',
    estimatedDuration: '~20m',
    isFeatured: false,
    yamlContent: API_DISCOVERY_YAML,
  },
];

export default editorTemplates;
