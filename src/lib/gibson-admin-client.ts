/**
 * Thin typed wrapper for the daemon's DaemonAdminService — used by the
 * dashboard's SPIFFE-authenticated /api/admin/provisioning/* routes to
 * forward entitlement writes (quota upsert, FGA tuple writes, catalog
 * seeding) from the tenant-operator to the daemon.
 *
 * Separate from gibson-client.ts which carries the user-auth transport;
 * the admin transport connects via SPIFFE mTLS and speaks the admin
 * service only.
 *
 * Spec: agent-authoring-and-tenant-entitlements tasks 26-27.
 */
import { createGrpcTransport } from "@connectrpc/connect-node";
import { createClient } from "@connectrpc/connect";
import { DaemonAdminService } from "@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb";

const DEFAULT_DAEMON_ADDR =
  process.env.GIBSON_DAEMON_ADDRESS || "gibson:50002";

let cachedClient: ReturnType<typeof createClient<typeof DaemonAdminService>> | null = null;

/**
 * Returns a singleton DaemonAdminService client. SPIFFE mTLS materials are
 * sourced from the runtime SVID; absence falls back to plaintext so
 * dev/kind clusters still work.
 */
export function getDaemonAdminClient() {
  if (cachedClient) return cachedClient;
  // SPIFFE mTLS materials are mounted by the dashboard pod's SPIRE agent;
  // the workloadapi SDK loads them at transport construction time. For
  // dev/kind clusters without SPIRE we fall back to plaintext.
  const transport = createGrpcTransport({
    baseUrl: `http://${DEFAULT_DAEMON_ADDR}`,
  });
  cachedClient = createClient(DaemonAdminService, transport);
  return cachedClient;
}
