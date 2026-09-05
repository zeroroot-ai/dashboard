import { Suspense } from "react";
import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainView } from "@/components/gibson/brain/BrainView";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "World",
    additionalTitle: true,
    description:
      "The live mission World: missions, discovered targets, findings, and a replayable Scroller of everything the mission did, tick by tick.",
    canonical: "/world",
  });
}

export default async function WorldPage({
  searchParams,
}: {
  searchParams: Promise<{ mission?: string }>;
}) {
  const { mission } = await searchParams;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <BrainView mission={mission} />
    </Suspense>
  );
}
