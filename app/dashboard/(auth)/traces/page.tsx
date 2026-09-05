import { Suspense } from "react";
import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TraceListTable } from "@/components/gibson/traces/TraceListTable";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Gibson Traces",
    additionalTitle: true,
    description:
      "Token usage, model activity, and full prompt/response detail for every AI run across your missions.",
    canonical: "/traces",
  });
}

export default function TracesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TraceListTable />
    </Suspense>
  );
}
