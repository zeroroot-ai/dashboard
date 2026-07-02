'use client';

/**
 * RegisterAgentForm, Client Component for the "Register Agent" page.
 *
 * Spec: unified-identity-and-authorization Phase 4 (R1.4, R9.7, R9.8).
 *
 * Two states:
 *   1. The default form (name + optional description), POSTs to
 *      /api/agents/register on submit.
 *   2. After a successful provision, the form is replaced by a one-time
 *      credential panel showing the bootstrap token and the pre-filled
 *      `gibson component register …` command.
 *
 * Under the unified-identity model (ADR-0045, gibson#670) a component's
 * sole credential is a one-time, daemon-signed Capability-Grant
 * `bootstrapToken`, not an OAuth2 client_id/client_secret pair.
 *
 * The credential panel hides the token behind a show/hide toggle by
 * default, surfaces a "Save this token now" warning, and yields back to
 * the empty form once the admin clicks "I have saved it".
 */

import { useState } from 'react';
import { Eye, EyeOff, Copy, Check, AlertTriangle } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

// ---------------------------------------------------------------------------
// Wire types, mirror RegisterAgentResponseBody on the server side
// ---------------------------------------------------------------------------

interface Credentials {
  bootstrapToken: string;
  gibsonUrl: string;
  enrollCommand: string;
}

interface ApiError {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard primitive
// ---------------------------------------------------------------------------

/**
 * Inline copy button. Switches to a checkmark for 1.5s on success so the
 * admin gets visible feedback that the value reached their clipboard.
 * Sized to sit alongside an Input field without disturbing the row.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. Safari over plain HTTP), fall
      // through silently. The value is still selectable in the field.
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// One-time credential panel
// ---------------------------------------------------------------------------

function CredentialPanel({
  credentials,
  onAcknowledge,
}: {
  credentials: Credentials;
  onAcknowledge: () => void;
}) {
  const [secretVisible, setSecretVisible] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent credentials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Save this token now</AlertTitle>
          <AlertDescription>
            The bootstrap token is single-use and cannot be viewed again.
            If you lose it, you must register a new agent.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="register-agent-bootstrap-token">Bootstrap token</Label>
          <div className="flex gap-2">
            <Input
              id="register-agent-bootstrap-token"
              readOnly
              type={secretVisible ? 'text' : 'password'}
              value={credentials.bootstrapToken}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSecretVisible((v) => !v)}
              aria-label={secretVisible ? 'Hide bootstrap token' : 'Show bootstrap token'}
            >
              {secretVisible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>
            <CopyButton value={credentials.bootstrapToken} label="bootstrap token" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-agent-enroll-command">Enroll command</Label>
          <div className="flex gap-2">
            <Input
              id="register-agent-enroll-command"
              readOnly
              value={credentials.enrollCommand}
              className="font-mono text-xs"
            />
            <CopyButton value={credentials.enrollCommand} label="enroll command" />
          </div>
          <p className="text-xs text-muted-foreground">
            Run this on the agent host to write
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[0.7rem]">
              ~/.gibson/agent/credentials
            </code>
            and verify connectivity.
          </p>
        </div>

        <div className="pt-2">
          <Button type="button" onClick={onAcknowledge}>
            I have saved them
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export function RegisterAgentForm() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  function reset() {
    setName('');
    setDescription('');
    setError(null);
    setCredentials(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error?.message ?? `Request failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as Credentials;
      setCredentials(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  if (credentials) {
    return <CredentialPanel credentials={credentials} onAcknowledge={reset} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New agent</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="register-agent-name">Name</Label>
            <Input
              id="register-agent-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="redteam-1"
              required
              maxLength={63}
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, hyphens. Up to 63 characters.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-agent-description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="register-agent-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Internal red-team agent for nightly runs"
              maxLength={256}
              autoComplete="off"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not register agent</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Button type="submit" disabled={submitting || name.length === 0}>
              {submitting ? 'Registering…' : 'Register agent'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
