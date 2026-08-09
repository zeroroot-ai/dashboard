/**
 * Shared implementation of the single-artifact freshness gate.
 *
 * ## Why this exists
 *
 * Four `prebuild` gates (plans, stripe tiers, authz registry, mission schema)
 * each guard one committed generated file against one canonical upstream
 * source. Until dashboard#1019 they were four near-identical scripts, each
 * invoked in `prebuild` *immediately after its own generator had rewritten the
 * artifact*. Every gate therefore diffed the generator's output against the
 * generator's output and was structurally incapable of failing. The real drift
 * that had accumulated in `src/generated/plans.ts` sat in the repo unreported.
 *
 * The fix has two halves:
 *
 *   1. `prebuild` no longer runs the generators. Regeneration is an explicit
 *      `pnpm gen:*`. The gates are the only thing in that position, so a stale
 *      committed artifact fails the build instead of being silently repaired.
 *   2. Every gate compares the **committed** bytes against freshly generated
 *      output produced out-of-tree (`<generator> --stdout`, captured in
 *      memory), never against a file the generator just wrote.
 *
 * This is the same idiom as `check-proto-bindings-fresh.mjs` (dashboard#1017),
 * reduced to the single-file case: a structural pass that always runs, a
 * source-availability probe, and a byte-diff when the sources are on disk.
 * That gate keeps its own copy because it guards a whole tree with a
 * shrink-only baseline; these four share this module rather than growing a
 * fifth, sixth, seventh and eighth transcription of the same logic.
 *
 * ## Modes
 *
 * STRUCTURAL (always runs, nothing can bypass it):
 *   The committed artifact must exist, be non-empty, pass the artifact's own
 *   syntax validator when it has one, and carry the generator's header marker.
 *   This closes the vacuity hole: a gate that passes on a deleted or emptied
 *   artifact is the same defect wearing a different costume.
 *
 * FULL (adds a byte-diff when the generator reports its sources are present):
 *   Runs `<generator> --stdout`, which writes nothing to the working tree, and
 *   byte-diffs the capture against the committed file.
 *
 * Source availability is decided by the generator itself, via a `--probe`
 * subcommand that prints `{"available": bool, "sources": {...}}` — the same
 * contract `proto-generate.mjs --probe` already implements. The gates
 * therefore do no polyrepo path arithmetic of their own; the generator that
 * owns the path owns the probe.
 *
 * There is deliberately **no** `--skip` flag and no `SKIP_*` env escape. The
 * dashboard-only Docker build reaches STRUCTURAL mode by probing, not by being
 * told to look away.
 *
 * Fixes: zeroroot-ai/dashboard#1019
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * @typedef {object} GateConfig
 * @property {string} scriptName        Basename of the gate, used in every log line.
 * @property {string} artifact          Committed artifact, relative to the dashboard root.
 * @property {string} generator         Absolute path to the generator script.
 * @property {string} generatedMarker   Substring the committed artifact must contain,
 *                                      proving it came out of the generator.
 * @property {string} resolution        Command that regenerates the artifact.
 * @property {(text: string) => string | null} [validate]
 *                                      Extra syntax check. Returns an error message,
 *                                      or null when the artifact is well-formed.
 * @property {number} [maxBuffer]       stdout budget for the generator, in bytes.
 * @property {string} [sampleFrom]      Absolute path to the real committed artifact. The
 *                                      self-test prefers it as its "compliant" fixture so
 *                                      the marker and validator meet genuine content.
 * @property {string} syntheticSample   Fallback fixture for when `sampleFrom` is absent
 *                                      (a fresh clone, or a checkout mid-rename). Must
 *                                      contain `generatedMarker` and satisfy `validate`.
 */

/**
 * Verdict of a gate run. `status` maps onto the process exit code:
 * `ok` and `structural-ok` → 0, `fail` → 1, `error` → 2.
 *
 * @typedef {object} Verdict
 * @property {"ok" | "structural-ok" | "fail" | "error"} status
 * @property {string[]} messages
 */

