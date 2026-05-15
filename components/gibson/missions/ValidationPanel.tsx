"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface ValidationError {
  line?: number;
  column?: number;
  message: string;
}

interface ValidationWarning {
  line?: number;
  message: string;
}

interface ValidationPanelProps {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  parsed: Record<string, unknown> | null;
  isValid: boolean;
}

function extractAgentToolNames(parsed: Record<string, unknown>): string {
  const nodes = (parsed.nodes as Record<string, unknown>[] | undefined) ?? [];
  const names = new Set<string>();
  for (const node of nodes) {
    const name = (node.agent ?? node.tool ?? node.plugin) as string | undefined;
    if (name) names.add(name);
  }
  return names.size > 0 ? Array.from(names).join(", ") : "—";
}

function nodeCount(parsed: Record<string, unknown>): number {
  const nodes = (parsed.nodes as unknown[] | undefined) ?? [];
  return nodes.length;
}

export function ValidationPanel({ errors, warnings, parsed, isValid }: ValidationPanelProps) {
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const isEmpty = !hasErrors && !parsed;

  return (
    <div className="space-y-4 h-full">
      {/* Status */}
      <div className="flex items-center gap-2">
        {isValid ? (
          <Badge variant="success">
            <CheckCircle2 className="h-3 w-3" />
            Valid
          </Badge>
        ) : (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3" />
            {errors.length} Error{errors.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Mission preview */}
      {parsed && isValid && (
        <Card className="py-4">
          <CardHeader className="px-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {(parsed.name as string) ?? "Untitled Mission"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 space-y-1 text-xs text-muted-foreground">
            {!!parsed.description && (
              <p>{String(parsed.description).slice(0, 100)}</p>
            )}
            <Separator className="my-2" />
            <p>Nodes: {nodeCount(parsed)}</p>
            <p>Agents / Tools: {extractAgentToolNames(parsed)}</p>
          </CardContent>
        </Card>
      )}

      {/* Errors */}
      {hasErrors && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-destructive uppercase tracking-wide">Errors</p>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  L{err.line}
                </Badge>
                <span className="text-sm">{err.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-alt uppercase tracking-wide">Warnings</p>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {warnings.map((warn, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-alt shrink-0 mt-0.5" />
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  L{warn.line}
                </Badge>
                <span className="text-sm">{warn.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          Write or load a mission YAML to see validation results.
        </p>
      )}
    </div>
  );
}

export default ValidationPanel;
