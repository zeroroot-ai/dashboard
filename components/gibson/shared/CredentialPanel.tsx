'use client';

/**
 * CredentialPanel, shared one-time credential surface.
 *
 * Lifted from components/gibson/agents/RegisterAgentForm.tsx so the
 * deploy wizard's per-type dispatcher can reuse the same display
 * without duplicating the show/hide toggle, copy buttons, or
 * acknowledgement gating.
 *
 * Spec: component-bootstrap-e2e Requirement 1.
 *
 * Under the unified-identity model (ADR-0045, gibson#670) a component's
 * sole credential is a one-time, daemon-signed Capability-Grant
 * `bootstrapToken`, not an OAuth2 client_id/client_secret pair. This
 * panel mirrors the plugin-enrollment panel
 * (`src/components/plugin-register/enrollment.tsx`).
 *
 * SECURITY: the `credentials.bootstrapToken` value is held in React
 * state in-memory only. It MUST NOT be persisted to sessionStorage,
 * localStorage, or any browser cache.
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

export interface Credentials {
  bootstrapToken: string;
  gibsonUrl: string;
  enrollCommand: string;
}

interface CredentialPanelProps {
  credentials: Credentials;
  /** Title shown in the card header. Defaults to "Component credentials". */
  title?: string;
  /** Called when the admin clicks "I have saved them". */
  onAcknowledge: () => void;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API unavailable; field remains selectable */
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

export function CredentialPanel({
  credentials,
  title = 'Component credentials',
  onAcknowledge,
}: CredentialPanelProps) {
  const [secretVisible, setSecretVisible] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Save this token now</AlertTitle>
          <AlertDescription>
            The bootstrap token is single-use and cannot be viewed again.
            If you lose it, you must register a new component.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="cred-panel-bootstrap-token">Bootstrap token</Label>
          <div className="flex gap-2">
            <Input
              id="cred-panel-bootstrap-token"
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
              {secretVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <CopyButton value={credentials.bootstrapToken} label="bootstrap token" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cred-panel-enroll-command">Enroll command</Label>
          <div className="flex gap-2">
            <Input
              id="cred-panel-enroll-command"
              readOnly
              value={credentials.enrollCommand}
              className="font-mono text-xs"
            />
            <CopyButton value={credentials.enrollCommand} label="enroll command" />
          </div>
          <p className="text-xs text-muted-foreground">
            Run this on the host where the component will run. The CLI
            writes the credentials and verifies connectivity to{' '}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[0.7rem]">
              {credentials.gibsonUrl}
            </code>
            .
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
