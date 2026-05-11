import {
  preflight, jsonRes, getKV, createSession, hashPassword, normEmail
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
    if (password.length < 6) {
      return jsonRes(req, { error: 'Senha precisa de no mínimo 6 caracteres.' }, { status: 400 });
    }

    const kv = await getKV();

    // 1. Verifica se email comprou (purchase autorizada via webhook Greenn)
    const purchase = await kv.get(`shape:purchase:${email}`);
    const allowList = (process.env.SHAPE_ALLOW_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const isAllowed = !!purchase || allowList.includes(email);

    if (!isAllowed) {
      return jsonRes(req, {
        error: 'E-mail não localizado nas compras. Verifica se é o mesmo da Greenn ou fala no suporte.'
      }, { status: 403 });
    }

    // 2. Já existe conta? — login normal
    const existing = await kv.get(`shape:user:${email}`);
    if (existing) {
      return jsonRes(req, {
        error: 'Esse e-mail já tem senha cadastrada. Use a tela de login.'
      }, { status: 409 });
    }

    // 3. Cria conta
    const passwordHash = await hashPassword(password);
    const user = {
      email,
      passwordHash,
      name: purchase?.name || null,
      createdAt: Date.now(),
      lastLogin: Date.now(),
    };
    await kv.set(`shape:user:${email}`, user);

    const token = await createSession(email);
    return jsonRes(req, { email, token, name: user.name });
  } catch (err) {
    console.error('register error:', err);
    return jsonRes(req, { error: 'Erro interno: ' + (err?.message || 'desconhecido') }, { status: 500 });
  }
}
