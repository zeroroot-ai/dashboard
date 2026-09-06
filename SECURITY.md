# Security policy

## Reporting a vulnerability

**Do not open a public issue.**

Report privately through GitHub Security Advisories:
[Report a vulnerability](https://github.com/zeroroot-ai/dashboard/security/advisories/new)

## What to expect

| | |
|---|---|
| Acknowledgement | within 3 working days |
| Initial assessment | within 10 working days |
| Fix or mitigation plan | communicated with the assessment |

If you have not heard back within 3 working days, assume the report did not
reach us and escalate through any other channel you have. Silence is a failure
on our side, not a decision.

## Scope

This repository is the web console. The highest severity classes here are:

- **Anything that reaches the daemon without passing ext-authz.** The dashboard
  must never open a direct gRPC channel; all traffic goes through Envoy and
  external authorization. A path around that bypasses authorization entirely.
- **Anything that renders one tenant's data in another tenant's session.**
- Session handling, since auth runs in Server Actions.

## Out of scope

- Findings in a deployment you control that come from your own configuration
- Automated scanner output with no demonstrated impact; show the path
- Secret-shaped strings in built `.next` chunks that are form placeholders.
  See `docs/code-scanning-dismissals.md` — we have analysed these and they
  recur under new chunk hashes on every build

## Safe harbour

We will not pursue or support legal action against anyone who reports in good
faith under this policy, stays within scope, and does not access, modify or
retain data belonging to anyone else.
