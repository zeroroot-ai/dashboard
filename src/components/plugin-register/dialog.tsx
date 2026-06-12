"use client";

/**
 * PluginRegisterDialog
 *
 * Wraps the PluginRegisterWizard in a Shadcn Dialog. Closes and resets the
 * wizard state when the dialog is dismissed (either by the X button, pressing
 * Escape, or clicking outside, standard Radix Dialog behaviour).
 *
 * Import this from the plugins page to add the "Add Plugin" button:
 *
 *   import { PluginRegisterDialog } from
 *     "@/src/components/plugin-register/dialog";
 *
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { PluginRegisterWizard } from "./wizard";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PluginRegisterDialogProps {
  /** Optional callback fired after successful registration + Done click. */
  onRegistered?: () => void;
  /** Disables the trigger button. E.g. when the user lacks tenant_admin. */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// PluginRegisterDialog
// ---------------------------------------------------------------------------

export function PluginRegisterDialog({
  onRegistered,
  disabled,
}: PluginRegisterDialogProps) {
  const [open, setOpen] = useState(false);

  function handleDone() {
    setOpen(false);
    onRegistered?.();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <PlusIcon className="mr-1.5 size-3.5" aria-hidden="true" />
          Add plugin
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        aria-describedby="plugin-register-dialog-description"
      >
        <DialogHeader>
          <DialogTitle>Register a plugin</DialogTitle>
          <DialogDescription id="plugin-register-dialog-description">
            Upload a plugin manifest, configure secret bindings, and receive
            the bootstrap token to enroll the plugin on its host.
          </DialogDescription>
        </DialogHeader>
        {/* Re-mount the wizard fresh each time the dialog opens */}
        {open && <PluginRegisterWizard onClose={handleDone} />}
      </DialogContent>
    </Dialog>
  );
}
