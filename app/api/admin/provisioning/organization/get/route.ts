import { handleGetBySlug } from "@/src/lib/admin-provisioning";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  return handleGetBySlug(req);
}
