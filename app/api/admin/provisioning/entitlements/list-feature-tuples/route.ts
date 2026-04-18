import { handleListFeatureTuples } from "@/src/lib/admin-provisioning-entitlements";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return handleListFeatureTuples(req);
}
