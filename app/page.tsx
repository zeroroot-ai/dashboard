import Link from 'next/link';
import { getServerSession } from '@/src/lib/auth';
import { HeroSection } from '@/components/gibson/landing/HeroSection';
import { FeaturesSection } from '@/components/gibson/landing/FeaturesSection';
import { TrustSignals } from '@/components/gibson/landing/TrustSignals';
import { ClosingCTA } from '@/components/gibson/landing/ClosingCTA';

export default async function RootPage() {
  const session = await getServerSession();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-xl font-bold">Zero Day AI</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            {session?.user ? (
              <Link href="/dashboard/default" className="text-sm text-muted-foreground hover:text-foreground">
                Dashboard
              </Link>
            ) : (
              <Link href="/dashboard/login/v2" className="text-sm text-muted-foreground hover:text-foreground">
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>
      <main>
        <HeroSection />
        <FeaturesSection />
        <TrustSignals />
        <ClosingCTA />
      </main>
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Zero Day AI. All rights reserved.</p>
      </footer>
    </div>
  );
}
