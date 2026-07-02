import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { getServerSession } from "@/src/lib/auth";
import { AddSecretForm } from "@/src/components/secrets/AddSecretForm";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings | Add Secret",
    additionalTitle: true,
    description: "Add a new credential or configuration secret to your tenant secrets backend.",
    canonical: "/pages/settings/secrets/new",
  });
}

export default async function NewSecretPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }

  // Server-side authz gate: SetSecret is tenant_admin only.
  // Non-admins are redirected to the secrets list.
  // Spec: dashboard-authz-ui-gating Task 14, Requirement 5.5.
  try {
    await assertAuthorized("/gibson.tenant.v1.SecretsService/SetSecret");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect("/dashboard/pages/settings/secrets");
    }
    throw err;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/pages/settings/secrets"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Secrets
          </Link>
        </div>
        <h3 className="text-lg font-semibold">Add secret</h3>
        <p className="text-muted-foreground text-sm">
          Secrets are stored in your configured backend and never displayed after creation.
          Values are transmitted securely over TLS.
        </p>
      </div>

      <AddSecretForm />
    </div>
  );
}
