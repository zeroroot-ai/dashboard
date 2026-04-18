/**
 * Monaco Autocomplete Providers
 *
 * Custom completion providers for mission YAML.
 * Features:
 * - Agent name autocomplete
 * - Tool name autocomplete
 * - YAML key suggestions
 * - Schema-aware completions
 */

import type * as Monaco from 'monaco-editor';

// ============================================================================
// Types
// ============================================================================

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
}

export interface ToolInfo {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface AutocompleteConfig {
  agents: AgentInfo[];
  tools: ToolInfo[];
}

// ============================================================================
// Default Data
// ============================================================================

const DEFAULT_AGENTS: AgentInfo[] = [
  { id: 'recon-agent', name: 'Reconnaissance Agent', description: 'Initial reconnaissance and discovery' },
  { id: 'web-crawler', name: 'Web Crawler', description: 'Crawl web applications for content discovery' },
  { id: 'vulnerability-scanner', name: 'Vulnerability Scanner', description: 'Scan for common vulnerabilities' },
  { id: 'api-mapper', name: 'API Mapper', description: 'Map and document API endpoints' },
  { id: 'auth-tester', name: 'Auth Tester', description: 'Test authentication and authorization' },
  { id: 'injection-scanner', name: 'Injection Scanner', description: 'Test for injection vulnerabilities' },
  { id: 'port-scanner', name: 'Port Scanner', description: 'Scan for open ports and services' },
  { id: 'secret-scanner', name: 'Secret Scanner', description: 'Find exposed secrets and credentials' },
  { id: 'network-scanner', name: 'Network Scanner', description: 'Discover network infrastructure' },
  { id: 'service-enumerator', name: 'Service Enumerator', description: 'Enumerate services on open ports' },
  { id: 'dependency-scanner', name: 'Dependency Scanner', description: 'Check for vulnerable dependencies' },
  { id: 'cloud-config-scanner', name: 'Cloud Config Scanner', description: 'Scan for cloud misconfigurations' },
  { id: 'iam-analyzer', name: 'IAM Analyzer', description: 'Analyze IAM policies and permissions' },
];

const DEFAULT_TOOLS: ToolInfo[] = [
  { id: 'http-request', name: 'HTTP Request', description: 'Make HTTP requests' },
  { id: 'git-clone', name: 'Git Clone', description: 'Clone git repositories' },
  { id: 'file-reader', name: 'File Reader', description: 'Read file contents' },
  { id: 'json-parser', name: 'JSON Parser', description: 'Parse and extract JSON data' },
  { id: 'html-parser', name: 'HTML Parser', description: 'Parse and extract HTML content' },
  { id: 'regex-search', name: 'Regex Search', description: 'Search with regular expressions' },
  { id: 'dns-lookup', name: 'DNS Lookup', description: 'Perform DNS queries' },
  { id: 'whois-lookup', name: 'WHOIS Lookup', description: 'Query WHOIS information' },
  { id: 'ssl-check', name: 'SSL Check', description: 'Analyze SSL/TLS certificates' },
];

// YAML schema keys for different contexts
const YAML_KEYS = {
  root: ['name', 'description', 'tags', 'scope', 'mission', 'guardrails', 'reporting', 'priority', 'maxDuration', 'maxCost'],
  scope: ['seeds', 'include', 'exclude', 'depth', 'maxTargets', 'followRedirects', 'expansionMode'],
  mission: ['type', 'steps', 'agents', 'errorHandling'],
  missionStep: ['id', 'type', 'agent', 'tool', 'task', 'parameters', 'dependsOn', 'onSuccess', 'onFailure', 'timeout'],
  guardrails: ['maxTokens', 'maxTokensPerCall', 'maxTotalTokens', 'rateLimit', 'rateLimits', 'allowedAgents', 'blockedAgents', 'requireConfirmation', 'sandboxMode', 'enableCelGuardrails'],
  reporting: ['formats', 'severityThreshold'],
};

// ============================================================================
// Completion Provider
// ============================================================================

/**
 * Create a completion provider for mission YAML
 */
export function createMissionCompletionProvider(
  monaco: typeof Monaco,
  config: Partial<AutocompleteConfig> = {}
): Monaco.languages.CompletionItemProvider {
  const agents = config.agents || DEFAULT_AGENTS;
  const tools = config.tools || DEFAULT_TOOLS;

  return {
    triggerCharacters: ['.', ':', ' ', '-'],

    provideCompletionItems(
      model: Monaco.editor.ITextModel,
      position: Monaco.Position
    ): Monaco.languages.ProviderResult<Monaco.languages.CompletionList> {
      const lineContent = model.getLineContent(position.lineNumber);
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suggestions: Monaco.languages.CompletionItem[] = [];
      const wordRange = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: wordRange.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordRange.endColumn,
      };

      // Detect context
      const context = detectContext(textUntilPosition, lineContent);

      switch (context) {
        case 'agent':
          // Suggest agent names
          for (const agent of agents) {
            suggestions.push({
              label: agent.id,
              kind: monaco.languages.CompletionItemKind.Value,
              detail: agent.name,
              documentation: agent.description,
              insertText: agent.id,
              range,
            });
          }
          break;

        case 'tool':
          // Suggest tool names
          for (const tool of tools) {
            suggestions.push({
              label: tool.id,
              kind: monaco.languages.CompletionItemKind.Value,
              detail: tool.name,
              documentation: tool.description,
              insertText: tool.id,
              range,
            });
          }
          break;

        case 'allowedAgents':
        case 'blockedAgents':
          // Suggest agent names for allow/block lists
          for (const agent of agents) {
            suggestions.push({
              label: agent.id,
              kind: monaco.languages.CompletionItemKind.Value,
              detail: agent.name,
              documentation: agent.description,
              insertText: `- ${agent.id}`,
              range,
            });
          }
          break;

        case 'root':
          // Suggest root-level keys
          for (const key of YAML_KEYS.root) {
            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: getKeySnippet(key),
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            });
          }
          break;

        case 'scope':
          for (const key of YAML_KEYS.scope) {
            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: `${key}: `,
              range,
            });
          }
          break;

        case 'mission':
          for (const key of YAML_KEYS.mission) {
            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: `${key}: `,
              range,
            });
          }
          break;

        case 'missionStep':
          for (const key of YAML_KEYS.missionStep) {
            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: `${key}: `,
              range,
            });
          }
          break;

        case 'guardrails':
          for (const key of YAML_KEYS.guardrails) {
            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: `${key}: `,
              range,
            });
          }
          break;

        case 'reporting':
          for (const key of YAML_KEYS.reporting) {
            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: `${key}: `,
              range,
            });
          }
          break;

        case 'formats':
          // Report formats
          for (const format of ['json', 'html', 'pdf', 'sarif', 'csv']) {
            suggestions.push({
              label: format,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              insertText: `- ${format}`,
              range,
            });
          }
          break;

        case 'severityThreshold':
          // Severity levels
          for (const severity of ['critical', 'high', 'medium', 'low', 'informational']) {
            suggestions.push({
              label: severity,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              insertText: severity,
              range,
            });
          }
          break;

        case 'expansionMode':
          for (const mode of ['strict', 'subdomain', 'related', 'none']) {
            suggestions.push({
              label: mode,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              insertText: mode,
              range,
            });
          }
          break;

        default:
          // No specific context, suggest nothing
          break;
      }

      return { suggestions };
    },
  };
}

