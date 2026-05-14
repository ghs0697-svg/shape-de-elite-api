import { preflight, jsonRes, getKV, normEmail, extractPhone } from '@/lib/auth';
import { sendWhatsApp } from '@/lib/zapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

/**
 * POST /api/auth/reset-request
 * Body: { email }
 * Gera código de 6 dígitos, salva no KV (TTL 15min) e envia via WhatsApp.
 */
export async function POST(req) {
  try {
    const { email: rawEmail } = await req.json();
    const email = normEmail(rawEmail);
    if (!email) return jsonRes(req, { error: 'E-mail obrigatório.' }, { status: 400 });

    const kv = await getKV();
    const user = await kv.get(`shape:user:${email}`);
    if (!user) {
      return jsonRes(req, { error: 'Não achei conta com esse e-mail. Confere se é o mesmo que tu cadastrou.' }, { status: 404 });
    }

    // Acha o telefone: purchase.phone limpo, ou cava no raw payload
    const purchase = await kv.get(`shape:purchase:${email}`);
    let phone = purchase?.phone || '';
    if (!phone && purchase?.raw) phone = extractPhone(purchase.raw);
    if (!phone) {
      return jsonRes(req, {
        error: 'Não tenho teu WhatsApp registrado pra enviar o código. Fala com o suporte pra redefinir.'
      }, { status: 422 });
    }

    // Gera código de 6 dígitos, válido 15 min
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await kv.set(`shape:reset:${email}`, { code, createdAt: Date.now() }, { ex: 900 });

    // Envia via WhatsApp
    const msg = [
      '🔐 *Shape de Elite* — redefinição de senha',
      '',
      `Teu código: *${code}*`,
      '',
      'Válido por 15 minutos. Digita ele no app pra criar tua senha nova.',
      'Se não foi tu que pediu, é só ignorar.'
    ].join('\n');
    const result = await sendWhatsApp(phone, msg);
    if (!result.ok) {
      console.error('reset-request: falha Z-API', result);
      return jsonRes(req, {
        error: 'Não consegui enviar o código pro teu WhatsApp agora. Tenta de novo em instantes ou fala com o suporte.'
      }, { status: 502 });
    }

    // Máscara do telefone pra confirmar pro aluno (sem expor o número todo)
    const clean = String(phone).replace(/\D/g, '');
    const masked = '••••••' + clean.slice(-4);
    return jsonRes(req, { ok: true, phoneMasked: masked });
  } catch (err) {
    console.error('reset-request error:', err);
    return jsonRes(req, { error: 'Erro interno: ' + (err?.message || 'desconhecido') }, { status: 500 });
  }
}
