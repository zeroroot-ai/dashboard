import Link from "next/link";

export function Production() {
  return (
    <section className="border-t border-green-500/25">
      <div className="mx-auto max-w-5xl px-4 py-16 md:py-20">
        <h2 className="mb-6 font-mono text-sm md:text-base">
          <span className="text-green-400/50 select-none">$ </span>
          <span className="text-green-300">cat production.md</span>
        </h2>
        <p className="font-mono text-sm md:text-base leading-relaxed text-green-50/85">
          Every account starts with a 2-week free trial (card required) — for
          production tiers (teams, SLAs, audit retention), see{" "}
          <Link
            href="/pricing"
            className="text-green-300 underline underline-offset-4 hover:text-green-200"
          >
            pricing
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
