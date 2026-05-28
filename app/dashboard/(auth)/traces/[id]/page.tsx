import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { TraceDetailView } from "@/components/gibson/traces/TraceDetailView";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Trace detail — Gibson Traces",
    additionalTitle: true,
    description:
      "Token usage, model activity, and the full prompt/response detail for a single AI run.",
    canonical: "/traces",
  });
}

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TraceDetailView traceId={id} />;
}
