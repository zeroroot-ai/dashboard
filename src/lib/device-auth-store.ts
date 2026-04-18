/**
 * In-memory store for pending device-authorization flows. Good enough for
 * single-replica dev clusters and for dashboard boots behind a sticky-
 * session load balancer; production multi-replica deployments want a
 * Redis-backed store (see DashboardDeviceAuthStore interface below for
 * the shape to implement).
 *
 * Entries expire automatically after expires_in seconds (default 10min)
 * via a sweep on read. A completed flow carries access_token + user/
 * tenant ids; still-pending flows leave those fields undefined and the
 * /token endpoint returns 202 to signal the gibson-mcp poller to keep
 * trying.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 44.
 */

type DeviceFlow = {
  deviceCode: string;
  userCode: string;
  interval: number;
  expiresAt: number;
  requestedTenant?: string;
  accessToken?: string;
  userId?: string;
  tenantId?: string;
  approvedAt?: number;
};

const flows = new Map<string, DeviceFlow>(); // keyed by deviceCode
const byUserCode = new Map<string, string>(); // userCode -> deviceCode

function sweep() {
  const now = Date.now();
  for (const [dc, f] of flows) {
    if (f.expiresAt < now) {
      flows.delete(dc);
      byUserCode.delete(f.userCode);
    }
  }
}

export function newDeviceFlow(requestedTenant?: string): DeviceFlow {
  sweep();
  // Short, readable user code: 8 hex chars grouped as XXXX-XXXX.
  const rand = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
  const userCode = `${hex.slice(0, 4).toUpperCase()}-${hex.slice(4, 8).toUpperCase()}`;
  const deviceCode = hex + "-" + Date.now().toString(36);
  const flow: DeviceFlow = {
    deviceCode,
    userCode,
    interval: 5,
    expiresAt: Date.now() + 10 * 60 * 1000,
    requestedTenant,
  };
  flows.set(deviceCode, flow);
  byUserCode.set(userCode, deviceCode);
  return flow;
}

export function getByUserCode(userCode: string): DeviceFlow | undefined {
  sweep();
  const dc = byUserCode.get(userCode);
  return dc ? flows.get(dc) : undefined;
}

export function getByDeviceCode(deviceCode: string): DeviceFlow | undefined {
  sweep();
  return flows.get(deviceCode);
}

export function approveFlow(
  userCode: string,
  accessToken: string,
  userId: string,
  tenantId: string,
): boolean {
  const f = getByUserCode(userCode);
  if (!f) return false;
  f.accessToken = accessToken;
  f.userId = userId;
  f.tenantId = tenantId;
  f.approvedAt = Date.now();
  return true;
}

export function consumeDeviceCode(deviceCode: string): DeviceFlow | null {
  const f = getByDeviceCode(deviceCode);
  if (!f || !f.accessToken) return null;
  flows.delete(f.deviceCode);
  byUserCode.delete(f.userCode);
  return f;
}
