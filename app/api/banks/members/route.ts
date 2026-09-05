/**
 * GET /api/banks/members, every member of every bank the caller may read,
 * each with the facts of its bank (gibson#1706 lane E3).
 *
 * The console joins this list to the running agents by `agent_run_id`, so a
 * tile knows it shows a bank member and which bank owns it. When the daemon
 * puts the member status on the console rows themselves (gibson#1716), the
 * join moves server-side and this route goes.
 */

import 'server-only';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { translateError } from '@/src/lib/providers-route-error';
import { listBanks, listMembers } from '@/src/lib/gibson-client/banks';
import type { MemberWithBankView } from '@/src/lib/banks/view';

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: { code: 'unauthenticated', message: 'Authentication required' } }, { status: 401 });
  }
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  try {
    const { banks } = await listBanks();
    const pages = await Promise.all(banks.map((b) => listMembers(b.id)));
    const data: MemberWithBankView[] = [];
    banks.forEach((bank, i) => {
      for (const member of pages[i].members) {
        data.push({ ...member, bankName: bank.name, bankOwner: bank.owner });
      }
    });
    return Response.json({ data });
  } catch (err) {
    return translateError(err, 'banks/members');
  }
}
