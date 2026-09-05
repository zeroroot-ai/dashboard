/**
 * Server Component shell for the "Register Agent" page.
 *
 * Spec: unified-identity-and-authorization Phase 4 (R1.4, R9.7, R9.8).
 *
 * This file is intentionally tiny, all interactivity lives in the
 * Client Component `RegisterAgentForm`. Keeping the route entry as a
 * Server Component matches the rest of the dashboard's
 * `app/dashboard/(auth)/...` shape and avoids shipping the wrapper
 * code as part of the client bundle.
 */

import { RegisterAgentForm } from '@/components/gibson/agents/RegisterAgentForm';

export default function RegisterAgentPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          Register Agent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provision a new agent identity. The credential pair is shown
          exactly once, store it before leaving this page.
        </p>
      </div>
      <RegisterAgentForm />
    </div>
  );
}
