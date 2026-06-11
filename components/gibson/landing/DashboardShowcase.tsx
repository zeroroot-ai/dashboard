import Image from 'next/image';

/**
 * DashboardShowcase — a framed product screenshot on the public landing
 * (dashboard#707). The image is swappable: the real PNG lives at
 * `public/dashboard-preview.png` (or pass `src`) and the frame stays.
 */
interface DashboardShowcaseProps {
  /** Image path under public/. Defaults to the committed product screenshot. */
  src?: string;
  alt?: string;
}

export function DashboardShowcase({
  src = '/dashboard-preview.png',
  alt = 'Zero Root AI dashboard — mission control, knowledge graph, and findings',
}: DashboardShowcaseProps) {
  return (
    <section className="border-t border-border py-16">
      <div className="mx-auto max-w-6xl px-4">
        <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.3em] text-highlight">
          // mission control
        </p>
        <h2 className="mb-8 text-center font-display text-2xl font-bold text-foreground md:text-3xl">
          Mission control for every agent you run
        </h2>
        {/* CRT-framed product visual. The terminal-glow ring + corner ticks
            echo the hero panel; the image itself is swappable. */}
        <div className="relative mx-auto max-w-5xl rounded-xl border border-highlight/40 bg-card/80 p-2 shadow-[0_0_60px_-15px_var(--highlight)] backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="h-3 w-3 rounded-full bg-destructive/80" />
            <span className="h-3 w-3 rounded-full bg-warning/80" />
            <span className="h-3 w-3 rounded-full bg-alt/80" />
            <span className="ml-3 font-mono text-xs text-highlight">app.zeroroot.ai/dashboard</span>
          </div>
          <Image
            src={src}
            alt={alt}
            width={2006}
            height={1636}
            className="w-full rounded-lg border border-border"
            priority={false}
          />
        </div>
      </div>
    </section>
  );
}
