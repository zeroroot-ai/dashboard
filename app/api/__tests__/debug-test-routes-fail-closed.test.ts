import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression: the sensitive test/debug routes must be fail-closed (404) when
 * their enabling flag is absent — the production posture. These routes are
 * gated ONLY by an explicit env flag (deliberately not NODE_ENV; see
 * check-no-nodeenv-conditioned-auth.mjs), and check-no-prod-debug-flags.mjs
 * guarantees no committed config sets those flags. This test locks the 404
 * behavior so a refactor can't make them default-open.
 */

describe("test/debug routes are fail-closed without their flag", () => {
  beforeEach(() => {
    delete process.env.TEST_FIXTURES_ENABLED;
    delete process.env.DASHBOARD_DEBUG;
  });

  it("POST /api/test/fga-revoke → 404 when TEST_FIXTURES_ENABLED unset", async () => {
    const { POST } = await import("../test/fga-revoke/route");
    const res = await POST(
      new NextRequest("http://localhost/api/test/fga-revoke", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/test/inject-fault → 404 when TEST_FIXTURES_ENABLED unset", async () => {
    const { GET } = await import("../test/inject-fault/route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("GET /api/debug/recent-errors → 404 when DASHBOARD_DEBUG unset", async () => {
    const { GET } = await import("../debug/recent-errors/route");
    const res = await GET();
    expect(res.status).toBe(404);
  });
});
