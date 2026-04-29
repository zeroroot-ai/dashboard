import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { generateMeta } from "@/lib/utils";

import { getServerSession } from "@/src/lib/auth";
import { getSecret } from "@/src/lib/gibson-client/secrets";
import { SecretDetail } from "@/src/components/secrets/SecretDetail";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const name = decodeURIComponent(id);
  return generateMeta({
    title: `Settings — ${name}`,
    additionalTitle: true,
    description: `Manage the secret: ${name}`,
    canonical: `/pages/settings/secrets/${id}`,
  });
}

interface SecretDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SecretDetailPage({ params }: SecretDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }

  // Authz: GetSecret is tenant_member — all members can view details.
  // Non-members are redirected.
  // Spec: dashboard-authz-ui-gating Task 14, Requirement 5.4.
  try {
    await assertAuthorized("/gibson.admin.v1.SecretsAdminService/GetSecret");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect("/dashboard/pages/settings/secrets");
    }
    throw err;
  }

  const { id } = await params;
  const secretName = decodeURIComponent(id);

  let metadata: Awaited<ReturnType<typeof getSecret>>["metadata"] | undefined;
  try {
    const resp = await getSecret(secretName);
    metadata = resp.metadata;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "5" || code === "not_found") {
      notFound();
    }
    // Other errors: show not found as safe fallback
    notFound();
  }

  if (!metadata) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-0.5">
        <Link
          href="/dashboard/pages/settings/secrets"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Secrets
        </Link>
      </div>
      <SecretDetail metadata={metadata} />
    </div>
  );
}
