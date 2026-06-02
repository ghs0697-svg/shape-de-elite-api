import { NextResponse } from 'next/server';
import { getKV, normEmail } from '@/lib/auth';
import { sendWhatsApp, buildWelcomeMessage } from '@/lib/zapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook da Hotmart — formato 2.x.
 *
 * Configurar na Hotmart:
 *   URL: https://shape-de-elite-api.vercel.app/api/webhooks/hotmart?secret=XXX
 *   Eventos a ativar: Compra aprovada, Compra cancelada, Compra reembolsada,
 *                     Chargeback, Compra protestada (e Assinatura cancelada se for recorrente)
 *
 * Reusamos o mesmo GREENN_WEBHOOK_SECRET pra não criar mais env vars.
 * Se quiser separar, basta criar HOTMART_WEBHOOK_SECRET e trocar a variável.
 *
 * Payload típico:
 * {
 *   "id": "...", "creation_date": ..., "event": "PURCHASE_APPROVED",
 *   "version": "2.0.0",
 *   "data": {
 *     "product": { "id": 7826404, "name": "Shape de Elite" },
 *     "buyer": { "email": "...", "name": "...", "checkout_phone": "+55..." },
 *     "purchase": { "status": "APPROVED", ... }
 *   }
 * }
 */
export async function POST(req) {
  try {
    // Auth via querystring ou header
    const url = new URL(req.url);
    const secret = process.env.HOTMART_WEBHOOK_SECRET || process.env.GREENN_WEBHOOK_SECRET || '';
    const provided = url.searchParams.get('secret') || req.headers.get('x-webhook-secret') || '';
    if (secret && provided !== secret) {
      console.warn('hotmart webhook unauthorized');
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    console.log('hotmart webhook payload:', JSON.stringify(payload));

    // Extrai email/nome/telefone do formato Hotmart (data.buyer)
    const buyer = payload?.data?.buyer || {};
    const purchase = payload?.data?.purchase || {};
    const subscription = payload?.data?.subscription || {};
    const event = String(payload?.event || '').toUpperCase();
    const purchaseStatus = String(purchase?.status || '').toUpperCase();

    const email = normEmail(buyer.email || '');
    const name = buyer.name || null;
    const phone = buyer.checkout_phone || buyer.phone || '';

    if (!email) {
      console.warn('hotmart webhook sem email — payload:', JSON.stringify(payload).slice(0, 300));
      return NextResponse.json({ ok: false, error: 'sem email no payload' }, { status: 400 });
    }

    const kv = await getKV();

    // Eventos da Hotmart que LIBERAM acesso
    const grantEvents = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_BILLET_PRINTED'];
    const grantStatuses = ['APPROVED', 'COMPLETE'];
    // Eventos que REVOGAM acesso
    const revokeEvents = [
      'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_CANCELED', 'PURCHASE_EXPIRED',
      'PURCHASE_PROTEST', 'SUBSCRIPTION_CANCELLATION', 'CHARGEBACK'
    ];

    const isGrant = grantEvents.includes(event)
      || (event === 'PURCHASE_STATUS_CHANGED' && grantStatuses.includes(purchaseStatus));
    const isRevoke = revokeEvents.includes(event);

    if (isGrant) {
      const purchaseRecord = {
        email, name, status: event, phone,
        purchasedAt: Date.now(),
        provider: 'hotmart',
        productId: payload?.data?.product?.id || null,
        productName: payload?.data?.product?.name || null,
        transaction: purchase?.transaction || null,
        raw: payload,
      };
      await kv.set(`shape:purchase:${email}`, purchaseRecord);
      console.log(`✅ shape:purchase:${email} CRIADO (hotmart)`);

      // Dispara WhatsApp de boas-vindas (best-effort — não bloqueia a resposta)
      if (phone) {
        const welcome = buildWelcomeMessage({ name, email });
        const wppResult = await sendWhatsApp(phone, welcome);
        console.log('WhatsApp boas-vindas:', wppResult.ok ? 'enviado' : 'falhou', wppResult);
      } else {
        console.warn(`Sem phone no payload Hotmart pra ${email} — WhatsApp não enviado`);
      }

      return NextResponse.json({ ok: true, action: 'granted', email, phone: phone ? '***' : null });
    }

    if (isRevoke) {
      // Marca purchase como cancelada (mantém histórico)
      const existingPurchase = await kv.get(`shape:purchase:${email}`);
      if (existingPurchase) {
        existingPurchase.status = event;
        existingPurchase.cancelledAt = Date.now();
        await kv.set(`shape:purchase:${email}`, existingPurchase);
      }
      // Marca user como cancelled + revoga sessão
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
      console.log(`🚫 shape:user:${email} CANCELLED (hotmart event=${event})`);
      return NextResponse.json({ ok: true, action: 'cancelled', email });
    }

    console.log(`⚠ evento hotmart ignorado: ${event} (status=${purchaseStatus})`);
    return NextResponse.json({ ok: true, action: 'ignored', event });
  } catch (err) {
    console.error('hotmart webhook error:', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

// GET pra teste rápido — confirma que rota tá no ar
export async function GET() {
  return NextResponse.json({ ok: true, msg: 'Hotmart webhook endpoint ativo. Use POST.' });
}
