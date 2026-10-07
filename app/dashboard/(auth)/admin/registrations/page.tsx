// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectError, Code } from "@connectrpc/connect";
import { generateMeta } from "@/lib/utils";

import { ErrorAlert } from "@/components/gibson/shared";
import { RegistrationsContent } from "@/components/gibson/registrations/RegistrationsContent";
import { REGISTRATIONS_TEXT } from "@/components/gibson/registrations/texts";
import { daemonListPendingRegistrations } from "@/src/lib/gibson-client/registrations";
import { authzDenial } from "@/src/lib/auth/assert-authorized";

/**
 * Registration queue page, server component (dashboard#193, gibson#620).
 *
 * The RPCs carry the "platform_owner" relation on the system tenant. The
 * dashboard does not hold that relation, so the page reads the queue once:
 * ext-authz decides, and a caller without the relation goes back to the
 * dashboard home, the same denial every admin page gives.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: REGISTRATIONS_TEXT.title,
    description: REGISTRATIONS_TEXT.intro,
    canonical: "/admin/registrations",
  });
}

function denied(err: unknown): boolean {
  if (authzDenial(err)) return true;
  return (
    err instanceof ConnectError &&
    (err.code === Code.PermissionDenied || err.code === Code.Unauthenticated)
  );
}

export default async function RegistrationsPage() {
  try {
    await daemonListPendingRegistrations();
  } catch (err) {
    if (denied(err)) {
      redirect("/dashboard");
    }
    return (
      <ErrorAlert error={err instanceof Error ? err : { message: String(err) }} />
    );
  }
  return <RegistrationsContent />;
}
