import { Suspense } from 'react';
import { DeployDispatcher } from '@/components/gibson/deploy';

export function generateMetadata() {
  return { title: 'Deploy Component - Zero Day AI' };
}

export default function DeployPage() {
  return (
    <Suspense>
      <DeployDispatcher />
    </Suspense>
  );
}
