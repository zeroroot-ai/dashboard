"use client";

/**
 * CliCommandsCard, renders the Settings → CLI command-reference card
 * (PRD dashboard#738, slice S1). Each command is shown with its label, a
 * monospace command line, a copy button, and a one-line description.
 *
 * The command strings come from the pure `buildCliCommands` builder so this
 * component is presentation-only.
 */

import { useState } from "react";
import { Copy, Check } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildCliCommands, type CliCommandSetInput } from "@/src/lib/cli/commands";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API unavailable; the command stays selectable */
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      aria-label={`Copy ${label} command`}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}

export function CliCommandsCard({ tenantSlug, gibsonUrl }: CliCommandSetInput) {
  const commands = buildCliCommands({ tenantSlug, gibsonUrl });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connect the CLI</CardTitle>
        <CardDescription>
          Install the <code>gibson</code> CLI, then run these commands to sign
          in to this tenant and check an agent, tool, or plugin in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {commands.map((cmd) => (
          <div key={cmd.label} className="space-y-1.5">
            <p className="text-sm font-medium">{cmd.label}</p>
            <div className="flex items-center gap-2">
              <code className="bg-muted text-foreground flex-1 overflow-x-auto whitespace-pre rounded-md px-3 py-2 font-mono text-sm">
                {cmd.command}
              </code>
              <CopyButton value={cmd.command} label={cmd.label} />
            </div>
            <p className="text-muted-foreground text-sm">{cmd.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
