/**
 * Help Content System
 *
 * Manages help topics, categories, and content loading.
 * Supports markdown content with code examples.
 */

// ============================================================================
// Types
// ============================================================================

export type HelpCategory =
  | 'getting-started'
  | 'missions'
  | 'agents'
  | 'findings'
  | 'graph'
  | 'tools'
  | 'settings';

export interface HelpTopic {
  id: string;
  title: string;
  category: HelpCategory;
  description: string;
  keywords: string[];
  content: string;
  relatedTopics?: string[];
  lastUpdated?: string;
}

export interface HelpCategoryInfo {
  id: HelpCategory;
  label: string;
  description: string;
  icon: string;
}

// ============================================================================
// Category Configuration
// ============================================================================

export const HELP_CATEGORIES: HelpCategoryInfo[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    description: 'Learn the basics of Gibson',
    icon: 'rocket',
  },
  {
    id: 'missions',
    label: 'Missions',
    description: 'Create and manage security missions',
    icon: 'target',
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Configure and deploy security agents',
    icon: 'bot',
  },
  {
    id: 'findings',
    label: 'Findings',
    description: 'Understand and remediate findings',
    icon: 'shield',
  },
  {
    id: 'graph',
    label: 'Knowledge Graph',
    description: 'Explore relationships and patterns',
    icon: 'graph',
  },
  {
    id: 'tools',
    label: 'Tools',
    description: 'Security tools and integrations',
    icon: 'wrench',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Configure your workspace',
    icon: 'settings',
  },
];

// ============================================================================
// Built-in Help Content
// ============================================================================

