"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteMemberAction } from "@/app/actions/crd/member";
import type { MemberRole } from "@/app/actions/crd/types";

const inviteSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role: z.enum(["member", "admin"], {
    required_error: "Please select a role",
  }),
  message: z.string().max(500).optional(),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  /** Called after a successful invite so the parent can refetch the roster. */
  onInvited?: () => void;
}

export function InviteUserDialog({ open, onOpenChange, tenantId, onInvited }: InviteUserDialogProps) {
  const [pending, setPending] = React.useState(false);
  const [conflictError, setConflictError] = React.useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "member", message: "" },
  });

  async function onSubmit(values: InviteFormValues) {
    setConflictError(null);
    setPending(true);
    try {
      const res = await inviteMemberAction({
        tenantName: tenantId,
        email: values.email,
        role: values.role as MemberRole,
      });
      if (!res.ok) {
        const msg = res.error;
        if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
          setConflictError("This email is already a member of this workspace.");
        } else {
          toast.error(msg);
        }
        return;
      }
      toast.success(`Invitation sent to ${values.email}`);
      form.reset();
      onOpenChange(false);
      onInvited?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invite user.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">Invite User</DialogTitle>
          <DialogDescription>
            Send an invitation to join this workspace.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono">Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="user@example.com"
                      className="font-mono"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {conflictError && (
                    <p className="text-sm text-destructive">{conflictError}</p>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono">Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono">Message (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add a personal note..."
                      className="font-mono min-h-[80px] resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="gap-2">
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <UserPlus className="size-4" />
                    Send Invitation
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
