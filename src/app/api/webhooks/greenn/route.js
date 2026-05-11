import { NextResponse } from 'next/server';
import { getKV, normEmail } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook do Greenn — recebe eventos de compra/reembolso/cancelamento.
 *
 * Configurar na Greenn: POST https://shape-de-elite-api.vercel.app/api/webhooks/greenn?secret=XXX
 * (sem CORS — Greenn faz request server-to-server)
 *
 * Ações tratadas:
 *  - compra aprovada → grava `shape:purchase:{email}`
 *  - reembolso/cancelamento → REMOVE `shape:purchase:{email}` e `shape:user:{email}` (revoga acesso)
 *
 * O payload exato da Greenn varia por integração. Tentamos múltiplos formatos.
 */
export async function POST(req) {
  try {
    // Auth via querystring ou header
    const url = new URL(req.url);
    const secret = process.env.GREENN_WEBHOOK_SECRET || '';
    const provided = url.searchParams.get('secret') || req.headers.get('x-webhook-secret') || '';
    if (secret && provided !== secret) {
      console.warn('greenn webhook unauthorized');
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    console.log('greenn webhook payload:', JSON.stringify(payload));

    // Procura recursiva por chave "email" em qualquer profundidade do objeto
    function findKey(obj, key) {
      if (!obj || typeof obj !== 'object') return null;
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === key.toLowerCase() && typeof obj[k] === 'string' && obj[k]) return obj[k];
      }
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object') {
          const r = findKey(obj[k], key);
          if (r) return r;
        }
      }
      return null;
    }

    // Email: tenta caminhos conhecidos primeiro, depois fallback recursivo
    const email = normEmail(
      payload.email ||
      payload.customer_email ||
      payload.buyer?.email ||
      payload.customer?.email ||
      payload.client?.email ||
      payload.data?.customer?.email ||
      payload.data?.buyer?.email ||
      payload.sale?.client?.email ||
      payload.sale?.customer?.email ||
      payload.sale?.buyer?.email ||
      findKey(payload, 'email') ||
      ''
    );
    const name =
      payload.name ||
      payload.customer_name ||
      payload.buyer?.name ||
      payload.customer?.name ||
      payload.client?.name ||
      payload.data?.customer?.name ||
      payload.data?.buyer?.name ||
      payload.sale?.client?.name ||
      payload.sale?.customer?.name ||
      payload.sale?.buyer?.name ||
      findKey(payload, 'name') ||
      null;
    // Status: prioriza currentStatus / sale.status (formato Greenn) sobre event
    const status = String(
      payload.currentStatus ||
      payload.sale?.status ||
      payload.data?.status ||
      payload.status ||
      payload.event ||
      payload.type ||
      'unknown'
    ).toLowerCase();

    if (!email) {
      console.warn('greenn webhook sem email');
      return NextResponse.json({ ok: false, error: 'sem email no payload' }, { status: 400 });
    }

    const kv = await getKV();

    // Eventos que CONCEDEM acesso
    const grantStatuses = ['paid','approved','aprovado','succeeded','completed','complete','sale_approved','order_approved','purchase_approved','active'];
    // Eventos que REVOGAM acesso
    const revokeStatuses = ['refunded','reembolso','chargeback','canceled','cancelled','cancelado','expired','disputed'];

    if (grantStatuses.some(s => status.includes(s))) {
      const purchase = {
        email,
        name,
        status,
        purchasedAt: Date.now(),
        raw: payload, // guarda raw pra debug
      };
      await kv.set(`shape:purchase:${email}`, purchase);
      console.log(`✅ shape:purchase:${email} CRIADO`);
      return NextResponse.json({ ok: true, action: 'granted', email });
    }

    if (revokeStatuses.some(s => status.includes(s))) {
      // Marca purchase como cancelada
      const existingPurchase = await kv.get(`shape:purchase:${email}`);
      if (existingPurchase) {
        existingPurchase.status = status;
        existingPurchase.cancelledAt = Date.now();
        await kv.set(`shape:purchase:${email}`, existingPurchase);
      }
      // Marca user como cancelled + revoga sessão (mantém pra histórico/legal)
      const existingUser = await kv.get(`shape:user:${email}`);
      if (existingUser) {
        existingUser.status = 'cancelled';
        existingUser.cancelledAt = Date.now();
        if (existingUser.currentToken) {
          await kv.del(`shape:session:${existingUser.currentToken}`).catch(() => {});
          existingUser.currentToken = null;
        }
        await kv.set(`shape:user:${email}`, existingUser);
      }
      console.log(`🚫 shape:user:${email} CANCELLED (status=${status})`);
      return NextResponse.json({ ok: true, action: 'cancelled', email });
    }

    console.log(`⚠ status desconhecido: ${status}`);
    return NextResponse.json({ ok: true, action: 'ignored', status });
  } catch (err) {
    console.error('greenn webhook error:', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

// GET pra teste rápido — confirma que rota tá no ar
export async function GET(req) {
  return NextResponse.json({ ok: true, msg: 'Greenn webhook endpoint ativo. Use POST.' });
}
