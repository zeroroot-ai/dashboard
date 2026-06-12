/**
 * TrustBar, a single strip of platform facts under the hero. Every item
 * must be true of the shipping platform today; aspirational claims
 * (accreditations, certifications) do not belong here.
 */
const items = [
  "open-source core",
  "microVM isolation per execution",
  "kubernetes-native",
  "short-lived credentials",
  "bring your own LLM",
] as const;

export function TrustBar() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-5 font-mono text-xs text-muted-foreground">
        {items.map((item) => (
          <span key={item} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-highlight">
              ✔
            </span>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
