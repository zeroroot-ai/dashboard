import { SiteHeader } from "@/components/gibson/site-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#050a07] text-foreground">
      <SiteHeader />
      <main>{children}</main>
    </div>
  );
}
