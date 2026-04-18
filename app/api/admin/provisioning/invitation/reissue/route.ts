import { handleReissueInvitation } from "@/src/lib/admin-provisioning";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleReissueInvitation(req);
}