// ============================================================================
// Context Detection
// ============================================================================

type CompletionContext =
  | 'root'
  | 'scope'
  | 'mission'
  | 'missionStep'
  | 'guardrails'
  | 'reporting'
  | 'agent'
  | 'tool'
  | 'allowedAgents'
  | 'blockedAgents'
  | 'formats'
  | 'severityThreshold'
  | 'expansionMode'
  | 'unknown';

function detectContext(textUntilPosition: string, currentLine: string): CompletionContext {
  // Check for specific key patterns on current line
  if (/agent:\s*$/.test(currentLine)) return 'agent';
  if (/tool:\s*$/.test(currentLine)) return 'tool';
  if (/expansionMode:\s*$/.test(currentLine)) return 'expansionMode';
  if (/severityThreshold:\s*$/.test(currentLine)) return 'severityThreshold';

  // Check for list context after allowedAgents/blockedAgents
  if (/allowedAgents:/.test(textUntilPosition) && /^\s+-?\s*$/.test(currentLine)) {
    return 'allowedAgents';
  }
  if (/blockedAgents:/.test(textUntilPosition) && /^\s+-?\s*$/.test(currentLine)) {
    return 'blockedAgents';
  }

  // Check for formats list
  if (/formats:/.test(textUntilPosition) && /^\s+-?\s*$/.test(currentLine)) {
    return 'formats';
  }

  // Check section context
  const lines = textUntilPosition.split('\n');
  let currentSection = 'root';

  for (const line of lines) {
    if (/^scope:/.test(line)) currentSection = 'scope';
    else if (/^mission:/.test(line)) currentSection = 'mission';
    else if (/^guardrails:/.test(line)) currentSection = 'guardrails';
    else if (/^reporting:/.test(line)) currentSection = 'reporting';
    else if (/^\s+-\s*(id|agent|tool|type):/.test(line) && currentSection === 'mission') {
      currentSection = 'missionStep';
    }
  }

  // Check if we're at a key position (start of line or after indent)
  if (/^\s*$/.test(currentLine) || /^[a-z]/.test(currentLine.trim())) {
    return currentSection as CompletionContext;
  }

  return 'unknown';
}