export const HELP_TOPICS: HelpTopic[] = [
  // Getting Started
  {
    id: 'welcome',
    title: 'Welcome to Gibson',
    category: 'getting-started',
    description: 'Introduction to Gibson and its key features',
    keywords: ['welcome', 'introduction', 'overview', 'start'],
    content: `
# Welcome to Gibson

Gibson is an AI-powered security operations platform that helps you discover vulnerabilities and protect your infrastructure.

## Key Concepts

### Missions
Missions are targeted security operations. Each mission has:
- A specific objective (e.g., scan a domain)
- One or more agents to execute the work
- Findings discovered during execution

### Agents
Agents are autonomous security specialists that execute missions. Gibson includes pre-built agents and supports custom agent creation.

### Findings
Findings are vulnerabilities, misconfigurations, or security issues discovered during missions.

## Getting Started

1. **Configure your LLM provider** - Set up Anthropic, OpenAI, or another provider
2. **Choose an agent** - Start with the Debug Agent to learn
3. **Create a mission** - Use a template or create custom
4. **Review findings** - Analyze and remediate issues

Press \`Cmd+K\` at any time to open this help panel.
    `.trim(),
    relatedTopics: ['create-mission', 'agents-overview'],
  },
  {
    id: 'quick-start',
    title: 'Quick Start Guide',
    category: 'getting-started',
    description: 'Get up and running in 5 minutes',
    keywords: ['quick', 'start', 'guide', 'tutorial', 'beginner'],
    content: `
# Quick Start Guide

Get your first security scan running in 5 minutes.

## Step 1: Configure LLM

Gibson requires an LLM provider. Go to **Settings > LLM Configuration** and add your API key.

Supported providers:
- Anthropic Claude (recommended)
- OpenAI GPT-4
- Google Gemini
- Ollama (self-hosted)

## Step 2: Run Your First Mission

1. Go to **Missions > Templates**
2. Select "Hello Zero Root AI" template
3. Click "Run Mission"
4. Watch real-time progress

## Step 3: Review Findings

After the mission completes:
1. Go to **Findings**
2. Filter by severity
3. Click a finding for details
4. Follow remediation guidance
    `.trim(),
    relatedTopics: ['welcome', 'llm-config'],
  },

  // Missions
  {
    id: 'create-mission',
    title: 'Creating Missions',
    category: 'missions',
    description: 'Learn how to create and configure missions',
    keywords: ['create', 'mission', 'new', 'configure', 'setup'],
    content: `
# Creating Missions

Missions are the core of Gibson's security operations.

## From Templates

The easiest way to start:
1. Go to **Missions > Templates**
2. Browse by category
3. Select a template
4. Customize parameters
5. Run

## Custom Missions

For advanced users:
1. Go to **Missions > New**
2. Define objectives
3. Select agents
4. Configure scope
5. Set constraints

## Mission Parameters

- **Target**: Domain, IP, or CIDR range
- **Agent**: Security specialist to use
- **Depth**: How thorough the scan
- **Constraints**: Time limits, exclusions
    `.trim(),
    relatedTopics: ['mission-templates', 'agents-overview'],
  },
  {
    id: 'mission-templates',
    title: 'Mission Templates',
    category: 'missions',
    description: 'Pre-built mission templates for common tasks',
    keywords: ['template', 'preset', 'quick', 'beginner'],
    content: `
# Mission Templates

Templates provide pre-configured missions for common security tasks.

## Available Templates

### Reconnaissance
- **Subdomain Discovery** - Find all subdomains
- **Port Scan** - Identify open services
- **Technology Fingerprint** - Detect tech stack

### Vulnerability Scanning
- **Web Security Scan** - OWASP Top 10
- **SSL/TLS Audit** - Certificate issues
- **Headers Check** - Security headers

### Compliance
- **PCI-DSS Check** - Payment compliance
- **SOC 2 Audit** - Security controls

## Using Templates

1. Browse the template library
2. Check prerequisites
3. Customize if needed
4. Run
    `.trim(),
    relatedTopics: ['create-mission'],
  },

  // Agents
  {
    id: 'agents-overview',
    title: 'Agents Overview',
    category: 'agents',
    description: 'Understanding Gibson agents',
    keywords: ['agent', 'overview', 'bot', 'autonomous'],
    content: `
# Gibson Agents

Agents are autonomous security specialists that execute missions.

## Pre-installed Agents

### Debug Agent
Perfect for learning. Shows detailed explanations of each step.

### Recon Agent
Discovers subdomains, services, and potential entry points.

### Vulnerability Scanner
Scans for CVEs, misconfigurations, and compliance issues.

### Web Security Agent
Specializes in OWASP Top 10 vulnerabilities.

## Agent Capabilities

Each agent has:
- **Tools**: Security utilities it can use
- **Specializations**: Areas of expertise
- **Depth levels**: How thorough it can scan

## Custom Agents

Create agents for specialized tasks:
1. Go to **Agents > Create**
2. Define capabilities
3. Add tools
4. Set constraints
    `.trim(),
    relatedTopics: ['create-agent', 'tools-overview'],
  },

  // Findings
  {
    id: 'findings-overview',
    title: 'Understanding Findings',
    category: 'findings',
    description: 'How to interpret and act on findings',
    keywords: ['finding', 'vulnerability', 'issue', 'remediate'],
    content: `
# Understanding Findings

Findings are security issues discovered during missions.

## Severity Levels

- **Critical**: Immediate action required
- **High**: Address within 24 hours
- **Medium**: Plan remediation
- **Low**: Address when convenient
- **Info**: Informational only

## Finding Details

Each finding includes:
- **Title**: What was found
- **Description**: Technical details
- **Evidence**: Proof of issue
- **Remediation**: How to fix
- **References**: CVEs, documentation

## Process

1. **Triage**: Review new findings
2. **Validate**: Confirm the issue
3. **Prioritize**: Based on severity
4. **Remediate**: Apply fixes
5. **Verify**: Re-scan to confirm
    `.trim(),
    relatedTopics: ['remediation-guide'],
  },

  // Graph
  {
    id: 'graph-overview',
    title: 'Knowledge Graph',
    category: 'graph',
    description: 'Visualizing security relationships',
    keywords: ['graph', 'visualization', '3d', 'relationship'],
    content: `
# Knowledge Graph

The knowledge graph visualizes relationships between assets, findings, and threats.

## Navigation

- **Rotate**: Click and drag
- **Zoom**: Scroll wheel
- **Pan**: Right-click drag
- **Select**: Click a node

## Node Types

- **Assets**: Systems, domains, services
- **Findings**: Vulnerabilities, issues
- **Agents**: Security specialists
- **Missions**: Operations

## Relationships

Lines between nodes show:
- Attack paths
- Dependencies
- Shared vulnerabilities
- Agent assignments

## Filtering

Use filters to focus on:
- Specific severity levels
- Asset types
- Time ranges
- Mission results
    `.trim(),
    relatedTopics: ['findings-overview'],
  },

  // Tools
  {
    id: 'tools-overview',
    title: 'Security Tools',
    category: 'tools',
    description: 'Available security tools and integrations',
    keywords: ['tools', 'security', 'scanner', 'integration'],
    content: `
# Security Tools

Gibson integrates with various security tools to enhance scanning capabilities.

## Built-in Tools

### Network Tools
- **Port Scanner** - Identify open ports and services
- **DNS Resolver** - Enumerate DNS records
- **SSL Checker** - Analyze certificates and TLS configuration

### Web Tools
- **HTTP Client** - Make authenticated requests
- **Spider** - Crawl and map web applications
- **Parameter Fuzzer** - Test input validation

### Analysis Tools
- **CVE Lookup** - Check for known vulnerabilities
- **Technology Detector** - Fingerprint tech stacks
- **Header Analyzer** - Security header compliance

## Tool Configuration

Each tool can be configured:
1. Go to **Settings > Tools**
2. Select the tool to configure
3. Adjust parameters
4. Save changes

## Adding Custom Tools

Extend Gibson with custom tools:
1. Create a tool definition file
2. Define inputs and outputs
3. Implement the tool logic
4. Register in tool catalog
    `.trim(),
    relatedTopics: ['agents-overview'],
  },
  {
    id: 'tool-permissions',
    title: 'Tool Permissions',
    category: 'tools',
    description: 'Managing tool access and permissions',
    keywords: ['permissions', 'access', 'security', 'control'],
    content: `
# Tool Permissions

Control which tools agents can use during missions.

## Permission Levels

- **Full Access** - All tools available
- **Restricted** - Only safe tools
- **Custom** - Define specific tools

## Configuring Permissions

1. Go to **Settings > Tool Permissions**
2. Select an agent or create a profile
3. Enable/disable individual tools
4. Set parameter restrictions
5. Save changes

## Best Practices

- Start with restricted access for new agents
- Enable tools progressively as needed
- Review tool usage in audit logs
- Create profiles for common use cases
    `.trim(),
    relatedTopics: ['tools-overview'],
  },

  // Settings
  {
    id: 'llm-config',
    title: 'LLM Configuration',
    category: 'settings',
    description: 'Configure your LLM provider',
    keywords: ['llm', 'api', 'anthropic', 'openai', 'gemini', 'ollama', 'configuration'],
    content: `
# LLM Configuration

Gibson requires an LLM provider to power its AI agents.

## Supported Providers

### Anthropic Claude (Recommended)
Best for security analysis with strong reasoning capabilities.
- Models: Claude 3 Opus, Claude 3 Sonnet
- API key required

### OpenAI
Wide model selection with good performance.
- Models: GPT-4, GPT-4 Turbo
- API key required

### Google AI
Gemini models with multimodal capabilities.
- Models: Gemini Pro, Gemini Ultra
- API key required

### Ollama (Self-hosted)
Run models locally for privacy.
- No API key required
- Requires local Ollama installation

## Configuration Steps

1. Go to **Settings > LLM Configuration**
2. Select your provider
3. Enter your API key
4. Choose a model
5. Test the connection
6. Save configuration

## Security Notes

- API keys are encrypted at rest
- Keys are never logged or exposed
- Use environment variables in production
    `.trim(),
    relatedTopics: ['quick-start'],
  },
  {
    id: 'workspace-settings',
    title: 'Workspace Settings',
    category: 'settings',
    description: 'Configure your workspace preferences',
    keywords: ['workspace', 'settings', 'preferences', 'organization'],
    content: `
# Workspace Settings

Customize your Gibson workspace.

## General Settings

### Display
- Theme (Light/Dark/System)
- Language preference
- Date and time format
- Number formatting

### Notifications
- Email notifications
- In-app alerts
- Slack integration
- Webhook notifications

## Security Settings

### Authentication
- Session timeout
- Two-factor authentication
- SSO configuration

### Access Control
- Team member roles
- Permission policies
- API key management

## Integration Settings

### External Services
- JIRA integration
- GitHub/GitLab
- Slack/Teams
- Custom webhooks

### Export Options
- Report formats
- Data export schedules
- Retention policies
    `.trim(),
    relatedTopics: ['llm-config'],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    category: 'settings',
    description: 'Master Gibson with keyboard shortcuts',
    keywords: ['keyboard', 'shortcuts', 'hotkeys', 'commands'],
    content: `
# Keyboard Shortcuts

Speed up your day-to-day work with keyboard shortcuts.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Cmd+K\` | Open help panel |
| \`Cmd+/\` | Open command palette |
| \`Cmd+N\` | New mission |
| \`Cmd+S\` | Save current item |
| \`Escape\` | Close modal/panel |

## Navigation

| Shortcut | Action |
|----------|--------|
| \`G M\` | Go to Missions |
| \`G F\` | Go to Findings |
| \`G A\` | Go to Agents |
| \`G G\` | Go to Graph |
| \`G S\` | Go to Settings |

## Mission Controls

| Shortcut | Action |
|----------|--------|
| \`R\` | Run mission |
| \`P\` | Pause mission |
| \`X\` | Stop mission |
| \`D\` | View details |

## Customization

You can customize shortcuts in **Settings > Keyboard Shortcuts**.
    `.trim(),
    relatedTopics: ['workspace-settings'],
  },

  // Additional Getting Started
  {
    id: 'first-scan',
    title: 'Your First Scan',
    category: 'getting-started',
    description: 'Step-by-step guide to running your first security scan',
    keywords: ['first', 'scan', 'tutorial', 'beginner', 'step-by-step'],
    content: `
# Your First Scan

A detailed walkthrough of running your first security scan with Zero Root AI.

## Prerequisites

Before you begin, ensure you have:
- Configured an LLM provider
- A target domain you're authorized to scan

## Step 1: Choose a Template

1. Navigate to **Missions > Templates**
2. Look for "Hello Zero Root AI" or "Basic Web Scan"
3. Click the template to view details

## Step 2: Configure the Mission

1. Enter your target domain
2. Select the Debug Agent (recommended for learning)
3. Set scan depth to "Light" for your first scan
4. Review the estimated duration

## Step 3: Run the Mission

1. Click **Run Mission**
2. Watch the real-time progress
3. Observe agent decisions in the activity log
4. Wait for completion

## Step 4: Review Results

1. Go to **Findings**
2. Filter by this mission
3. Click on each finding to see details
4. Review remediation recommendations

## Next Steps

- Try different templates
- Increase scan depth
- Experiment with other agents
- Create custom missions
    `.trim(),
    relatedTopics: ['quick-start', 'create-mission'],
  },

  // Additional Agents
  {
    id: 'create-agent',
    title: 'Creating Custom Agents',
    category: 'agents',
    description: 'Build your own specialized security agent',
    keywords: ['create', 'custom', 'agent', 'build', 'configure'],
    content: `
# Creating Custom Agents

Build specialized agents for your unique security needs.

## When to Create Custom Agents

- Specific compliance requirements
- Custom security missions
- Integration with internal tools
- Specialized testing scenarios

## Agent Components

### System Prompt
Define the agent's expertise and behavior:
\`\`\`
You are a security specialist focused on API security testing.
Your goal is to identify authentication and authorization issues.
\`\`\`

### Tools
Select which tools the agent can use:
- Network tools
- Web tools
- Analysis tools
- Custom tools

### Constraints
Set operational boundaries:
- Maximum scan depth
- Time limits
- Excluded paths
- Rate limiting

## Creating an Agent

1. Go to **Agents > Create**
2. Enter agent name and description
3. Write the system prompt
4. Select available tools
5. Configure constraints
6. Test with a sample mission
7. Save and deploy

## Best Practices

- Start simple and iterate
- Test thoroughly before production use
- Document agent purpose and limitations
- Review agent behavior regularly
    `.trim(),
    relatedTopics: ['agents-overview', 'tools-overview'],
  },

  // Additional Findings
  {
    id: 'remediation-guide',
    title: 'Remediation Guide',
    category: 'findings',
    description: 'How to fix common security issues',
    keywords: ['remediation', 'fix', 'patch', 'resolve', 'security'],
    content: `
# Remediation Guide

Step-by-step guidance for fixing common security findings.

## Remediation Process

1. **Assess** - Understand the finding
2. **Plan** - Determine the fix approach
3. **Test** - Verify in staging
4. **Deploy** - Apply to production
5. **Verify** - Re-scan to confirm

## Common Fixes

### SSL/TLS Issues
- Update to TLS 1.3
- Use strong cipher suites
- Renew expired certificates
- Enable HSTS

### Security Headers
- Add Content-Security-Policy
- Enable X-Frame-Options
- Set X-Content-Type-Options
- Configure Referrer-Policy

### Authentication Issues
- Implement MFA
- Use secure session management
- Enforce strong passwords
- Add rate limiting

### Input Validation
- Sanitize all inputs
- Use parameterized queries
- Validate on server side
- Encode outputs

## Tracking Progress

Use the **Findings** dashboard to:
- Track remediation status
- Assign to team members
- Set due dates
- Monitor trends
    `.trim(),
    relatedTopics: ['findings-overview'],
  },
];

// ============================================================================
// Content Utilities
// ============================================================================

/**
 * Get help topic by ID
 */
export function getHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === id);
}

/**
 * Get topics by category
 */
export function getTopicsByCategory(category: HelpCategory): HelpTopic[] {
  return HELP_TOPICS.filter((topic) => topic.category === category);
}

/**
 * Get category info
 */
export function getCategoryInfo(category: HelpCategory): HelpCategoryInfo | undefined {
  return HELP_CATEGORIES.find((cat) => cat.id === category);
}

/**
 * Get related topics
 */
export function getRelatedTopics(topicId: string): HelpTopic[] {
  const topic = getHelpTopic(topicId);
  if (!topic?.relatedTopics) return [];

  return topic.relatedTopics
    .map((id) => getHelpTopic(id))
    .filter((t): t is HelpTopic => t !== undefined);
}

/**
 * Get all topic IDs for search indexing
 */
export function getAllTopicIds(): string[] {
  return HELP_TOPICS.map((topic) => topic.id);
}

export default HELP_TOPICS;
