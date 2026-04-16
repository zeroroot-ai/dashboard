import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerSession } from '@/src/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId } = await request.json();

    // Validate user is a member of the target tenant
    const tenants = session.user.tenants || [];
    if (!tenants.includes(tenantId)) {
      return NextResponse.json({ error: 'Not a member of this tenant' }, { status: 403 });
    }

    // Set the active tenant cookie
    const cookieStore = await cookies();
    cookieStore.set('gibson_active_tenant', tenantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return NextResponse.json({ success: true, tenantId });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to switch tenant' }, { status: 500 });
  }
}
