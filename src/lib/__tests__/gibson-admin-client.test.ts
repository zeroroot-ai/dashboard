/**
 * Tests for the Envoy-routed admin client
 * (spec `dashboard-admin-via-envoy`, Req 2 + Req 5).
 *
 * What this test proves:
 *   1. The module does NOT read any file from disk during import or client
 *      construction — the old SPIFFE-mTLS path required `readFileSync` on
 *      the SVID cert / key; if anyone reintroduces that, this test fails.
 *   2. `baseUrl` defaults to `https://api.zero-day.local:30443` and honours
 *      the `ADMIN_ENVOY_BASE_URL` override.
 *   3. The SPIFFE JWT interceptor attaches `Authorization: Bearer <jwt>`
 *      minted via `getSpiffeJwt({audience})`, honouring the
 *      `GIBSON_DAEMON_SPIFFE_AUDIENCE` override.
 *   4. The telemetry interceptor increments `adminRpcTotal{status="ok"}`
 *      on success.
 *   5. Setting `GIBSON_ADMIN_VIA_ENVOY=false` throws immediately — the
 *      legacy direct-daemon path has been fully removed.
 *
 * All mocks must be declared BEFORE the module under test is imported, and
 * we reset module state between cases so env var changes are re-read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Interceptor = (
  next: (req: MockReq) => Promise<unknown>,
) => (req: MockReq) => Promise<unknown>;

interface MockReq {
  method: { name: string };
  header: Headers;
}

let capturedBaseUrl: string | undefined;
let capturedInterceptors: Interceptor[] = [];

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: vi.fn(
    (opts: { baseUrl?: string; interceptors?: Interceptor[] }) => {
      capturedBaseUrl = opts.baseUrl;
      capturedInterceptors = opts.interceptors ?? [];
      return { _tag: "mock-transport" };
    },
  ),
}));

vi.mock("@connectrpc/connect", async (importActual) => {
  const actual = await importActual<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: vi.fn(() => ({ _tag: "mock-admin-client" })),
  };
});

vi.mock("@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb", () => ({
  DaemonAdminService: {},
}));

let lastAudience: string | undefined;
vi.mock("@/src/lib/spiffe/jwt-svid", () => ({
  getSpiffeJwt: vi.fn(async ({ audience }: { audience: string }) => {
    lastAudience = audience;
    return "fake.jwt.token";
  }),
}));

// Shared counter spies — the real counters register against a process-wide
// registry, which breaks across test re-imports. Replace them with stubs.
const incSpy = vi.fn();
vi.mock("@/src/lib/metrics/gibson-admin", () => ({
  adminRpcTotal: { inc: incSpy },
  adminEnvoyUpstreamErrorsTotal: { inc: vi.fn() },
}));

// ESM doesn't let us `vi.spyOn(fs, "readFileSync")` directly. Mock the
// entire node:fs module and export a spy we can assert against — same
// effect for the "does this module read any cert files?" invariant.
const readFileSyncSpy = vi.fn(() => "");
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: readFileSyncSpy,
  };
});

// Compose the interceptor stack (outermost first, terminal last) and run
// one synthetic request through it, capturing the headers that were set.
async function runInterceptors(methodName = "UpsertTenantQuota"): Promise<{
  headers: Headers;
  error?: unknown;
}> {
  const headers = new Headers();
  const req: MockReq = { method: { name: methodName }, header: headers };

  const terminal = async (_req: MockReq) => ({ _tag: "mock-response" });
  const composed = capturedInterceptors.reduceRight(
    (next: (r: MockReq) => Promise<unknown>, ic) => ic(next),
    terminal,
  );

  try {
    await composed(req);
    return { headers };
  } catch (error) {
    return { headers, error };
  }
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Reset mock capture state + module cache so env-driven constants are
  // re-read on the next import.
  capturedBaseUrl = undefined;
  capturedInterceptors = [];
  lastAudience = undefined;
  incSpy.mockClear();
  vi.resetModules();

  // Clear every env var this module reads to a known baseline.
  delete process.env.ADMIN_ENVOY_BASE_URL;
  delete process.env.GIBSON_DAEMON_SPIFFE_AUDIENCE;
  delete process.env.GIBSON_ADMIN_VIA_ENVOY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gibson-admin-client", () => {
  it("does NOT invoke fs.readFileSync when constructing the client", async () => {
    readFileSyncSpy.mockClear();

    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );
    getDaemonAdminClient();

    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it("defaults baseUrl to https://api.zero-day.local:30443", async () => {
    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );
    getDaemonAdminClient();

    expect(capturedBaseUrl).toBe("https://api.zero-day.local:30443");
  });

  it("honours the ADMIN_ENVOY_BASE_URL env override", async () => {
    process.env.ADMIN_ENVOY_BASE_URL = "https://admin.prod.example:443";

    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );
    getDaemonAdminClient();

    expect(capturedBaseUrl).toBe("https://admin.prod.example:443");
  });

  it("attaches Authorization: Bearer <jwt> with the default audience", async () => {
    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );
    getDaemonAdminClient();

    const { headers } = await runInterceptors();
    expect(headers.get("Authorization")).toBe("Bearer fake.jwt.token");
    expect(lastAudience).toBe("spiffe://gibson.io/platform/daemon");
  });

  it("honours GIBSON_DAEMON_SPIFFE_AUDIENCE override", async () => {
    process.env.GIBSON_DAEMON_SPIFFE_AUDIENCE =
      "spiffe://example.test/workload/daemon";

    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );
    getDaemonAdminClient();

    await runInterceptors();
    expect(lastAudience).toBe("spiffe://example.test/workload/daemon");
  });

  it("increments adminRpcTotal{status=ok} on a successful RPC", async () => {
    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );
    getDaemonAdminClient();

    await runInterceptors("UpsertTenantQuota");

    expect(incSpy).toHaveBeenCalledWith({
      method: "UpsertTenantQuota",
      status: "ok",
    });
  });

  it("throws immediately when GIBSON_ADMIN_VIA_ENVOY=false", async () => {
    process.env.GIBSON_ADMIN_VIA_ENVOY = "false";

    const { getDaemonAdminClient } = await import(
      "@/src/lib/gibson-admin-client"
    );

    expect(() => getDaemonAdminClient()).toThrow(
      /direct-to-daemon path has been removed/i,
    );
  });
});
