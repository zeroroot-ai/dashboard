"use client";

/**
 * The sign-in relay panel for a member at NEEDS_SIGN_IN (gibson#1706 lane
 * E2, epic decision 8). Visible to the bank owner only, because the
 * subscription is theirs: the bank page renders it when `owner` holds.
 *
 * The flow: Sign in starts it; the panel shows the URL as a link with a copy
 * button; when the flow asks for the code, a paste field appears; the code
 * goes back to the sandbox; the panel shows done or the error. The sign-in
 * completes on claude.ai and ZeroRoot never sees the token.
 */

import * as React from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSignInRelay } from "@/src/hooks/useSignInRelay";
import type { MemberView } from "@/src/lib/banks/view";
import { shortId } from "@/src/lib/agent-console/stream-json";

export function SignInAction({ bankId, member }: { bankId: string; member: MemberView }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="member-sign-in">
        <KeyRoundIcon className="size-3" />
        Sign in
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="sign-in-panel">
          <DialogHeader>
            <DialogTitle className="text-sm">Sign in member {shortId(member.id)}</DialogTitle>
            <DialogDescription className="text-xs">
              The member runs the Anthropic sign-in inside its sandbox. Open the link, sign in on claude.ai, and paste the code back here. ZeroRoot never sees the token.
            </DialogDescription>
          </DialogHeader>
          {open ? <SignInFlow bankId={bankId} memberId={member.id} onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SignInFlow({ bankId, memberId, onClose }: { bankId: string; memberId: string; onClose: () => void }) {
  const relay = useSignInRelay(bankId, memberId);
  const [code, setCode] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(relay.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable; the link stays visible.
    }
  }

  const busy = relay.phase === "starting" || relay.phase === "submitting";

  return (
    <div className="space-y-3 text-xs" data-testid="sign-in-flow" data-phase={relay.phase}>
      {relay.phase === "idle" ? (
        <Button type="button" size="sm" className="text-xs" onClick={() => void relay.start()} data-testid="sign-in-start">
          <KeyRoundIcon className="size-3" />
          Start the sign-in
        </Button>
      ) : null}

      {relay.phase === "starting" || relay.phase === "waiting_url" ? (
        <p className="flex items-center gap-2 text-muted-foreground" data-testid="sign-in-waiting">
          <Loader2 className="size-3 animate-spin" />
          Waiting for the sandbox to give the sign-in link.
        </p>
      ) : null}

      {relay.url ? (
        <div className="space-y-1" data-testid="sign-in-url">
          <p className="text-muted-foreground">Open this link and sign in on claude.ai:</p>
          <div className="flex items-center gap-2">
            <a href={relay.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-link underline-offset-2 hover:underline" data-testid="sign-in-link">
              <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{relay.url}</span>
            </a>
            <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={copyUrl} data-testid="sign-in-copy">
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {relay.phase === "code" || relay.phase === "submitting" ? (
        <form
          className="space-y-1"
          data-testid="sign-in-code-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void relay.submitCode(code.trim());
          }}
        >
          <label className="text-muted-foreground" htmlFor="sign-in-code">
            {relay.codePrompt || "Paste the code from claude.ai"}
          </label>
          <div className="flex items-center gap-2">
            <Input id="sign-in-code" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono text-xs" autoComplete="off" spellCheck={false} disabled={busy} data-testid="sign-in-code" />
            <Button type="submit" size="sm" className="text-xs" disabled={busy || code.trim() === ""} data-testid="sign-in-submit">
              {relay.phase === "submitting" ? <Loader2 className="size-3 animate-spin" /> : null}
              Submit code
            </Button>
          </div>
        </form>
      ) : null}

      {relay.phase === "done" ? (
        <p className="flex items-center gap-2 text-primary" data-testid="sign-in-done">
          <CheckIcon className="size-3" />
          Signed in. The member takes jobs now.
        </p>
      ) : null}

      {relay.phase === "error" ? (
        <div className="space-y-2" data-testid="sign-in-error">
          <p className="text-destructive">{relay.error}</p>
          <Button type="button" size="sm" variant="outline" className="text-xs" onClick={() => void relay.start()} data-testid="sign-in-retry">
            Sign in again
          </Button>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" size="sm" variant="outline" className="text-xs" onClick={onClose}>
          {relay.phase === "done" ? "Close" : "Later"}
        </Button>
      </DialogFooter>
    </div>
  );
}
