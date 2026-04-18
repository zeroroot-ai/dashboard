/**
 * Mission Templates API Route
 *
 * GET /api/missions/templates
 *
 * Lists available mission templates with optional filtering.
 * Returns template metadata (not full YAML content).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import type { MissionTemplate, TemplateCategory } from '@/src/types/mission-creation';

// ============================================================================
// Built-in Templates (would come from database in production)
// ============================================================================

const BUILT_IN_TEMPLATES: MissionTemplate[] = [
  {
    id: 'web-app-scan',
    name: 'Web Application Security Scan',
    description: 'Comprehensive security assessment of web applications including OWASP Top 10 vulnerabilities, authentication testing, and API endpoint discovery.',
    category: 'web',
    tags: ['owasp', 'xss', 'sqli', 'authentication', 'comprehensive'],
    yamlContent: `name: Web App Security Scan - \${TARGET_NAME}
description: Security assessment of \${TARGET_URL}

scope:
  seeds:
    - type: url
      value: \${TARGET_URL}
  include:
    - "\${TARGET_DOMAIN}/*"
  depth: 3
  maxTargets: 1000

mission:
  type: sequential
  steps:
    - id: discovery
      type: agent
      agent: web-crawler
      task: "Discover all pages and endpoints on the target"
    - id: vulnerability-scan
      type: agent
      agent: vulnerability-scanner
      task: "Scan for common web vulnerabilities"
      onSuccess: reporting

guardrails:
  maxTokens: 500000
  rateLimit:
    requestsPerMinute: 60
  requireConfirmation:
    - destructive

reporting:
  formats:
    - json
    - html
  severityThreshold: low
`,
    variables: [
      { name: 'TARGET_NAME', type: 'string', label: 'Target Name', description: 'Friendly name for the target', required: true, placeholder: 'My Web App' },
      { name: 'TARGET_URL', type: 'url', label: 'Target URL', description: 'Base URL of the web application', required: true, placeholder: 'https://example.com' },
      { name: 'TARGET_DOMAIN', type: 'string', label: 'Target Domain', description: 'Domain for scope filtering', required: true, placeholder: 'example.com' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    usageCount: 1250,
  },
  {
    id: 'api-security-test',
    name: 'API Security Testing',
    description: 'Test REST and GraphQL APIs for security vulnerabilities, authentication bypasses, and data exposure.',
    category: 'api',
    tags: ['rest', 'graphql', 'authentication', 'authorization', 'api'],
    yamlContent: `name: API Security Test - \${API_NAME}
description: Security testing of \${API_BASE_URL}

scope:
  seeds:
    - type: api
      value: \${API_BASE_URL}
  include:
    - "\${API_BASE_URL}/*"

mission:
  type: sequential
  steps:
    - id: api-discovery
      type: agent
      agent: api-mapper
      task: "Map all API endpoints and methods"
    - id: auth-test
      type: agent
      agent: auth-tester
      task: "Test authentication and authorization"
    - id: injection-test
      type: agent
      agent: injection-scanner
      task: "Test for injection vulnerabilities"

guardrails:
  maxTokens: 300000
  rateLimit:
    requestsPerMinute: 30
  allowedAgents:
    - api-mapper
    - auth-tester
    - injection-scanner

reporting:
  formats:
    - json
    - sarif
  severityThreshold: medium
`,
    variables: [
      { name: 'API_NAME', type: 'string', label: 'API Name', description: 'Name of the API', required: true, placeholder: 'My API' },
      { name: 'API_BASE_URL', type: 'url', label: 'API Base URL', description: 'Base URL of the API', required: true, placeholder: 'https://api.example.com/v1' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    usageCount: 890,
  },
  {
    id: 'network-discovery',
    name: 'Network Discovery & Mapping',
    description: 'Discover and map network infrastructure, identify open ports, services, and potential attack vectors.',
    category: 'network',
    tags: ['network', 'ports', 'services', 'infrastructure', 'discovery'],
    yamlContent: `name: Network Discovery - \${NETWORK_NAME}
description: Network reconnaissance of \${TARGET_RANGE}

scope:
  seeds:
    - type: cidr
      value: \${TARGET_RANGE}
  maxTargets: 256

mission:
  type: sequential
  steps:
    - id: host-discovery
      type: agent
      agent: network-scanner
      task: "Discover live hosts in the network"
    - id: port-scan
      type: agent
      agent: port-scanner
      task: "Scan discovered hosts for open ports"
    - id: service-enum
      type: agent
      agent: service-enumerator
      task: "Enumerate services on open ports"

guardrails:
  maxTokens: 200000
  rateLimit:
    requestsPerMinute: 100
  requireConfirmation:
    - external

reporting:
  formats:
    - json
    - csv
  severityThreshold: info
`,
    variables: [
      { name: 'NETWORK_NAME', type: 'string', label: 'Network Name', description: 'Friendly name for the network', required: true, placeholder: 'Production Network' },
      { name: 'TARGET_RANGE', type: 'string', label: 'Target CIDR Range', description: 'CIDR range to scan', required: true, placeholder: '192.168.1.0/24' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    usageCount: 670,
  },
  {
    id: 'cloud-security-audit',
    name: 'Cloud Security Audit',
    description: 'Assess cloud infrastructure security including misconfigurations, exposed resources, and IAM issues.',
    category: 'cloud',
    tags: ['aws', 'azure', 'gcp', 'cloud', 'misconfiguration', 'iam'],
    yamlContent: `name: Cloud Security Audit - \${CLOUD_ACCOUNT_NAME}
description: Security audit of \${CLOUD_PROVIDER} account

scope:
  seeds:
    - type: domain
      value: \${CLOUD_DOMAIN}
  include:
    - "\${CLOUD_DOMAIN}/*"

mission:
  type: parallel
  agents:
    - name: cloud-config-scanner
      task: "Scan for cloud misconfigurations"
    - name: iam-analyzer
      task: "Analyze IAM policies and permissions"
    - name: public-exposure-scanner
      task: "Identify publicly exposed resources"

guardrails:
  maxTokens: 400000
  rateLimit:
    requestsPerMinute: 50
  sandboxMode: true

reporting:
  formats:
    - json
    - html
    - pdf
  severityThreshold: low
`,
    variables: [
      { name: 'CLOUD_ACCOUNT_NAME', type: 'string', label: 'Account Name', description: 'Cloud account identifier', required: true, placeholder: 'Production AWS' },
      { name: 'CLOUD_PROVIDER', type: 'enum', label: 'Cloud Provider', description: 'Cloud service provider', required: true, options: ['AWS', 'Azure', 'GCP'] },
      { name: 'CLOUD_DOMAIN', type: 'string', label: 'Cloud Domain', description: 'Associated domain', required: false, placeholder: 'mycompany.cloud' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    usageCount: 540,
  },
  {
    id: 'repo-secret-scan',
    name: 'Repository Secret Scanner',
    description: 'Scan code repositories for exposed secrets, API keys, credentials, and sensitive data.',
    category: 'repository',
    tags: ['secrets', 'credentials', 'api-keys', 'git', 'code-review'],
    yamlContent: `name: Secret Scan - \${REPO_NAME}
description: Scan \${REPO_URL} for exposed secrets

scope:
  seeds:
    - type: repository
      value: \${REPO_URL}

mission:
  type: sequential
  steps:
    - id: clone
      type: tool
      tool: git-clone
      parameters:
        url: \${REPO_URL}
        depth: \${SCAN_DEPTH}
    - id: secret-scan
      type: agent
      agent: secret-scanner
      task: "Scan repository for secrets and credentials"
    - id: dependency-check
      type: agent
      agent: dependency-scanner
      task: "Check for vulnerable dependencies"

guardrails:
  maxTokens: 250000
  sandboxMode: true
  blockedTools:
    - shell-executor

reporting:
  formats:
    - json
    - sarif
  severityThreshold: high
`,
    variables: [
      { name: 'REPO_NAME', type: 'string', label: 'Repository Name', description: 'Name of the repository', required: true, placeholder: 'my-app' },
      { name: 'REPO_URL', type: 'url', label: 'Repository URL', description: 'Git repository URL', required: true, placeholder: 'https://github.com/org/repo' },
      { name: 'SCAN_DEPTH', type: 'number', label: 'Scan Depth', description: 'Git history depth to scan', required: false, defaultValue: '100' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    usageCount: 420,
  },
];

// ============================================================================
// Handler
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as TemplateCategory | null;
    const query = searchParams.get('query');
    const tags = searchParams.get('tags')?.split(',').filter(Boolean);

    // Filter templates
    let templates = [...BUILT_IN_TEMPLATES];

    // Filter by category
    if (category) {
      templates = templates.filter((t) => t.category === category);
    }

    // Filter by search query
    if (query) {
      const q = query.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      templates = templates.filter((t) =>
        tags.every((searchTag) =>
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(searchTag.toLowerCase()))
        )
      );
    }

    // Return metadata only (strip yamlContent for listing)
    const response = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      tags: t.tags,
      variables: t.variables,
      isBuiltIn: t.isBuiltIn,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      usageCount: t.usageCount,
    }));

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Templates] Error fetching templates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}
