import Link from 'next/link';
import { HeroSection } from '@/components/gibson/landing/HeroSection';
import { WhatYouGet } from '@/components/gibson/landing/WhatYouGet';
import { WhatYouRunItOn } from '@/components/gibson/landing/WhatYouRunItOn';
import { Production } from '@/components/gibson/landing/Production';
import { DashboardShowcase } from '@/components/gibson/landing/DashboardShowcase';
import { SiteHeader } from '@/components/gibson/site-header';

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

const footerLinks: FooterLink[] = [
  { label: 'docs', href: '/docs' },
  { label: 'discord', href: 'https://discord.gg/zeroroot-ai', external: true },
  { label: 'github', href: 'https://github.com/zeroroot-ai/adk', external: true },
  { label: 'pricing', href: '/pricing' },
];

export default function RootPage() {
  return (
    <div className="bg-zd-gradient relative min-h-screen text-foreground">
      <SiteHeader />
      <main>
        <HeroSection />
        <DashboardShowcase />
        <WhatYouGet />
        <WhatYouRunItOn />
        <Production />
        <section className="border-t border-border py-10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-3 px-4 font-mono text-sm">
            {footerLinks.map((link, i) => {
              const anchor = link.external ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:text-link"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  href={link.href}
                  className="text-foreground hover:text-link"
                >
                  {link.label}
                </Link>
              );

              return (
                <span
                  key={link.label}
                  className="flex items-center gap-x-4"
                >
                  {i > 0 && (
                    <span aria-hidden="true" className="text-border">
                      ·
                    </span>
                  )}
                  {anchor}
                </span>
              );
            })}
          </div>
        </section>
      </main>
      <footer className="border-t border-border py-8 text-center font-mono text-xs text-foreground opacity-90">
        <p>&copy; {new Date().getFullYear()} zeroroot.ai</p>
      </footer>
    </div>
  );
}
