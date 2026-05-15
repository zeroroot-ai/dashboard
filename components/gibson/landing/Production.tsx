import Link from "next/link";

export function Production() {
  return (
    <section className="border-t border-highlight/25">
      <div className="mx-auto max-w-5xl px-4 py-16 md:py-20">
        <h2 className="mb-6 font-mono text-sm md:text-base">
          <span className="text-highlight/50 select-none">$ </span>
          <span className="text-highlight">cat production.md</span>
        </h2>
        <p className="font-mono text-sm md:text-base leading-relaxed text-foreground/85">
          Every account starts with a 2-week free trial (card required) — for
          production tiers (teams, SLAs, audit retention), see{" "}
          <Link
            href="/pricing"
            className="text-link underline underline-offset-4 hover:text-highlight"
          >
            pricing
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
