import { pillars, ENGINE } from "@/src/lib/messaging";

/**
 * GibsonBrain, the flagship section: surfaces the three Gibson pillars from the
 * canonical messaging module (dashboard#887 / #885). This is the only place the
 * landing names the flagship engine and its differentiator; the pillar copy is
 * owned by src/lib/messaging.ts so it cannot drift from the profile/docs.
 */
export function GibsonBrain() {
  return (
    <section className="border-t border-border py-20 md:py-24">
      <div className="mx-auto max-w-5xl px-4">
        <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.3em] text-highlight">
          {"// the flagship"}
        </p>
        <h2 className="mb-4 text-center font-display text-2xl font-bold text-foreground md:text-3xl">
          Autonomous security that maps how risk connects
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-sm md:text-base leading-relaxed text-foreground/85">
          {ENGINE} is the factory&apos;s flagship engine. Point it at your
          environment and it builds a living model, finds the paths that matter,
          and replays every move. One engine for the teams breaking in and the
          teams locking down.
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {pillars.map((p) => (
            <div
              key={p.title}
              className="rounded-lg border border-highlight/25 bg-highlight/5 p-5"
            >
              <h3 className="mb-2 font-mono text-base md:text-lg text-highlight">
                {p.title}
              </h3>
              <p className="text-sm md:text-base leading-relaxed text-foreground/85">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
