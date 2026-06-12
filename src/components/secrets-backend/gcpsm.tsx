"use client";

/**
 * GcpSMForm, per-provider sub-form for GCP Secret Manager.
 *
 * Fields:
 *  - project (non-sensitive): GCP project ID
 *  - region (non-sensitive): optional region (for regional endpoint)
 *  - authMethod (non-sensitive): "service_account" | "workload_identity"
 *  - gcpServiceAccountJson (sensitive): JSON key file (write-only); only
 *    shown when authMethod === "service_account"
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirement 3.
 */

import type { Control } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { BrokerFormValues } from "./types";

const GCP_AUTH_METHODS = [
  { value: "service_account", label: "Service Account JSON" },
  { value: "workload_identity", label: "Workload Identity Federation" },
] as const;

interface GcpSMFormProps {
  control: Control<BrokerFormValues>;
  /** Current auth method value for conditional field rendering. */
  authMethod: string;
}

export function GcpSMForm({ control, authMethod }: GcpSMFormProps) {
  return (
    <div className="space-y-4">
      {/* GCP Project ID */}
      <FormField
        control={control}
        name="project"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              GCP Project ID
              <span className="text-destructive ml-1" aria-label="required">*</span>
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="my-gcp-project"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              The GCP project that hosts your Secret Manager instance.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Region (optional) */}
      <FormField
        control={control}
        name="region"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Region</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="us-central1 (leave blank for global)"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              Optional. Specify for a regional Secret Manager endpoint.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Auth method */}
      <FormField
        control={control}
        name="authMethod"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Auth Method</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue placeholder="Select auth method" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {GCP_AUTH_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Service account JSON, write-only, textarea */}
      {authMethod === "service_account" && (
        <FormField
          control={control}
          name="gcpServiceAccountJson"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">
                Service Account JSON
                <span className="text-destructive ml-1" aria-label="required">*</span>
              </FormLabel>
              <FormControl>
                {/*
                 * Textarea used for JSON paste. The value is treated as
                 * sensitive, it is encoded to bytes before the RPC and never
                 * returned to the client by the daemon.
                 */}
                <Textarea
                  {...field}
                  placeholder={`{\n  "type": "service_account",\n  ...\n}`}
                  className="font-mono text-xs resize-y"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  rows={6}
                />
              </FormControl>
              <FormDescription className="text-xs">
                Paste the contents of your service account JSON key file.
                Write-only, leave blank to keep the stored key.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {authMethod === "workload_identity" && (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
          Workload Identity Federation: Gibson will use the ambient credential
          available in the cluster (e.g., GKE Workload Identity). No key file
          is required.
        </p>
      )}
    </div>
  );
}
