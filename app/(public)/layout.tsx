import Link from "next/link";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold">Gibson</Link>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link href="/dashboard/login/v2" className="text-sm text-muted-foreground hover:text-foreground">
              Sign In
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
