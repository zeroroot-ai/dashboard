/**
 * Findings Export API Route
 *
 * POST /api/findings/export
 *
 * Exports findings in various formats (JSON, CSV, SARIF, HTML, PDF).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { safeFilenameSchema } from '@/src/lib/api-validation';
import type {
  Finding,
  FindingsExportOptions,
  SARIFReport,
  SARIFResult,
  SARIFRule,
} from '@/src/types';

// ============================================================================
// Types
// ============================================================================

interface ExportRequest extends FindingsExportOptions {
  filters?: {
    severity?: string[];
    type?: string[];
    missionId?: string;
    search?: string;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: ExportRequest = await request.json();
    const {
      format = 'json',
      findingIds,
      filters,
      includeRemediation = true,
      includeEvidence = false,
    } = body;

    // Delegate export to the daemon ExportFindings RPC.
    const { createClient } = await import('@connectrpc/connect');
    const { createGrpcTransport } = await import('@connectrpc/connect-node');
    const { DaemonAdminService } = await import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb');
    const { serverConfig } = await import('@/src/lib/config');

    const transport = createGrpcTransport({ baseUrl: serverConfig.gibsonDaemonUrl });
    const client = createClient(DaemonAdminService, transport);

    const resp = await client.exportFindings({
      tenantId: (session.user as { tenantId?: string }).tenantId ?? '',
      format,
      findingIds: (findingIds as string[] | undefined) ?? [],
      filters: filters ? {
        severity: filters.severity ?? [],
        type: filters.type ?? [],
        missionId: filters.missionId ?? '',
        search: filters.search ?? '',
      } : undefined,
      includeRemediation,
      includeEvidence,
    });

    const contentTypeMap: Record<string, string> = {
      json: 'application/json',
      csv: 'text/csv',
      sarif: 'application/sarif+json',
      html: 'text/html',
    };
    const contentType = contentTypeMap[format] ?? 'application/octet-stream';

    return new NextResponse(Buffer.from(resp.data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${resp.filename}"`,
        'X-Finding-Count': String(resp.count),
      },
    });

  } catch (error) {
    return safeErrorResponse(error, 'Export failed', 500);
  }
}

// ============================================================================
// Export Generators
// ============================================================================

interface ExportOutput {
  data: unknown;
  filename: string;
}

async function generateExport(
  findings: Finding[],
  options: FindingsExportOptions
): Promise<ExportOutput> {
  const timestamp = new Date().toISOString().slice(0, 10);
  const rawFilename = options.filename || `findings-export-${timestamp}`;
  const baseFilename = safeFilenameSchema.parse(rawFilename);

  switch (options.format) {
    case 'json':
      return generateJSONExport(findings, options, baseFilename);
    case 'csv':
      return generateCSVExport(findings, options, baseFilename);
    case 'sarif':
      return generateSARIFExport(findings, options, baseFilename);
    case 'html':
      return generateHTMLExport(findings, options, baseFilename);
    case 'pdf':
      return generatePDFExport(findings, options, baseFilename);
    default:
      return generateJSONExport(findings, options, baseFilename);
  }
}

function generateJSONExport(
  findings: Finding[],
  options: FindingsExportOptions,
  baseFilename: string
): ExportOutput {
  const exportData = {
    exportedAt: new Date().toISOString(),
    totalFindings: findings.length,
    severityCounts: getSeverityCounts(findings),
    findings: findings.map(f => formatFindingForExport(f, options)),
  };

  if (options.groupByMission) {
    const grouped = groupByMission(findings);
    return {
      data: {
        ...exportData,
        findings: undefined,
        missions: Object.entries(grouped).map(([missionId, missionFindings]) => ({
          missionId,
          findingsCount: missionFindings.length,
          findings: missionFindings.map(f => formatFindingForExport(f, options)),
        })),
      },
      filename: `${baseFilename}.json`,
    };
  }

  return {
    data: exportData,
    filename: `${baseFilename}.json`,
  };
}

function generateCSVExport(
  findings: Finding[],
  options: FindingsExportOptions,
  baseFilename: string
): ExportOutput {
  const headers = [
    'ID',
    'Title',
    'Severity',
    'Type',
    'Mission ID',
    'Affected Assets',
    'Description',
    'Discovered At',
    'Taxonomy Framework',
    'Taxonomy Category',
  ];

  if (options.includeRemediation) {
    headers.push('Remediation');
  }

  const rows = findings.map(f => {
    const row = [
      f.id,
      escapeCSV(f.title),
      f.severity,
      f.type,
      f.missionId,
      escapeCSV(f.affectedAssets.join('; ')),
      escapeCSV(f.description),
      f.discoveredAt instanceof Date ? f.discoveredAt.toISOString() : f.discoveredAt,
      f.taxonomy.framework || '',
      f.taxonomy.category || '',
    ];

    if (options.includeRemediation) {
      row.push(escapeCSV(f.remediation || ''));
    }

    return row.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  return {
    data: csv,
    filename: `${baseFilename}.csv`,
  };
}

function generateSARIFExport(
  findings: Finding[],
  options: FindingsExportOptions,
  baseFilename: string
): ExportOutput {
  // Generate unique rules from findings
  const rulesMap = new Map<string, SARIFRule>();
  findings.forEach(f => {
    if (!rulesMap.has(f.type)) {
      rulesMap.set(f.type, {
        id: f.type.toLowerCase().replace(/\s+/g, '-'),
        name: f.type,
        shortDescription: { text: f.type },
        fullDescription: { text: `${f.taxonomy.framework || 'Security'} - ${f.taxonomy.category || f.type}` },
        defaultConfiguration: {
          level: severityToSARIFLevel(f.severity),
        },
      });
    }
  });

  const results: SARIFResult[] = findings.map(f => ({
    ruleId: f.type.toLowerCase().replace(/\s+/g, '-'),
    level: severityToSARIFLevel(f.severity),
    message: { text: `${f.title}\n\n${f.description}` },
    locations: f.affectedAssets.map(asset => ({
      physicalLocation: {
        artifactLocation: { uri: asset },
      },
    })),
    fingerprints: {
      'gibson/finding/id': f.id,
    },
  }));

  const sarif: SARIFReport = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Gibson Security Scanner',
            version: '1.0.0',
            informationUri: 'https://gibson.ai',
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  };

  return {
    data: sarif,
    filename: `${baseFilename}.sarif`,
  };
}

function generateHTMLExport(
  findings: Finding[],
  options: FindingsExportOptions,
  baseFilename: string
): ExportOutput {
  const severityCounts = getSeverityCounts(findings);
  const timestamp = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Findings Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { color: #1a1a1a; margin-bottom: 0.5rem; }
    h2 { color: #333; margin-top: 2rem; margin-bottom: 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    .meta { color: #6b7280; margin-bottom: 2rem; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .summary-card { padding: 1rem; border-radius: 8px; text-align: center; }
    .summary-card.critical { background: #fef2f2; border: 1px solid #fecaca; }
    .summary-card.high { background: #fff7ed; border: 1px solid #fed7aa; }
    .summary-card.medium { background: #fefce8; border: 1px solid #fef08a; }
    .summary-card.low { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .summary-card.info { background: #eff6ff; border: 1px solid #bfdbfe; }
    .summary-card .count { font-size: 2rem; font-weight: bold; }
    .summary-card .label { font-size: 0.875rem; color: #6b7280; text-transform: uppercase; }
    .finding { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .finding-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
    .finding-title { font-size: 1.125rem; font-weight: 600; }
    .severity { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .severity.critical { background: #dc2626; color: white; }
    .severity.high { background: #ea580c; color: white; }
    .severity.medium { background: #ca8a04; color: white; }
    .severity.low { background: #16a34a; color: white; }
    .severity.info { background: #2563eb; color: white; }
    .finding-meta { color: #6b7280; font-size: 0.875rem; margin-bottom: 1rem; }
    .finding-description { margin-bottom: 1rem; }
    .finding-section { margin-top: 1rem; }
    .finding-section-title { font-weight: 600; color: #4b5563; margin-bottom: 0.5rem; }
    .assets-list { list-style: none; }
    .assets-list li { font-family: monospace; background: #f3f4f6; padding: 0.25rem 0.5rem; border-radius: 4px; margin-bottom: 0.25rem; font-size: 0.875rem; }
    .remediation { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 1rem; margin-top: 1rem; }
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>Security Findings Report</h1>
  <p class="meta">Generated on ${new Date(timestamp).toLocaleString()} | Total Findings: ${findings.length}</p>

  ${options.includeExecutiveSummary ? `
  <h2>Executive Summary</h2>
  <div class="summary">
    <div class="summary-card critical">
      <div class="count">${severityCounts.critical}</div>
      <div class="label">Critical</div>
    </div>
    <div class="summary-card high">
      <div class="count">${severityCounts.high}</div>
      <div class="label">High</div>
    </div>
    <div class="summary-card medium">
      <div class="count">${severityCounts.medium}</div>
      <div class="label">Medium</div>
    </div>
    <div class="summary-card low">
      <div class="count">${severityCounts.low}</div>
      <div class="label">Low</div>
    </div>
    <div class="summary-card info">
      <div class="count">${severityCounts.info}</div>
      <div class="label">Info</div>
    </div>
  </div>
  ` : ''}

  <h2>Findings</h2>
  ${findings.map(f => `
  <div class="finding">
    <div class="finding-header">
      <span class="finding-title">${escapeHTML(f.title)}</span>
      <span class="severity ${f.severity}">${f.severity}</span>
    </div>
    <div class="finding-meta">
      <strong>Type:</strong> ${escapeHTML(f.type)} |
      <strong>ID:</strong> ${f.id} |
      <strong>Discovered:</strong> ${f.discoveredAt instanceof Date ? f.discoveredAt.toLocaleString() : f.discoveredAt}
    </div>
    <div class="finding-description">${escapeHTML(f.description)}</div>

    <div class="finding-section">
      <div class="finding-section-title">Affected Assets</div>
      <ul class="assets-list">
        ${f.affectedAssets.map(a => `<li>${escapeHTML(a)}</li>`).join('')}
      </ul>
    </div>

    ${f.taxonomy.framework ? `
    <div class="finding-section">
      <div class="finding-section-title">Classification</div>
      <p>${escapeHTML(f.taxonomy.framework)} - ${escapeHTML(f.taxonomy.category || '')} ${f.taxonomy.subcategory ? `(${escapeHTML(f.taxonomy.subcategory)})` : ''}</p>
    </div>
    ` : ''}

    ${options.includeRemediation && f.remediation ? `
    <div class="remediation">
      <div class="finding-section-title">Remediation</div>
      <p>${escapeHTML(f.remediation)}</p>
    </div>
    ` : ''}
  </div>
  `).join('')}

  <div class="footer">
    <p>Report generated by Gibson Security Platform</p>
  </div>
</body>
</html>`;

  return {
    data: html,
    filename: `${baseFilename}.html`,
  };
}

async function generatePDFExport(
  findings: Finding[],
  options: FindingsExportOptions,
  baseFilename: string
): Promise<ExportOutput> {
  // PDF generation would require a library like puppeteer or pdfkit
  // For now, return HTML that can be printed to PDF
  const htmlExport = generateHTMLExport(findings, options, baseFilename);

  return {
    data: htmlExport.data,
    filename: `${baseFilename}.pdf`,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatFindingForExport(finding: Finding, options: FindingsExportOptions): Partial<Finding> {
  const formatted: Partial<Finding> = {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    type: finding.type,
    description: finding.description,
    affectedAssets: finding.affectedAssets,
    discoveredAt: finding.discoveredAt,
    taxonomy: finding.taxonomy,
  };

  if (options.includeMissionMetadata) {
    formatted.missionId = finding.missionId;
  }

  if (options.includeRemediation) {
    formatted.remediation = finding.remediation;
  }

  if (options.includeEvidence) {
    formatted.evidence = finding.evidence;
  }

  return formatted;
}

function getSeverityCounts(findings: Finding[]): Record<string, number> {
  return findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>);
}

function groupByMission(findings: Finding[]): Record<string, Finding[]> {
  return findings.reduce((acc, f) => {
    if (!acc[f.missionId]) {
      acc[f.missionId] = [];
    }
    acc[f.missionId].push(f);
    return acc;
  }, {} as Record<string, Finding[]>);
}

function severityToSARIFLevel(severity: string): 'error' | 'warning' | 'note' | 'none' {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
    default:
      return 'none';
  }
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
