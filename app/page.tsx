import Link from 'next/link';
import { HeroSection } from '@/components/gibson/landing/HeroSection';
import { WhatYouGet } from '@/components/gibson/landing/WhatYouGet';
import { WhatYouRunItOn } from '@/components/gibson/landing/WhatYouRunItOn';
import { Production } from '@/components/gibson/landing/Production';
import { SiteHeader } from '@/components/gibson/site-header';

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

const footerLinks: FooterLink[] = [
  { label: 'docs', href: '/docs' },
  { label: 'discord', href: 'https://discord.gg/zero-day-ai', external: true },
  { label: 'github', href: 'https://github.com/zero-day-ai/adk', external: true },
  { label: 'pricing', href: '/pricing' },
];

export default function RootPage() {
  return (
    <div className="relative min-h-screen bg-[#050a07] text-foreground">
      {/* CRT scanlines — fixed so they don't scroll with content */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60] motion-reduce:hidden"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,255,120,0.04) 0px, rgba(0,255,120,0.04) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <SiteHeader />
      <main>
        <HeroSection />
        <WhatYouRunItOn />
        <WhatYouGet />
        <Production />
        <section className="border-t border-green-500/25 py-10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-3 px-4 font-mono text-sm">
            {footerLinks.map((link, i) => {
              const anchor = link.external ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400/80 hover:text-green-300"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  href={link.href}
                  className="text-green-400/80 hover:text-green-300"
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
                    <span aria-hidden="true" className="text-green-500/30">
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
      <footer className="border-t border-green-500/25 py-8 text-center font-mono text-xs text-muted-foreground/70">
        <p>&copy; {new Date().getFullYear()} zero-day.ai</p>
      </footer>
    </div>
  );
}
