import { generateMeta } from "@/lib/utils";

export async function generateMetadata() {
  return generateMeta({
    title: "Pricing Tables",
    additionalTitle: true,
    description:
      "Compare subscription plans and pricing models with flexible layout options including columns, tables, and single cards. A professional pricing page built with React, TypeScript, Tailwind CSS, and shadcn/ui.",
    canonical: "/pages/pricing/column"
  });
}

export default function PricingLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
