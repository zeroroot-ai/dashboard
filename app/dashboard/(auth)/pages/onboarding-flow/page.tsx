import Onboarding from "./components/onboarding";
import { generateMeta } from "@/lib/utils";

export async function generateMetadata() {
  return generateMeta({
    title: "Onboarding Flow",
    additionalTitle: true,
    description:
      "Streamline user registration with step-by-step questions and personalized flows. A professional onboarding page built with React, Next.js, TypeScript, Tailwind CSS, and shadcn/ui.",
    canonical: "/pages/onboarding-flow"
  });
}

export default function Page() {
  return <Onboarding />;
}
