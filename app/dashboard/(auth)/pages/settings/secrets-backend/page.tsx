/**
 * Secrets Backend settings page — Server Component.
 *
 * Fetches the current redacted broker config and renders the client-side
 * SecretsBackendForm. RBAC is enforced at two levels:
 *
 *  1. Server level: this page is under the (auth) group; the middleware
 *     ensures the user is authenticated.
 *  2. Component level: the PermissionGate hides the form from non-admins.
 *     The daemon also enforces tenant_admin on every admin RPC (defense in
 *     depth).
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirements 3, 8.1.
 */

import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { SecretsBackendContent } from "@/src/components/secrets-backend/SecretsBackendContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Secrets Backend",
    additionalTitle: true,
    description:
      "Configure the secrets backend provider for your tenant. Choose between Gibson-hosted Vault, HashiCorp Vault (BYO), AWS Secrets Manager, GCP Secret Manager, or Azure Key Vault.",
    canonical: "/pages/settings/secrets-backend",
  });
}

export default function SecretsBackendPage() {
  return <SecretsBackendContent />;
}
