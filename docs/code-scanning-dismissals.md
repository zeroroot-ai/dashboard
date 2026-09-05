# Code-scanning dismissal ledger

Every code-scanning alert dismissed on this repo, with the reasoning that
justified it.

**Why this file exists.** The GitHub code-scanning API caps
`dismissed_comment` at 280 characters, which is not enough to hold a real
argument. A dismissal without a recorded reason is indistinguishable from a
dismissal because someone was tired of seeing it, so the analysis lives here
under version control, where it can be reviewed in a PR and challenged later.
Each dismissal comment on the API points back at the matching section below.

**The rules this ledger operates under.**

- Runtime application code (`app/`, `src/`) is **fix-only**. A finding there is
  either fixed or escalated to the owner; it is never dismissed on an agent's
  own authority. Exactly one entry below (alert 7) is a dismissal under those
  paths, and it was escalated and granted before it was taken — the rule
  presumes a fix exists, and that case is one where the algorithm is fixed by
  an external protocol. Escalate; do not decide it yourself.
- A dismissal must say **who controls the input** and **why they are already
  inside the trust boundary**. "It's only a test" is not a reason, because test
  code still runs on shared CI hosts and still holds live credentials.
- If a finding can be removed by deleting or rewriting the code, that is
  preferred over dismissing it, even when the finding is not exploitable.

---

## Orphaned alerts: fixed in source, unreachable by any future scan

The alerts in this section describe code that **no longer exists**. They stay
open only because nothing will ever re-analyse the ref they are pinned to, so
the scanner cannot observe the fix and retire them itself.

Two independent causes, both worth understanding before dismissing anything
here:

1. **Trivy never re-scans `refs/heads/main`.** The `vuln-scan` job in
   `zeroroot-ai/.github`'s `reusable-image-build.yml` is gated on
   `if: startsWith(github.ref, 'refs/tags/')`. The last Trivy analysis against
   `refs/heads/main` was **2026-05-24** (commit `c77c10dc`). Tag scans keep
   running, but they upload against tag refs, so alerts raised on `main` are
   stranded — no later analysis for that category and ref ever arrives to close
   them.
2. **Next.js chunk filenames are content-hashed.** Alerts located inside
   `/app/.next/**/*.js` name a path like `11yg0_uotcg.n.js`. That exact path can
   never recur in a later build, so even a `main` scan could not match the
   location and mark it fixed.

Both causes are being tracked so the class does not silently recur; see
*Follow-ups* at the end.

### 137, 164 — `gcp-service-account` (CRITICAL) in built JS bundles

| | |
|---|---|
| Rule | Trivy `gcp-service-account` |
| Paths | `/app/.next/server/chunks/ssr/src_components_secrets-backend_SecretsBackendForm_tsx_0igrz_c._.js:2`<br>`/app/.next/static/chunks/11yg0_uotcg.n.js:2` |
| Reason | `false positive` |

**This is not a credential. It is a form placeholder.**

Trivy redacts a match with one asterisk per matched character and keeps the
surrounding line context. Both alerts report:

```
Match:   *************************,
```

Two spaces, 25 asterisks, a comma. The literal `"type": "service_account"` is
exactly 25 characters, which reconstructs the match byte for byte. Trivy's
built-in `gcp-service-account` rule is **shape-only**: it keys on the JSON
`type` discriminator alone and does not require a `private_key`, a PEM block,
or any key body. The redaction width is therefore proof that the whole matched
region was those 25 characters and nothing else.

The source was `src/components/secrets-backend/gcpsm.tsx:145` (at the scanned
commit `c77c10dc`) — the `placeholder` prop of a `<Textarea>` in the GCP Secret
Manager backend form:

```tsx
placeholder={`{\n  "type": "service_account",\n  ...\n}`}
```

Greyed hint text in an empty textarea, telling the user what shape of JSON to
paste. Not a value, not a default, not a stored constant. The JSON is truncated
at `...`: there is no `private_key`, `project_id`, `client_email`,
`private_key_id` or `client_id`. Scanning the file for a base64 key body
(`[A-Za-z0-9+/]{40,}={0,2}`) returns zero hits, and there is no
`BEGIN PRIVATE KEY` anywhere in the file or in the built chunk.

