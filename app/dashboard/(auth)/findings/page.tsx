// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { FindingsContent } from '@/components/gibson/findings/FindingsContent';
import { docsUrl } from '@/src/lib/docs-url';

export default function FindingsPage() {
  // Computed server-side: docsUrl reads the chart-provided DOCS_URL, which a
  // client component cannot (dashboard#1036).
  return <FindingsContent docsHref={docsUrl('missions')} />;
}
