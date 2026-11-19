// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateProvider } from "@/src/hooks/useProviderMutations";
import { providerQueryKeys } from "@/src/hooks/useProviders";
import type { SupportedProviderDescriptor } from "@/src/lib/gibson-client-types";

import { CredentialsForm } from "./ProviderWizard";

/**
 * EditCredentialsDialog. The one dialog that changes the credentials of a
 * saved provider. The provider card and the test step of the wizard open it.
 * A blank secret field keeps the stored value.
 */
export function EditCredentialsDialog({
  descriptor,
  providerName,
  displayName,
  open,
  onOpenChange,
  onSaved,
}: {
  descriptor: SupportedProviderDescriptor;
  providerName: string;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the daemon saved the new credentials. */
  onSaved?: () => void;
}) {
  const { mutate: updateProvider, isPending: isUpdating, reset: resetUpdate } = useUpdateProvider();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = React.useState<Record<string, string>>({});

  function onSave() {
    updateProvider(
      { name: providerName, config: { credentials } },
      {
        onSuccess: () => {
          toast.success(`${displayName} credentials updated`);
          // The secret values leave the state of the form with the save.
          setCredentials({});
          resetUpdate();
          onOpenChange(false);
          void queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
          onSaved?.();
        },
        onError: (err) => {
          toast.error(`Failed to update ${displayName} credentials`, {
            description: err.message,
          });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit {displayName} credentials</DialogTitle>
          <DialogDescription className="text-xs">
            Leave secret fields blank to keep the existing stored value. Save, then use Test connection on the card.
          </DialogDescription>
        </DialogHeader>
        <CredentialsForm
          descriptor={descriptor}
          providerName={providerName}
          secretFieldPlaceholder="Leave blank to keep existing value"
          onValuesChange={(vals) => setCredentials(vals.credentials)}
        />
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={isUpdating} className="text-xs">
            {isUpdating && <Loader2 className="size-3 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
