// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A panel of the first screen whose backend call does not exist yet. It shows
 * no number and no chart. It says that the data is not available, and which
 * backend work it waits on.
 */
export function UnavailablePanel({
  testId,
  title,
  text,
}: {
  testId: string;
  title: string;
  text: string;
}) {
  return (
    <Card className="glass-hack border-highlight/40" data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" data-testid={`${testId}-unavailable`}>
          {text}
        </p>
      </CardContent>
    </Card>
  );
}
