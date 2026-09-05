import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { BanksContent } from "@/components/gibson/banks/BanksContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Banks",
    description: "Pools of always-on Claude Code members that take structured jobs.",
    canonical: "/agents/banks",
  });
}

export default function BanksPage() {
  return <BanksContent />;
}
