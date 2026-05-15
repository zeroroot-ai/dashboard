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
    <div className="bg-zd-gradient relative min-h-screen text-[var(--color-zd-fg)]">
      {/* CRT scanlines — fixed so they don't scroll with content. Tinted to
          the new highlight color so they blend with the navy gradient. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60] motion-reduce:hidden"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,255,170,0.04) 0px, rgba(0,255,170,0.04) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <SiteHeader />
      <main>
        <HeroSection />
        <WhatYouRunItOn />
        <WhatYouGet />
        <Production />
        <section className="border-t border-[var(--color-zd-border)] py-10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-3 px-4 font-mono text-sm">
            {footerLinks.map((link, i) => {
              const anchor = link.external ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-zd-fg)] hover:text-[var(--color-zd-link)]"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  href={link.href}
                  className="text-[var(--color-zd-fg)] hover:text-[var(--color-zd-link)]"
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
                    <span aria-hidden="true" className="text-[var(--color-zd-border)]">
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
      <footer className="border-t border-[var(--color-zd-border)] py-8 text-center font-mono text-xs text-[var(--color-zd-fg)] opacity-70">
        <p>&copy; {new Date().getFullYear()} zero-day.ai</p>
      </footer>
    </div>
  );
}