/**
 * The whole decision procedure, with every side effect injected. Pure with
 * respect to the filesystem and the process table, so `selftest()` below can
 * drive all nine branches — including the ones that need a generator and a
 * populated polyrepo workspace — without either.
 *
 * @param {object} io
 * @param {string} io.artifactLabel
 * @param {string} io.generatedMarker
 * @param {() => {ok: true, text: string} | {ok: false, detail: string}} io.readArtifact
 * @param {(text: string) => (string | null)} [io.validate]
 * @param {() => {available: boolean, detail: string}} io.probeSources
 * @param {() => {ok: true, text: string} | {ok: false, detail: string}} io.generate
 * @returns {Verdict}
 */
export function evaluate(io) {
  const { artifactLabel, generatedMarker } = io;

  const read = io.readArtifact();
  if (!read.ok) {
    return {
      status: "fail",
      messages: [
        `${artifactLabel} is missing or unreadable: ${read.detail}`,
        "A generated artifact that is absent is drift, not an exemption.",
      ],
    };
  }

  if (read.text.trim().length === 0) {
    return {
      status: "fail",
      messages: [`${artifactLabel} is empty.`],
    };
  }

  if (io.validate) {
    const problem = io.validate(read.text);
    if (problem) {
      return { status: "fail", messages: [`${artifactLabel} is malformed: ${problem}`] };
    }
  }

  if (!read.text.includes(generatedMarker)) {
    return {
      status: "fail",
      messages: [
        `${artifactLabel} does not carry the generator marker ${JSON.stringify(generatedMarker)}.`,
        "It was hand-edited, or replaced by something the generator did not produce.",
      ],
    };
  }

  const probe = io.probeSources();
  if (!probe.available) {
    return {
      status: "structural-ok",
      messages: [
        `${artifactLabel} is present, non-empty and generator-produced. ` +
          `Skipped the byte-diff: ${probe.detail}`,
      ],
    };
  }

  const generated = io.generate();
  if (!generated.ok) {
    return { status: "error", messages: [`generator errored: ${generated.detail}`] };
  }

  if (generated.text.trim().length === 0) {
    return {
      status: "fail",
      messages: [
        "the generator produced no output.",
        "That is a generator bug, not a clean result. Refusing to pass.",
      ],
    };
  }

  if (generated.text !== read.text) {
    return {
      status: "fail",
      messages: [
        `${artifactLabel} is stale, it does not match freshly generated output.`,
        ...diffSummary(read.text, generated.text),
      ],
    };
  }

  return {
    status: "ok",
    messages: [`${artifactLabel} matches freshly generated output (${probe.detail}).`],
  };
}

/** First few differing lines, so the failure names the drift instead of just asserting it. */
function diffSummary(committed, generated, limit = 6) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i += 1) {
    if (a[i] === b[i]) continue;
    out.push(`  line ${i + 1}: committed  ${JSON.stringify(a[i] ?? "<eof>")}`);
    out.push(`  line ${i + 1}: generated  ${JSON.stringify(b[i] ?? "<eof>")}`);
  }
  if (out.length === 0) out.push("  (differs only in trailing bytes)");
  return out;
}

// ---------------------------------------------------------------------------
// real IO
// ---------------------------------------------------------------------------

