"use client";

/**
 * AwsSMForm, per-provider sub-form for AWS Secrets Manager.
 *
 * Fields:
 *  - region (non-sensitive): AWS region
 *  - roleArn (non-sensitive): IAM role ARN to assume
 *  - awsExternalId (sensitive): optional STS external ID
 *  - awsAccessKeyId (sensitive): optional static access key (write-only)
 *  - awsSecretAccessKey (sensitive): optional static secret key (write-only)
 *
 * Preferred auth is role-based (no static keys). Static keys are provided
 * as a fallback; the daemon uses the role ARN when both are supplied.
 *
 * Sensitive fields use type="password" autoComplete="off" and are cleared on
 * parent-driven form reset.
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

import type { BrokerFormValues } from "./types";

interface AwsSMFormProps {
  control: Control<BrokerFormValues>;
}

export function AwsSMForm({ control }: AwsSMFormProps) {
  return (
    <div className="space-y-4">
      {/* Region */}
      <FormField
        control={control}
        name="region"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              AWS Region
              <span className="text-destructive ml-1" aria-label="required">*</span>
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="us-east-1"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              The AWS region where your Secrets Manager is deployed.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* IAM Role ARN */}
      <FormField
        control={control}
        name="roleArn"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">IAM Role ARN</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="arn:aws:iam::123456789012:role/GibsonSecretsRole"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </FormControl>
            <FormDescription className="text-xs">
              Role ARN for Gibson to assume. Preferred over static keys.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* External ID */}
      <FormField
        control={control}
        name="awsExternalId"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">External ID</FormLabel>
            <FormControl>
              <RevealableInput
                {...field}
                type="password"
                placeholder="optional STS external ID"
                className="font-mono text-xs"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </FormControl>
            <FormDescription className="text-xs">
              Optional STS AssumeRole external ID for cross-account hardening.
              Write-only.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Static access key, optional fallback */}
      <FormField
        control={control}
        name="awsAccessKeyId"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Access Key ID</FormLabel>
            <FormControl>
              <RevealableInput
                {...field}
                type="password"
                placeholder="AKIA••••••••••••••••"
                className="font-mono text-xs"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </FormControl>
            <FormDescription className="text-xs">
              Static access key, use only when role-based auth is not
              available. Write-only; leave blank to keep the stored value.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Static secret key, optional fallback */}
      <FormField
        control={control}
        name="awsSecretAccessKey"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Secret Access Key</FormLabel>
            <FormControl>
              <RevealableInput
                {...field}
                type="password"
                placeholder="••••••••••••••••••••••••••••••••••••••••"
                className="font-mono text-xs"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </FormControl>
            <FormDescription className="text-xs">
              Static secret key. Write-only; leave blank to keep the stored
              value.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
