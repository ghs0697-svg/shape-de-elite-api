import { NextResponse } from 'next/server';
import { getKV, normEmail } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin endpoint pra GH autorizar/revogar email manualmente.
 * Útil quando webhook Greenn ainda não funciona, ou pra contas de cortesia/teste.
 *
 * GET /api/admin/grant?email=foo@bar.com&secret=XXX → autoriza
 * GET /api/admin/grant?email=foo@bar.com&secret=XXX&action=revoke → revoga
 */
export async function GET(req) {
  const url = new URL(req.url);
  const secret = process.env.ADMIN_SECRET || '';
  const provided = url.searchParams.get('secret') || '';
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const email = normEmail(url.searchParams.get('email') || '');
  const action = url.searchParams.get('action') || 'grant';
  if (!email) return NextResponse.json({ ok: false, error: 'email obrigatório' }, { status: 400 });

  const kv = await getKV();

  if (action === 'revoke') {
    await kv.del(`shape:purchase:${email}`);
    await kv.del(`shape:user:${email}`);
    return NextResponse.json({ ok: true, action: 'revoked', email });
  }

  await kv.set(`shape:purchase:${email}`, {
    email,
    name: url.searchParams.get('name') || null,
    status: 'manual_grant',
    purchasedAt: Date.now(),
  });
  return NextResponse.json({ ok: true, action: 'granted', email });
}
