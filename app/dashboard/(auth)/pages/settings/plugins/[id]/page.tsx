import { type Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { generateMeta } from "@/lib/utils";
import { getPluginInstall } from "@/src/lib/gibson-client/plugins-admin";
import { Button } from "@/components/ui/button";

import { PluginDetailContent } from "@/src/components/gibson/settings/PluginDetailContent";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let title = "Plugin detail";
  try {
    const resp = await getPluginInstall(id);
    if (resp.install?.name) title = resp.install.name;
  } catch {
    // fallback title
  }
  return generateMeta({
    title: `Settings — ${title}`,
    additionalTitle: true,
    description: "Plugin installation detail and secret bindings.",
    canonical: `/pages/settings/plugins/${id}`,
  });
}

// ---------------------------------------------------------------------------
// Page (server component — data fetch)
// ---------------------------------------------------------------------------

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let install;
  try {
    const resp = await getPluginInstall(id);
    install = resp.install;
  } catch {
    notFound();
  }

  if (!install) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard/pages/settings/plugins">
            <ArrowLeftIcon className="mr-1 size-3.5" aria-hidden="true" />
            Back to plugins
          </Link>
        </Button>
      </div>

      <PluginDetailContent install={install} />
    </div>
  );
}
