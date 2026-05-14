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

  if (action === 'check') {
    const purchase = await kv.get(`shape:purchase:${email}`);
    const user = await kv.get(`shape:user:${email}`);
    return NextResponse.json({
      ok: true,
      email,
      purchase: purchase ? { status: purchase.status, name: purchase.name, purchasedAt: purchase.purchasedAt, cancelledAt: purchase.cancelledAt } : null,
      user: user ? { status: user.status || 'active', name: user.name, createdAt: user.createdAt, lastLogin: user.lastLogin, hasToken: !!user.currentToken } : null,
      hasAccess: !!purchase && (!user || user.status !== 'cancelled')
    });
  }

  if (action === 'revoke') {
    await kv.del(`shape:purchase:${email}`);
    await kv.del(`shape:user:${email}`);
    return NextResponse.json({ ok: true, action: 'revoked', email });
  }

  // Reseta só a senha: apaga shape:user (cadastro+senha+sessão), MANTÉM
  // shape:purchase (autorização) e shape:protocol (dados da calculadora).
  // Aluno volta no "Primeiro acesso" e cria senha nova.
  if (action === 'resetpwd') {
    const user = await kv.get(`shape:user:${email}`);
    if (user?.currentToken) {
      await kv.del(`shape:session:${user.currentToken}`).catch(() => {});
    }
    await kv.del(`shape:user:${email}`);
    return NextResponse.json({
      ok: true, action: 'resetpwd', email,
      msg: 'Cadastro de senha apagado. Vai no app → Primeiro acesso → cria senha nova com o mesmo email.'
    });
  }

  await kv.set(`shape:purchase:${email}`, {
    email,
    name: url.searchParams.get('name') || null,
    status: 'manual_grant',
    purchasedAt: Date.now(),
  });
  return NextResponse.json({ ok: true, action: 'granted', email });
}
