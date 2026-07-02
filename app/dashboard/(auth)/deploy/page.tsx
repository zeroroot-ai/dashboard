import { Suspense } from 'react';
import { DeployDispatcher } from '@/components/gibson/deploy';

export function generateMetadata() {
  return { title: 'Deploy Component - Zero Root AI' };
}

export default function DeployPage() {
  return (
    <Suspense>
      <DeployDispatcher />
    </Suspense>
  );
}
