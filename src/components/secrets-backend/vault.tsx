"use client";

/**
 * VaultForm — per-provider sub-form for HashiCorp Vault (BYO).
 *
 * Fields:
 *  - address (non-sensitive): Vault server URL
 *  - namespaceOrPath (non-sensitive): Vault Enterprise namespace or
 *    Community path-prefix
 *  - mount (non-sensitive): KV v2 mount path
 *  - authMethod (non-sensitive): "token" | "approle" | "jwt" |
 *    "kubernetes" | "aws_iam"
 *  - vaultToken (sensitive): used only when authMethod === "token"
 *  - approleRoleId (non-sensitive): used only when authMethod === "approle"
 *  - approleSecretId (sensitive): used only when authMethod === "approle"
 *
 * Sensitive fields use type="password" autoComplete="off" and are cleared on
 * parent-driven form reset. They are never held in React state beyond the
 * react-hook-form store (which is wiped on reset).
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirement 3.
 */

import type { Control, UseFormRegister } from "react-hook-form";
import {
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

import type { BrokerFormValues } from "./types";

const VAULT_AUTH_METHODS = [
  { value: "token", label: "Token" },
  { value: "approle", label: "AppRole" },
  { value: "jwt", label: "JWT / OIDC" },
  { value: "kubernetes", label: "Kubernetes" },
  { value: "aws_iam", label: "AWS IAM" },
] as const;

interface VaultFormProps {
  control: Control<BrokerFormValues>;
  register: UseFormRegister<BrokerFormValues>;
  /** Current auth method value for conditional field rendering. */
  authMethod: string;
}

export function VaultForm({ control, authMethod }: VaultFormProps) {
  return (
    <div className="space-y-4">
      {/* Address */}
      <FormField
        control={control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Vault Address</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="https://vault.example.com:8200"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              The URL of your Vault server including scheme and port.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Namespace / path prefix */}
      <FormField
        control={control}
        name="namespaceOrPath"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Namespace / Path Prefix</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="admin/my-tenant"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              Vault Enterprise namespace or Community KV path prefix (optional).
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* KV mount */}
      <FormField
        control={control}
        name="mount"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">KV Mount</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="secret"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              The KV v2 secrets engine mount path (default: secret).
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Auth method selector */}
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
                {VAULT_AUTH_METHODS.map((m) => (
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

      {/* Token — only for "token" auth method */}
      {authMethod === "token" && (
        <FormField
          control={control}
          name="vaultToken"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">
                Vault Token
                <span className="text-destructive ml-1" aria-label="required">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  placeholder="hvs.••••••••"
                  className="font-mono text-xs"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </FormControl>
              <FormDescription className="text-xs">
                Write-only. If a token is already configured the field is empty;
                submit only if you want to replace it.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {/* AppRole fields */}
      {authMethod === "approle" && (
        <>
          <FormField
            control={control}
            name="approleRoleId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">
                  Role ID
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
          <FormField
            control={control}
            name="approleSecretId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">
                  Secret ID
                  <span className="text-destructive ml-1" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    placeholder="••••••••"
                    className="font-mono text-xs"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  Write-only. Submit only if you want to replace the stored value.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </div>
  );
}