// ============================================================================
// Snippets
// ============================================================================

function getKeySnippet(key: string): string {
  switch (key) {
    case 'name':
      return 'name: ${1:my-mission}';
    case 'description':
      return 'description: ${1:Mission description}';
    case 'tags':
      return 'tags:\n  - ${1:tag1}';
    case 'scope':
      return 'scope:\n  seeds:\n    - ${1:https://example.com}';
    case 'mission':
      return 'mission:\n  - agent: ${1:recon-agent}\n    task: ${2:Perform reconnaissance}';
    case 'guardrails':
      return 'guardrails:\n  maxTokens: ${1:100000}';
    case 'reporting':
      return 'reporting:\n  formats:\n    - json';
    default:
      return `${key}: `;
  }
}

// ============================================================================
// Registration Helper
// ============================================================================

/**
 * Register completion provider with Monaco
 */
export function registerMissionCompletion(
  monaco: typeof Monaco,
  config?: Partial<AutocompleteConfig>
): Monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider(
    'yaml',
    createMissionCompletionProvider(monaco, config)
  );
}

/**
 * Fetch agents and tools from API
 */
export async function fetchAutocompleteData(): Promise<AutocompleteConfig> {
  try {
    const [agentsResponse, toolsResponse] = await Promise.all([
      fetch('/api/agents').catch(() => null),
      fetch('/api/tools').catch(() => null),
    ]);

    const agents = agentsResponse?.ok
      ? await agentsResponse.json()
      : DEFAULT_AGENTS;

    const tools = toolsResponse?.ok
      ? await toolsResponse.json()
      : DEFAULT_TOOLS;

    return { agents, tools };
  } catch {
    return { agents: DEFAULT_AGENTS, tools: DEFAULT_TOOLS };
  }
}

// ============================================================================
// Export
// ============================================================================

export default {
  createMissionCompletionProvider,
  registerMissionCompletion,
  fetchAutocompleteData,
  DEFAULT_AGENTS,
  DEFAULT_TOOLS,
};
