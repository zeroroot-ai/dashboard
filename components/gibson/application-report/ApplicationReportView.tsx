'use client';

/**
 * ApplicationReportView
 *
 * The per-Application report (dashboard#1157): what is wrong with one
 * Application, how far the fixes have got, which merge requests carried them,
 * and what the model work cost.
 *
 * Encoding notes (the dataviz pass):
 *
 *  - Severity and fix status are both ORDINAL, so each gets a single-hue
 *    sequential ramp rather than a set of categorical hues: severity ramps on
 *    `destructive` (risk intensity), status ramps on `primary` (progress to
 *    done). One hue, light to dark, is the correct encoding for ordered
 *    magnitude, and it needs no new colour: both ramps are opacity steps on an
 *    existing brand token, so the page stays inside the no-hardcoded-colour
 *    invariant.
 *  - Every bar carries its label and its count as text, so identity never
 *    rests on colour alone. That is also what keeps the severity ramp legible
 *    to a colour-blind reader and in forced-colours mode.
 *  - The headline numbers are stat tiles, not charts. A single value is not a
 *    chart.
 *  - The canvas severity palette is deliberately NOT reused here: those hues
 *    are validated against the dark terminal ground, and this page sits on the
 *    light app ground where they would not carry.
 */

import Link from 'next/link';
import { ExternalLink, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUsd } from '@/src/lib/world-traces';
import {
  FINDING_STATUSES,
  REPORT_SEVERITIES,
  type ApplicationReport,
  type FindingStatus,
  type ReportSeverity,
} from '@/src/lib/application-report/report';

// ---------------------------------------------------------------------------
// Ordinal ramps. Opacity steps on one token, most intense first.
// ---------------------------------------------------------------------------

/** Severity: risk intensity, critical strongest. */
const SEVERITY_FILL: Record<ReportSeverity, string> = {
  critical: 'bg-destructive',
  high: 'bg-destructive/75',
  medium: 'bg-destructive/55',
  low: 'bg-destructive/35',
  info: 'bg-destructive/20',
};

const SEVERITY_LABEL: Record<ReportSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

/** Status: progress to done, verified strongest. */
const STATUS_FILL: Record<FindingStatus, string> = {
  verified: 'bg-primary',
  fixed: 'bg-primary/70',
  fixing: 'bg-primary/45',
  open: 'bg-primary/25',
};

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  fixing: 'Fixing',
  fixed: 'Fixed',
  verified: 'Verified',
};

/** Pipeline order, least to most complete, so the bar reads left to right. */
const STATUS_ORDER: FindingStatus[] = ['open', 'fixing', 'fixed', 'verified'];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 font-mono text-3xl text-foreground">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

/**
 * A measure the graph cannot answer yet. It states the gap in plain words
 * rather than rendering a zero, because a zero here would read as "nothing
 * took any time", which is a different and false claim.
 */
