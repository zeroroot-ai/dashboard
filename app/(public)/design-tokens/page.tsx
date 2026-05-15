/**
 * Design-tokens preview — internal reference page showing the Zero Day AI
 * brand palette imported from the holding-page Hugo site
 * (github.com/zero-day-ai/zero-day-ai.github.io, css/zero-day.css).
 *
 * Purpose: eyeball the palette + the gradient + the typography effects
 * (glow, blinking cursor) without spinning up the landing redesign.
 *
 * Spec: dashboard#47 — surface-level marketing tokens, dark-only.
 */

const swatches = [
  { name: "--color-zd-bg", hex: "#0a0e27", label: "background (deep navy)" },
  { name: "--color-zd-bg-deep", hex: "#0d1225", label: "deeper background" },
  { name: "--color-zd-fg", hex: "#a0a9cc", label: "foreground (muted blue-grey)" },
  { name: "--color-zd-highlight", hex: "#00ffaa", label: "terminal-green highlight" },
  { name: "--color-zd-alt", hex: "#64ffda", label: "mint alt" },
  { name: "--color-zd-link", hex: "#00d9ff", label: "cyan link / cursor" },
  { name: "--color-zd-border", hex: "#1a1f3a", label: "border" },
  { name: "--color-zd-accent-purple", hex: "#bd93f9", label: "accent purple" },
  { name: "--color-zd-accent-orange", hex: "#ffb86c", label: "accent orange" },
];

export default function DesignTokensPage() {
  return (
    <div className="bg-zd-gradient min-h-screen px-6 py-12 font-mono text-[var(--color-zd-fg)]">
      <div className="mx-auto max-w-4xl space-y-12">
        <header>
          <h1 className="text-3xl font-bold text-[var(--color-zd-highlight)] text-zd-glow">
            Zero Day AI — design tokens
          </h1>
          <p className="mt-2 text-sm text-[var(--color-zd-fg)]">
            Imported from{" "}
            <a
              className="text-[var(--color-zd-link)] underline-offset-4 hover:underline"
              href="https://www.zero-day.ai/"
            >
              www.zero-day.ai
            </a>{" "}
            (Hugo holding site, <code className="text-[var(--color-zd-alt)]">css/zero-day.css</code>).
            Dark-only by design — see <code className="text-[var(--color-zd-alt)]">app/globals.css</code>.
          </p>
        </header>

        <section>
          <h2 className="mb-4 text-xl font-bold text-[var(--color-zd-alt)]">Palette</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {swatches.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-4 rounded border border-[var(--color-zd-border)] bg-[var(--color-zd-bg-deep)] p-4"
              >
                <div
                  aria-hidden="true"
                  className="h-12 w-12 flex-none rounded border border-[var(--color-zd-border)]"
                  style={{ backgroundColor: s.hex }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[var(--color-zd-fg)]">
                    {s.label}
                  </div>
                  <div className="text-xs text-[var(--color-zd-fg)] opacity-70">
                    <code>{s.name}</code> · <code>{s.hex}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-[var(--color-zd-alt)]">Effects</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded border border-[var(--color-zd-border)] bg-[var(--color-zd-bg-deep)] p-6">
              <div className="text-zd-glow text-xl text-[var(--color-zd-highlight)]">
                Glow text
              </div>
              <div className="mt-2 text-xs opacity-70">
                <code>.text-zd-glow</code>
              </div>
            </div>
            <div className="rounded border border-[var(--color-zd-border)] bg-[var(--color-zd-bg-deep)] p-6">
              <div className="text-xl text-[var(--color-zd-fg)]">
                Blinking cursor: <span className="zd-cursor" aria-hidden="true" />
              </div>
              <div className="mt-2 text-xs opacity-70">
                <code>.zd-cursor</code>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-[var(--color-zd-alt)]">Gradient background</h2>
          <p className="text-sm opacity-70">
            The page background itself is <code>.bg-zd-gradient</code> — that&apos;s the canonical
            landing-page surface. Scroll the page to see it&apos;s fixed-attachment.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-[var(--color-zd-alt)]">Terminal-prompt header preview</h2>
          <div className="rounded border border-[var(--color-zd-border)] bg-[var(--color-zd-bg-deep)] p-4">
            <span className="text-zd-glow font-bold">
              <span className="text-[var(--color-zd-highlight)]">[</span>
              <span className="text-[var(--color-zd-alt)]">gibson</span>
              <span className="text-[var(--color-zd-highlight)]">@</span>
              <span className="text-[var(--color-zd-highlight)]">zero-day</span>
              <span className="text-[var(--color-zd-alt)]">]: </span>
              <span className="text-[var(--color-zd-highlight)]"> ~ </span>
              <span className="text-[var(--color-zd-alt)]">$</span>
              <span className="zd-cursor ml-1" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-2 text-xs opacity-70">
            Consumed by <code>SiteHeader</code> in dashboard#48.
          </p>
        </section>
      </div>
    </div>
  );
}
