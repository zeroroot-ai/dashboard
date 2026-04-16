import { Suspense } from 'react';
import { DeployWizard } from '@/components/gibson/deploy';

export function generateMetadata() {
  return { title: 'Deploy Component - Gibson' };
}

export default function DeployPage() {
  return (
    <Suspense>
      <DeployWizard />
    </Suspense>
  );
}