function NotMeasurable({ title, reason }: { title: string; reason: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{reason}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBars({
  bySeverity,
  unknown,
}: {
  bySeverity: Record<ReportSeverity, number>;
  unknown: number;
}) {
  const max = Math.max(1, ...REPORT_SEVERITIES.map((s) => bySeverity[s]));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Findings by severity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {REPORT_SEVERITIES.map((s) => {
          const n = bySeverity[s];
          return (
            <div key={s} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {SEVERITY_LABEL[s]}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className={`h-full rounded-sm ${SEVERITY_FILL[s]}`}
                  style={{ width: `${(n / max) * 100}%` }}
                  title={`${SEVERITY_LABEL[s]}: ${n}`}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-sm text-foreground">{n}</span>
            </div>
          );
        })}
        {unknown > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {unknown} finding{unknown === 1 ? '' : 's'} carry no severity and are counted in none of
            the rows above.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FixPipeline({
  byStatus,
  unknown,
  total,
}: {
  byStatus: Record<FindingStatus, number>;
  unknown: number;
  total: number;
}) {
  const counted = FINDING_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Fix pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        {counted === 0 ? (
          <p className="text-sm text-muted-foreground">
            No finding on this application carries a status yet.
          </p>
        ) : (
          <>
            {/* One stacked bar, 2px gaps so adjacent segments stay separate. */}
            <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-sm">
              {STATUS_ORDER.map((s) =>
                byStatus[s] > 0 ? (
                  <div
                    key={s}
                    className={`h-full rounded-sm ${STATUS_FILL[s]}`}
                    style={{ width: `${(byStatus[s] / counted) * 100}%` }}
                    title={`${STATUS_LABEL[s]}: ${byStatus[s]}`}
                  />
                ) : null,
              )}
            </div>
            {/* Legend, always present: four series, each directly labelled. */}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              {STATUS_ORDER.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${STATUS_FILL[s]}`}
                    aria-hidden
                  />
                  <dt className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</dt>
                  <dd className="ml-auto font-mono text-sm text-foreground">{byStatus[s]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              A finding reaches Verified only when a rescan stops seeing it, never because a merge
              request merged.
            </p>
            {unknown > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {unknown} of {total} findings carry no status yet.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VulnerabilityTable({ report }: { report: ApplicationReport }) {
  if (report.vulnerabilities.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Vulnerabilities</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No finding on this application names a vulnerability identity yet.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Vulnerabilities</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Identity</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="text-right">Here</TableHead>
              <TableHead className="text-right">Across the tenant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.vulnerabilities.map((v) => (
              <TableRow key={v.key}>
                <TableCell className="font-mono text-xs">{v.key}</TableCell>
                <TableCell>
                  {v.topSeverity ? (
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-sm ${SEVERITY_FILL[v.topSeverity]}`}
                        aria-hidden
                      />
                      <span className="text-xs">{SEVERITY_LABEL[v.topSeverity]}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Unknown</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{v.findingsHere}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {v.findingsTenantWide}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          One identity is one node for the whole tenant. When the count across the tenant is higher
          than the count here, the same weakness is open on another application too.
        </p>
      </CardContent>
    </Card>
  );
}

function MergeRequestTable({ report }: { report: ApplicationReport }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Merge requests</CardTitle>
      </CardHeader>
      <CardContent>
        {report.mergeRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No merge request has been opened for a finding on this application yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Change</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Findings fixed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.mergeRequests.map((mr) => (
                <TableRow key={mr.key}>
                  <TableCell>
                    {mr.url ? (
                      <Link
                        href={mr.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <span className="font-mono text-xs">{mr.key}</span>
                        <span className="text-sm">{mr.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                      </Link>
                    ) : (
                      <span>
                        <span className="font-mono text-xs">{mr.key}</span>{' '}
                        <span className="text-sm">{mr.title}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {mr.state ? (
                      <Badge variant="outline" className="font-mono text-xs">
                        {mr.state}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {mr.fixesFindings}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The page body
// ---------------------------------------------------------------------------

export function ApplicationReportView({ report }: { report: ApplicationReport }) {
  const app = report.application;

  if (!app) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No application by that name is in this tenant&apos;s graph. An application appears here
            once a mission has observed it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const costHint =
    report.cost.attributedBy === 'scope'
      ? `${report.cost.llmCallCount} model call${report.cost.llmCallCount === 1 ? '' : 's'} in this application's scope`
      : 'This application has no scope recorded, so no spend is attributed to it.';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl text-foreground">{app.name}</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{app.key}</p>
      </header>

      {report.findingCount === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-foreground">Nothing is open on this application.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              No scan has raised a finding against it. The counts, the fix pipeline and the merge
              requests appear here after the first scan mission lands.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Findings" value={String(report.findingCount)} />
            <StatTile
              label="Still open"
              value={String(report.byStatus.open + report.byStatus.fixing)}
              hint="Open plus in progress"
            />
            <StatTile
              label="Merge requests"
              value={String(report.mergeRequests.length)}
              hint={`Fixing ${report.mergeRequests.reduce((n, mr) => n + mr.fixesFindings, 0)} findings`}
            />
            <StatTile
              label="Model spend"
              value={formatUsd(report.cost.estimatedCostUsd)}
              hint={costHint}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SeverityBars bySeverity={report.bySeverity} unknown={report.unknownSeverity} />
            <FixPipeline
              byStatus={report.byStatus}
              unknown={report.unknownStatus}
              total={report.findingCount}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <NotMeasurable title="Median time to verified" reason={report.timeToVerified.reason} />
            <NotMeasurable
              title="Findings opened and verified per day"
              reason={report.timeline.reason}
            />
          </div>

          <VulnerabilityTable report={report} />
          <MergeRequestTable report={report} />
        </>
      )}
    </div>
  );
}