Two alerts for one literal because `SecretsBackendForm.tsx` imports it as a
client component, so it is emitted into both the SSR chunk and the client
static chunk.

The surrounding design confirms real credentials never reach the client:
`gcpsm.tsx:138-142` documents the field as write-only ("encoded to bytes before
the RPC and never returned to the client by the daemon"), and
`app/actions/secrets-backend.ts:180` scrubs it from logs. The scanner tripped
on the UI hint describing a secret, not on a secret.

**Already removed.** `gcpsm.tsx` does not exist on `main`. It was deleted in
full by `484f1efc25d6c38dcc3b232654ddfd68540bcba0` (2026-07-01, #937), which
replaced the GCP-SM form with the Hosted/BYO selector. Zero occurrences of the
literal remain. The alert instance history agrees: instances exist on tags
`v0.110.0`–`v0.115.0` (all pre-deletion) and on neither `v0.116.0` nor
`v0.118.1` (both post-deletion).

### 122–136 — CVEs in npm's vendored dependencies

| | |
|---|---|
| Rule | Trivy, 15 CVEs across `tar`, `minimatch`, `glob`, `cross-spawn`, `brace-expansion`, `ip-address`, `diff` |
| Path | `usr/local/lib/node_modules/npm/node_modules/*/package.json` |
| Reason | `won't fix` (fixed in the image; alert orphaned on an unscanned ref) |

Alerts: 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
136.

These are not the dashboard's dependencies. They are the dependency tree that
the **npm CLI** vendors under `/usr/local/lib/node_modules/npm/node_modules/`,
present in the image only because the `node:20-alpine` base ships npm.

They were never reachable at runtime. The runtime stage's entrypoint is
`node server.js` against the Next standalone output and its healthcheck shells
out to `wget`; no npm, npx, corepack or yarn is invoked. Nor could they be
fixed by patching the application — the only lever on these versions is npm's
own version, which the base image pins.

**Fixed properly rather than annotated.** #1076 deletes npm, npx, corepack and
yarn from the runtime stage, which removes the packages and with them the
findings. Verified against the exact base image (the pinned mirror digest
`sha256:fb4cd12c…` is the digest `docker.io/library/node:20-alpine` currently
resolves to):

```
BEFORE:  /usr/local/lib/node_modules/npm/node_modules/ contains
         brace-expansion cross-spawn diff glob ip-address minimatch tar
AFTER:   /usr/local/lib/node_modules/ is empty; npm binary GONE; node v20.20.2
```

The dismissal covers only the stranded alert rows. The exposure itself is gone,
and future tag scans are clean as a result.

---

## Developer-tooling findings outside the trust boundary

### 15 — `js/file-system-race` in `scripts/check-no-legacy-login-url.mjs`

| | |
|---|---|
| Rule | CodeQL `js/file-system-race` |
| Path | `scripts/check-no-legacy-login-url.mjs:135` |
| Reason | `won't fix` |

A build-time source-tree walker: it `stat`s a directory entry to decide whether
to recurse or read, then reads it. The gap between the two calls is the
finding.

There is no privilege boundary here. The script walks **the checkout it was
invoked in**, on the developer's own workstation or on a CI runner that has
just cloned the repo. The only party who could swap a file between the `stat`
and the `read` is a party who already has write access to the build tree — that
is, someone who can simply edit the file being checked, or the script itself.
Winning the race grants strictly less than what the attacker must already hold.

Restructuring the walker to hold a descriptor across the recursion decision
would complicate it appreciably to defend a boundary that does not exist. The
equivalent finding in runtime code (`src/lib/auth/identity-resolver.ts`, alert
16) **was** fixed in #1078, because that one runs in a pod against a file
written by another container, where the boundary is real.

---

## Dismissed by owner decision — runtime code with no available fix

### 7 — `js/insufficient-password-hash` in `src/lib/auth/hibp.ts`

| | |
|---|---|
| Rule | CodeQL `js/insufficient-password-hash` |
| Path | `src/lib/auth/hibp.ts:53` |
| Reason | `false positive` |

**This is the one dismissal on runtime code under `src/`, and it was escalated
before it was taken.** The fix-only rule for `app/` and `src/` presumes a fix
exists. Here none does, in a strong sense: the algorithm is not ours to choose.

`src/lib/auth/hibp.ts:53` computes `createHash('sha1')` over a password. CodeQL
flags SHA-1 on a value named `password`, which is normally exactly right.

Here it is not a password hash. It is the
[HIBP Pwned Passwords range query](https://haveibeenpwned.com/API/v3#PwnedPasswords),
whose k-anonymity protocol **mandates SHA-1**:

- only `digest.slice(0, 5)` is sent to the range endpoint; the full digest
  never leaves the function
- `suffix35` is compared in memory against the returned list
- no hash is stored, returned, or logged — the function returns
  `{ breached, count }`
- there is no local password store to hash into at all: credentials are owned
  by Zitadel

Changing the algorithm would not harden anything; it would break the API
contract and disable breached-password checking entirely.

To restate the property that matters: **SHA-1 is being used as a lookup key,
not as a security primitive.** No integrity, authentication, or storage
guarantee rests on its collision resistance. It is the index into a public
corpus, and the corpus is indexed by SHA-1 because that is what the protocol
says. Substituting any other digest does not weaken or strengthen anything — it
makes the API call impossible, because the server has nothing to match against.

### Why it was dismissed rather than configured out

The considered alternative was excluding this file from the
`js/insufficient-password-hash` query in `.github/codeql-config.yml`, on the
grounds that config is visible in version control and survives a re-scan.

**That is not available at the required precision, and would be worse if it
were.** CodeQL's `query-filters` match on rule *metadata* — `id`, `tags`,
`precision`, `severity` — not on paths. `paths-ignore` is path-scoped but
rule-agnostic. There is no path × rule intersection in the config format, so
the only expressible exclusion is "disable this weak-crypto rule repo-wide,"
which would blind the repo to a genuinely bad SHA-1 or MD5 use added later.
That is precisely the regression the rule exists to catch.

A surgical per-alert dismissal keeps the rule armed everywhere else, and this
ledger supplies the version-controlled visibility that the config approach was
wanted for. Owner decision, 2026-08-15.

**If this alert reappears** after a re-scan (a dismissal is per-alert, and a
sufficiently changed line can raise a new one), re-dismiss it citing this
section. Do not reach for the config exclusion.

---

## Follow-ups

These are the causes behind the orphaned alerts above, tracked so the class does
not recur silently.

1. **Trivy never analyses `refs/heads/main`.** `vuln-scan` in
   `zeroroot-ai/.github`'s `reusable-image-build.yml` is gated on
   `startsWith(github.ref, 'refs/tags/')`. Consequence: image findings on `main`
   can be *raised* (historically) but never *retired*, and a fix like #1076
   cannot show up as a closed alert. Needs a decision in the `.github` repo —
   scanning on `main` pushes as well would let the tab reconcile.
2. **CodeQL uploads were disabled for ~2 months.** #868 set `upload: never` when
   the repo was private, and it was not restored when the repo went public.
   Fixed by #1075. The Security tab was frozen at 2026-06-19 the whole time,
   and could not close a single fixed alert.

   **This is not dashboard-specific.** `zeroroot-ai/gibson` carries the identical
   pattern: it is public (`private: false`), its `.github/workflows/codeql.yml`
   still reads "gibson is a private repo, so uploading SARIF … requires paid
   GitHub Advanced Security" with `upload: never`, and its last CodeQL analysis
   on `refs/heads/main` was 2026-06-20 — the same freeze window. Its Security tab
   is blind for the same reason. Both repos were flipped public by epic
   `oss-public-flip` (board #40) and neither had the upload restored, so the
   trigger to re-enable is the flip itself rather than anything repo-local.
   Routed to the org sweep lane alongside item 1; not fixed here.
3. **`check-authz-registry-fresh` fails on `main`.** `src/gen/authz/registry.ts`
   disagrees with the gibson protos over `ComponentService` `StoreNode` /
   `SubmitFinding` / `SubmitResult`. Reproduces on a clean `origin/main`
   worktree; only fires in FULL mode (gibson sibling present), so CI's
   STRUCTURAL mode does not catch it. Unrelated to any security fix, but it
   blocks `pnpm prebuild` locally.
