import { Suspense } from 'react';
import { DeployWizard } from '@/components/gibson/deploy';

export function generateMetadata() {
  return { title: 'Deploy Component - Zero Day AI' };
}

export default function DeployPage() {
  return (
    <Suspense>
      <DeployWizard />
    </Suspense>
  );
}
