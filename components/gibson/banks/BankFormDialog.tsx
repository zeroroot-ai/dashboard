"use client";

/**
 * Create or edit a bank (gibson#1706 lane E1).
 *
 * Create asks for everything the daemon fixes at creation: name, owner,
 * count, login shape, provider configuration, agent, model, jobs-in-flight
 * cap, stale limit and spill policy. Edit changes only what UpdateBank
 * accepts: count, cap, stale limit and spill policy. The login shape, the
 * agent and the model stay as created.
 *
 * Rules the form enforces before submit (they mirror the daemon store):
 * a subscription bank belongs to a person, so the option is absent when
 * the tenant owns the bank; every other shape names a provider
 * configuration, listed by the shape it can serve.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProviders } from "@/src/hooks/useProviders";
import { useCreateBank, useUpdateBank } from "@/src/hooks/useBanks";
import { useActiveTenantRole } from "@/src/hooks/useBankPermissions";
import { loginShapeForProviderType } from "@/src/lib/providers/login-shape";
import { createBankSchema, updateBankSchema, type CreateBankFormValues, type UpdateBankFormValues } from "@/src/lib/banks/schema";
import {
  LOGIN_SHAPES,
  LOGIN_SHAPE_LABEL,
  SPILL_POLICIES,
  SPILL_POLICY_LABEL,
  shapeNeedsProviderConfig,
  type BankView,
  type LoginShapeName,
} from "@/src/lib/banks/view";

const TENANT_ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "owner"]);

interface BankFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode. */
  bank?: BankView;
  onSaved?: (bank: BankView) => void;
}

