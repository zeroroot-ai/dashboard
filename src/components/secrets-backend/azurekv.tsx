"use client";

/**
 * AzureKVForm — per-provider sub-form for Azure Key Vault.
 *
 * Fields:
 *  - address (non-sensitive): vault URL
 *  - tenantIdExternal (non-sensitive): Azure AD tenant ID
 *  - clientId (non-sensitive): service principal or managed identity client ID
 *  - authMethod (non-sensitive): "service_principal" | "workload_identity"
 *  - azureClientSecret (sensitive): service principal secret (write-only);
 *    only shown when authMethod === "service_principal"
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
import { RevealableInput } from "@/components/ui/revealable-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { BrokerFormValues } from "./types";

const AZURE_AUTH_METHODS = [
  { value: "service_principal", label: "Service Principal" },
  { value: "workload_identity", label: "Workload Identity" },
] as const;

interface AzureKVFormProps {
  control: Control<BrokerFormValues>;
  /** Current auth method value for conditional field rendering. */
  authMethod: string;
}

export function AzureKVForm({ control, authMethod }: AzureKVFormProps) {
  return (
    <div className="space-y-4">
      {/* Vault URL */}
      <FormField
        control={control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              Vault URL
              <span className="text-destructive ml-1" aria-label="required">*</span>
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="https://my-vault.vault.azure.net"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              The full URL of your Azure Key Vault instance.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Azure AD Tenant ID */}
      <FormField
        control={control}
        name="tenantIdExternal"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              Azure AD Tenant ID
              <span className="text-destructive ml-1" aria-label="required">*</span>
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Client ID */}
      <FormField
        control={control}
        name="clientId"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              Client ID
              <span className="text-destructive ml-1" aria-label="required">*</span>
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              Application (client) ID of the service principal or managed
              identity.
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
                {AZURE_AUTH_METHODS.map((m) => (
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

      {/* Client secret — write-only, only for service principal */}
      {authMethod === "service_principal" && (
        <FormField
          control={control}
          name="azureClientSecret"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">
                Client Secret
                <span className="text-destructive ml-1" aria-label="required">*</span>
              </FormLabel>
              <FormControl>
                <RevealableInput
                  {...field}
                  type="password"
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="font-mono text-xs"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </FormControl>
              <FormDescription className="text-xs">
                Service principal client secret. Write-only — leave blank to
                keep the stored value.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {authMethod === "workload_identity" && (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
          Workload Identity: Gibson will use the ambient federated credential
          available in the cluster. No client secret is required.
        </p>
      )}
    </div>
  );
}
