import { SiteHeader } from "@/components/gibson/site-header";

/**
 * Public layout, landing page, pricing, login, signup all sit here.
 *
 * Honors user theme per #52, no forced `dark` class. The semantic tokens
 * from `app/globals.css` resolve correctly in either mode and Shadcn
 * primitives auto-theme from them.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>{children}</main>
    </div>
  );
}
