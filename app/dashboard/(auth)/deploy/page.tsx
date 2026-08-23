import { Suspense } from 'react';
import { DeployDispatcher } from '@/components/gibson/deploy';
import { docsUrl } from '@/src/lib/docs-url';

export function generateMetadata() {
  return { title: 'Deploy Component - Zero Root AI' };
}

export default function DeployPage() {
  // Computed server-side: docsUrl reads the chart-provided DOCS_URL, which a
  // client component cannot (dashboard#1036).
  return (
    <Suspense>
      <DeployDispatcher
        docsPluginsHref={docsUrl('plugins')}
        docsComponentBootstrapHref={docsUrl('component-bootstrap')}
      />
    </Suspense>
  );
}