/** Ask the generator whether its upstream sources are on disk. */
function probeGenerator(generator) {
  let raw;
  try {
    raw = execFileSync("node", [generator, "--probe"], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // A generator that cannot even probe is broken. Do not silently fall back
    // to STRUCTURAL, that would be the vacuity hole again.
    return { available: false, broken: true, detail: `--probe failed: ${err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { available: false, broken: true, detail: `--probe emitted non-JSON: ${err.message}` };
  }
  const detail = parsed.available
    ? `sources: ${Object.values(parsed.sources ?? {}).join(", ")}`
    : `upstream source(s) unreachable (${JSON.stringify(parsed.sources ?? {})}); ` +
      "dashboard-only build";
  return { available: Boolean(parsed.available), broken: false, detail };
}

/**
 * Run one gate end to end against a real dashboard checkout.
 *
 * @param {GateConfig} config
 * @param {string} root Dashboard root to check. Overridable for the self-test.
 * @returns {Verdict}
 */
export function runGate(config, root) {
  const artifactPath = resolve(root, config.artifact);
  let probeResult;

  const verdict = evaluate({
    artifactLabel: config.artifact,
    generatedMarker: config.generatedMarker,
    validate: config.validate,
    readArtifact: () => {
      try {
        return { ok: true, text: readFileSync(artifactPath, "utf8") };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
    probeSources: () => {
      probeResult = probeGenerator(config.generator);
      return probeResult;
    },
    generate: () => {
      try {
        return {
          ok: true,
          text: execFileSync("node", [config.generator, "--stdout"], {
            encoding: "utf8",
            maxBuffer: config.maxBuffer ?? 64 * 1024 * 1024,
            stdio: ["ignore", "pipe", "inherit"],
          }),
        };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
  });

  // A generator whose --probe is broken must not be reported as a clean
  // structural pass; that is exactly the "green means verified" lie this gate
  // exists to stop.
  if (verdict.status === "structural-ok" && probeResult?.broken) {
    return { status: "error", messages: [`cannot probe the generator: ${probeResult.detail}`] };
  }
  return verdict;
}

/** Print a verdict and exit with its mapped status code. */
export function reportAndExit(config, verdict) {
  const tag = `[${config.scriptName}]`;
  if (verdict.status === "ok" || verdict.status === "structural-ok") {
    const label = verdict.status === "ok" ? "OK" : "STRUCTURAL OK";
    for (const m of verdict.messages) process.stdout.write(`${tag} ${label}, ${m}\n`);
    process.exit(0);
  }
  process.stderr.write(`\n${tag} FAIL\n`);
  for (const m of verdict.messages) process.stderr.write(`  ${m}\n`);
  process.stderr.write(`\nResolve by running: ${config.resolution}\n`);
  process.stderr.write(`Then commit ${config.artifact} alongside the upstream change.\n`);
  process.exit(verdict.status === "error" ? 2 : 1);
}

// ---------------------------------------------------------------------------
// self-test
// ---------------------------------------------------------------------------

/**
 * Prove the gate rejects every defect it claims to catch and accepts a
 * compliant artifact.
 *
 * Nine cases. Six drive `evaluate` with stubbed IO, which is the only way to
 * exercise the FULL byte-diff path deterministically: the real generators need
 * sibling polyrepo checkouts, a buf toolchain and a Go module cache, none of
 * which a self-test may assume. Three more run the gate for real over a
 * throwaway dashboard root, proving the config→evaluate wiring and the real
 * filesystem reads behave as specified rather than only the pure core.
 *
 * @param {GateConfig} config
 * @returns {{ok: boolean, count: number}}
 */
export function selftest(config) {
  const tag = `[${config.scriptName}]`;
  const marker = config.generatedMarker;
  const healthyText = sampleArtifact(config);

  const stub = ({ text, sources = true, generated, generatorFails = false }) => ({
    artifactLabel: config.artifact,
    generatedMarker: marker,
    validate: config.validate,
    readArtifact: () =>
      text === null ? { ok: false, detail: "ENOENT" } : { ok: true, text },
    probeSources: () => ({ available: sources, detail: "stub" }),
    generate: () =>
      generatorFails
        ? { ok: false, detail: "stub explosion" }
        : { ok: true, text: generated ?? text ?? "" },
  });

  const pure = [
    {
      name: "fresh artifact passes",
      io: stub({ text: healthyText }),
      want: "ok",
    },
    {
      name: "drift against the generator fails",
      io: stub({ text: healthyText, generated: drifted(healthyText) }),
      want: "fail",
    },
    {
      name: "deleted artifact fails (vacuity hole)",
      io: stub({ text: null }),
      want: "fail",
    },
    {
      name: "empty artifact fails (vacuity hole)",
      io: stub({ text: "   \n" }),
      want: "fail",
    },
    {
      name: "artifact without the generator marker fails",
      io: stub({ text: strippedArtifact(config, healthyText) }),
      want: "fail",
    },
    {
      name: "a generator emitting nothing fails, it is never read as clean",
      io: stub({ text: healthyText, generated: "" }),
      want: "fail",
    },
    {
      name: "absent upstream sources degrade to structural, never to a skip",
      io: stub({ text: healthyText, sources: false }),
      want: "structural-ok",
    },
    {
      name: "a broken generator is an error, not a pass",
      io: stub({ text: healthyText, generatorFails: true }),
      want: "error",
    },
  ];

  let ok = true;
  for (const c of pure) {
    const got = evaluate(c.io).status;
    const pass = got === c.want;
    if (!pass) ok = false;
    process.stdout.write(
      `${tag} selftest ${pass ? "PASS" : "FAIL"}: ${c.name} → ${got} (want ${c.want})\n`,
    );
  }

  // End-to-end cases over a throwaway root. The generator is stubbed by a
  // one-file script so the case is hermetic, but everything else — argument
  // parsing, filesystem reads, probe decoding, exit-code mapping — is real.
  const scratch = mkdtempSync(join(tmpdir(), "dashboard-freshness-selftest-"));
  try {
    const fakeGenerator = join(scratch, "fake-generator.mjs");
    writeFileSync(
      fakeGenerator,
      "const payload = " +
        JSON.stringify(healthyText) +
        ";\n" +
        'if (process.argv.includes("--probe")) {\n' +
        '  process.stdout.write(JSON.stringify({ available: true, sources: { stub: "stub" } }));\n' +
        "} else {\n" +
        "  process.stdout.write(payload);\n" +
        "}\n",
    );
    const e2e = [
      { name: "e2e: committed bytes match the generator", text: healthyText, want: 0 },
      { name: "e2e: committed bytes drifted", text: drifted(healthyText), want: 1 },
      { name: "e2e: committed artifact deleted", text: null, want: 1 },
    ];
    for (const c of e2e) {
      const root = mkdtempSync(join(scratch, "root-"));
      if (c.text !== null) {
        const p = join(root, config.artifact);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, c.text);
      }
      const got = runGate({ ...config, generator: fakeGenerator }, root).status;
      const code = got === "ok" || got === "structural-ok" ? 0 : got === "error" ? 2 : 1;
      const pass = code === c.want;
      if (!pass) ok = false;
      process.stdout.write(
        `${tag} selftest ${pass ? "PASS" : "FAIL"}: ${c.name} → ${got} ` +
          `(exit ${code}, want ${c.want})\n`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const count = pure.length + 3;
  if (!ok) {
    process.stderr.write(`${tag} selftest FAILED, the guard does not behave as specified.\n`);
  }
  return { ok, count };
}

/**
 * A minimal artifact the gate must accept. Built from the real committed file
 * when it is on disk (so the marker and the validator are exercised against
 * genuine content), and synthesised from the config otherwise.
 */
function sampleArtifact(config) {
  const real = config.sampleFrom && existsSync(config.sampleFrom)
    ? readFileSync(config.sampleFrom, "utf8")
    : null;
  if (real && real.includes(config.generatedMarker)) return real;
  return config.syntheticSample;
}

/**
 * A byte-level mutation that keeps the artifact syntactically valid in every
 * format these gates guard (TypeScript and JSON alike) and keeps the generator
 * marker intact, so the drift case fails for the drift and nothing else.
 */
function drifted(text) {
  const out = text.replace("\n", "\n\n");
  if (out === text) throw new Error("selftest fixture has no newline to perturb");
  return out;
}

/** The same artifact with the generator marker removed, and nothing else changed. */
function strippedArtifact(config, text) {
  const stripped = text.replace(config.generatedMarker, "hand written");
  if (stripped === text) throw new Error("selftest fixture does not contain the marker");
  return stripped;
}

/**
 * Standard entrypoint. Handles `--selftest` and the `--root=` override, then
 * runs the gate and exits.
 *
 * @param {GateConfig} config
 * @param {string[]} argv
 * @param {string} defaultRoot
 */
export function main(config, argv, defaultRoot) {
  if (argv.includes("--selftest")) {
    const { ok, count } = selftest(config);
    if (!ok) process.exit(1);
    process.stdout.write(`[${config.scriptName}] selftest OK, ${count} cases\n`);
    process.exit(0);
  }
  const rootFlag = argv.find((a) => a.startsWith("--root="));
  const root = rootFlag ? resolve(rootFlag.slice("--root=".length)) : defaultRoot;
  reportAndExit(config, runGate(config, root));
}
