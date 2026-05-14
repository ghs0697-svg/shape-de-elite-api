import {
  preflight, jsonRes, getKV, normEmail, hashPassword, createSession, rotateUserToken
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

/**
 * POST /api/auth/reset-confirm
 * Body: { email, code, password }
 * Valida o código, troca a senha e já loga o aluno (retorna token novo).
 */
export async function POST(req) {
  try {
    const { email: rawEmail, code, password } = await req.json();
    const email = normEmail(rawEmail);

    if (!email || !code || !password) {
      return jsonRes(req, { error: 'Preenche e-mail, código e senha nova.' }, { status: 400 });
    }
    if (password.length < 6) {
      return jsonRes(req, { error: 'Senha precisa de no mínimo 6 caracteres.' }, { status: 400 });
    }

    const kv = await getKV();
    const reset = await kv.get(`shape:reset:${email}`);
    if (!reset) {
      return jsonRes(req, { error: 'Código expirado ou inexistente. Pede um novo.' }, { status: 400 });
    }
    if (String(reset.code) !== String(code).trim()) {
      return jsonRes(req, { error: 'Código incorreto. Confere no WhatsApp.' }, { status: 400 });
    }

    const user = await kv.get(`shape:user:${email}`);
    if (!user) {
      return jsonRes(req, { error: 'Conta não encontrada.' }, { status: 404 });
    }
    if (user.status === 'cancelled') {
      return jsonRes(req, { error: 'Conta cancelada. Fala com o suporte.' }, { status: 403 });
    }

    // Troca a senha
    user.passwordHash = await hashPassword(password);
    await kv.set(`shape:user:${email}`, user);
    await kv.del(`shape:reset:${email}`);

    // Já loga (sessão nova, mata a anterior)
    const token = await createSession(email);
    await rotateUserToken(email, token);

    return jsonRes(req, { ok: true, email, token, name: user.name || null });
  } catch (err) {
    console.error('reset-confirm error:', err);
    return jsonRes(req, { error: 'Erro interno: ' + (err?.message || 'desconhecido') }, { status: 500 });
  }
}