export function BankFormDialog({ open, onOpenChange, bank, onSaved }: BankFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="bank-form-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm">{bank ? `Edit ${bank.name}` : "New bank"}</DialogTitle>
          <DialogDescription className="text-xs">
            {bank
              ? "Change how many members run and the job policies. The login shape, the agent and the model are fixed at creation."
              : "A bank keeps N Claude Code members running in sandboxes. Anyone with can_send gives them jobs."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          bank ? (
            <EditBankForm bank={bank} onDone={(b) => { onSaved?.(b); onOpenChange(false); }} onCancel={() => onOpenChange(false)} />
          ) : (
            <CreateBankForm onDone={(b) => { onSaved?.(b); onOpenChange(false); }} onCancel={() => onOpenChange(false)} />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateBankForm({ onDone, onCancel }: { onDone: (b: BankView) => void; onCancel: () => void }) {
  const create = useCreateBank();
  const role = useActiveTenantRole();
  const canOwnAsTenant = role !== null && TENANT_ADMIN_ROLES.has(role);
  const { data: providersResp } = useProviders({ includeDisabled: false, includeHealth: false });
  const providers = providersResp?.providers ?? [];

  const form = useForm<CreateBankFormValues>({
    resolver: zodResolver(createBankSchema),
    defaultValues: {
      name: "",
      tenantOwned: false,
      desiredCount: 1,
      loginShape: "subscription",
      providerConfigName: "",
      agentName: "claude",
      model: "",
      maxJobsInFlight: 1,
      staleLimitMinutes: 0,
      spillPolicy: "queue",
    },
    mode: "onChange",
  });

  const tenantOwned = form.watch("tenantOwned");
  const loginShape = form.watch("loginShape") as LoginShapeName;
  const shapes = LOGIN_SHAPES.filter((s) => s !== "subscription" || !tenantOwned);
  const providerOptions = providers.filter((p) => loginShapeForProviderType(p.type) === loginShape);

  // A tenant-owned bank cannot use a subscription: move the shape off it.
  React.useEffect(() => {
    if (tenantOwned && loginShape === "subscription") {
      form.setValue("loginShape", "anthropic_api_key", { shouldValidate: true });
    }
  }, [tenantOwned, loginShape, form]);

  // The provider list depends on the shape; a stale pick must not survive.
  React.useEffect(() => {
    const current = form.getValues("providerConfigName");
    if (current && !providerOptions.some((p) => p.name === current)) {
      form.setValue("providerConfigName", "", { shouldValidate: true });
    }
  }, [loginShape, providerOptions, form]);

  function submit(values: CreateBankFormValues) {
    create.mutate(values, {
      onSuccess: (b) => {
        toast.success(`Bank ${b.name} created`);
        onDone(b);
      },
      onError: (err) => toast.error("Failed to create bank", { description: err.message }),
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-3" data-testid="bank-create-form">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="fix-crew" className="font-mono text-xs" autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tenantOwned"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Owner</FormLabel>
              <Select
                value={field.value ? "tenant" : "me"}
                onValueChange={(v) => field.onChange(v === "tenant")}
              >
                <FormControl>
                  <SelectTrigger className="text-xs" aria-label="Owner" data-testid="bank-owner-select">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="me" className="text-xs">Me</SelectItem>
                  {canOwnAsTenant ? (
                    <SelectItem value="tenant" className="text-xs">The tenant</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <FormDescription className="text-xs">
                {field.value
                  ? "Every tenant admin manages this bank. It runs on a tenant provider configuration."
                  : "You manage this bank. It can sign in on your subscription."}
              </FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="loginShape"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Login shape</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="text-xs" aria-label="Login shape" data-testid="bank-shape-select">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {shapes.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs" data-testid={`shape-option-${s}`}>
                      {LOGIN_SHAPE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {shapeNeedsProviderConfig(loginShape) ? (
          <FormField
            control={form.control}
            name="providerConfigName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Provider configuration</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-xs" aria-label="Provider configuration" data-testid="bank-provider-select">
                      <SelectValue placeholder={providerOptions.length === 0 ? "No configuration serves this shape" : "Pick a configuration"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {providerOptions.map((p) => (
                      <SelectItem key={p.name} value={p.name} className="text-xs" data-testid={`provider-option-${p.name}`}>
                        {p.displayName || p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  Only configurations of the matching provider type are listed. Add one under Settings, Providers.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="desiredCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Members</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={0} className="font-mono text-xs" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maxJobsInFlight"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Jobs in flight per member</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={0} className="font-mono text-xs" />
                </FormControl>
                <FormDescription className="text-xs">Zero means the daemon default.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="agentName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Agent</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="claude" className="font-mono text-xs" autoComplete="off" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Model</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="agent default" className="font-mono text-xs" autoComplete="off" />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <PolicyFields control={form.control} />

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" className="text-xs" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="text-xs" disabled={create.isPending} data-testid="bank-create-submit">
            {create.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
            Create bank
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function EditBankForm({ bank, onDone, onCancel }: { bank: BankView; onDone: (b: BankView) => void; onCancel: () => void }) {
  const update = useUpdateBank(bank.id);
  const form = useForm<UpdateBankFormValues>({
    resolver: zodResolver(updateBankSchema),
    defaultValues: {
      desiredCount: bank.desiredCount,
      maxJobsInFlight: bank.maxJobsInFlight,
      staleLimitMinutes: bank.staleLimitSeconds ? Math.round(bank.staleLimitSeconds / 60) : 0,
      spillPolicy: bank.spillPolicy,
    },
    mode: "onChange",
  });

  function submit(values: UpdateBankFormValues) {
    update.mutate(values, {
      onSuccess: (b) => {
        toast.success(`Bank ${b.name} updated`);
        onDone(b);
      },
      onError: (err) => toast.error("Failed to update bank", { description: err.message }),
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-3" data-testid="bank-edit-form">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="desiredCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Members</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={0} className="font-mono text-xs" />
                </FormControl>
                <FormDescription className="text-xs">The daemon launches or drains members to reach it.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maxJobsInFlight"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Jobs in flight per member</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={0} className="font-mono text-xs" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <PolicyFields control={form.control} />
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" className="text-xs" onClick={onCancel} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="text-xs" disabled={update.isPending} data-testid="bank-edit-submit">
            {update.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Shared policy fields
// ---------------------------------------------------------------------------

type PolicyControl = Parameters<typeof FormField<CreateBankFormValues, "spillPolicy">>[0]["control"]
  | Parameters<typeof FormField<UpdateBankFormValues, "spillPolicy">>[0]["control"];

function PolicyFields({ control }: { control: PolicyControl }) {
  // Both forms carry the same two policy fields with the same names, so one
  // component renders them. The cast keeps react-hook-form's generic happy
  // without a second copy of the markup.
  const c = control as Parameters<typeof FormField<UpdateBankFormValues, "spillPolicy">>[0]["control"];
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField
        control={c}
        name="staleLimitMinutes"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Stale limit (minutes)</FormLabel>
            <FormControl>
              <Input {...field} type="number" min={0} className="font-mono text-xs" />
            </FormControl>
            <FormDescription className="text-xs">A job idle past it closes as abandoned. Zero means the daemon default.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={c}
        name="spillPolicy"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">When no member is free</FormLabel>
            <Select value={field.value ?? "queue"} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="text-xs" aria-label="Spill policy" data-testid="bank-spill-select">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {SPILL_POLICIES.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {SPILL_POLICY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
