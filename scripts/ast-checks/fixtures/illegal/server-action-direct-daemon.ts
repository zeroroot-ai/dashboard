"use server";
// Illegal: server action imports a generated daemon ConnectRPC client
// directly, bypassing the SPIFFE + Envoy + ext-authz wrapper.
import { DaemonServiceClient } from "@/gen/gibson/daemon/v1/daemon_pb";

export async function action() {
  return new DaemonServiceClient();
}
