"use client";

/**
 * LinkedAccountsButtons
 *
 * Client component for the Link and Unlink buttons in the LinkedAccountsSection.
 * Separated from the server component so interactive state (pendingProvider,
 * router refresh) can use React hooks without tainting the server component tree.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { linkSocialAction } from "@/app/actions/auth/link-social";
import { unlinkSocialAction } from "@/app/actions/auth/unlink-social";
import type { ProviderId } from "@/src/lib/social-providers";

interface LinkedAccountsButtonsProps {
  provider: ProviderId;
  isLinked: boolean;
  /** When true the button must be disabled — user would have no sign-in method left. */
  isLastCredential: boolean;
}

export function LinkedAccountsButtons({
  provider,
  isLinked,
  isLastCredential,
}: LinkedAccountsButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const isDisabled = isPending || busy;

  async function handleLink() {
    setBusy(true);
    try {
      const result = await linkSocialAction({ provider });
      if (result.ok) {
        window.location.assign(result.url);
        return; // page is navigating away
      }
      toast.error(result.message ?? "Could not link account. Please try again.");
    } catch {
      toast.error("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    setBusy(true);
    try {
      const result = await unlinkSocialAction({ provider });
      if (result.ok) {
        // Refresh server component data without a full page reload.
        startTransition(() => {
          router.refresh();
        });
        toast.success("Account unlinked.");
        return;
      }
      if (!result.ok && result.code === "LAST_CREDENTIAL") {
        toast.error("You must keep at least one sign-in method.");
        return;
      }
      toast.error(result.message ?? "Could not unlink account. Please try again.");
    } catch {
      toast.error("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (isLinked) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDisabled || isLastCredential}
        title={isLastCredential ? "You must keep at least one sign-in method" : undefined}
        onClick={handleUnlink}
      >
        {isDisabled ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          "Unlink"
        )}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      onClick={handleLink}
    >
      {isDisabled ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        "Link"
      )}
    </Button>
  );
}
