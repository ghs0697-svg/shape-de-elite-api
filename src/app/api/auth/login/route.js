import {
  preflight, jsonRes, getKV, createSession, verifyPassword, normEmail
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

export async function POST(req) {
  try {
    const { email: rawEmail, password } = await req.json();
    const email = normEmail(rawEmail);

    if (!email || !password) {
      return jsonRes(req, { error: 'E-mail e senha obrigatórios.' }, { status: 400 });
    }

    const kv = await getKV();
    const user = await kv.get(`shape:user:${email}`);
    if (!user) {
      return jsonRes(req, { error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return jsonRes(req, { error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    user.lastLogin = Date.now();
    await kv.set(`shape:user:${email}`, user);

    const token = await createSession(email);
    return jsonRes(req, { email, token, name: user.name || null });
  } catch (err) {
    console.error('login error:', err);
    return jsonRes(req, { error: 'Erro interno: ' + (err?.message || 'desconhecido') }, { status: 500 });
  }
}
