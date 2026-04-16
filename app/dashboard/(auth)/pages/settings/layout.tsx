import { Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { SidebarNav } from "./components/sidebar-nav";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings Page",
    additionalTitle: true,
    description:
      "Manage account settings and preferences. A professional page built with React, TypeScript, Tailwind CSS, shadcn/ui, react-hook-form, and Zod.",
    canonical: "/pages/settings"
  });
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 lg:space-y-6">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your account settings and set e-mail preferences.
        </p>
      </div>
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-y-0 lg:space-x-4">
        <aside className="lg:w-64">
          <SidebarNav />
        </aside>
        <div className="flex-1 lg:max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
