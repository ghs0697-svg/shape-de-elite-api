import { preflight, jsonRes, requireAuth, getProtocol, setProtocol } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

/**
 * POST /api/protocol/save
 * Body: protocolo completo calculado no frontend (TMB, dieta, treino, etc).
 *
 * Server-side validation (anti-piracy):
 *  - Se NÃO existe protocol → primeira vez, cria com createdAt e recalcCount=0
 *  - Se existe e está bloqueado → 403 (avançou de fase ou já recalculou)
 *  - Se existe e ainda dá pra recalcular → incrementa recalcCount
 *  - Sempre força treinoPhase='1.0' e dietaPhase='1.0' + reseta phaseStartedAt
 */
export async function POST(req) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return jsonRes(req, { ok: false, error: auth.error }, { status: auth.status });

    const incoming = await req.json();
    const existing = await getProtocol(auth.email);
    const nowISO = new Date().toISOString();

    let recalcCount = 0;
    let createdAt = nowISO;

    if (existing) {
      const lockedByPhase = !!existing.lockedFromRecalc
        || (existing.treinoPhase && existing.treinoPhase !== '1.0')
        || (existing.dietaPhase && existing.dietaPhase !== '1.0');
      if (lockedByPhase) {
        return jsonRes(req, {
          ok: false,
          error: 'RECÁLCULO BLOQUEADO: tu já avançou pra Fase 2.0 ou 3.0. Não dá pra recalcular o protocolo agora.',
          code: 'LOCKED_BY_PHASE'
        }, { status: 403 });
      }
      if ((existing.recalcCount || 0) >= 1) {
        return jsonRes(req, {
          ok: false,
          error: 'RECÁLCULO BLOQUEADO: tu já refez o cálculo uma vez. Cada aluno pode recalcular apenas 1 vez.',
          code: 'RECALC_USED'
        }, { status: 403 });
      }
      recalcCount = (existing.recalcCount || 0) + 1;
      createdAt = existing.createdAt || nowISO;
    }

    // Sanitize: pega só os campos esperados, ignora qualquer manipulação client-side de fase/lock/contadores
    const protocol = {
      email: auth.email,
      sex: incoming.sex,
      age: incoming.age,
      weight: incoming.weight,
      height: incoming.height,
      activity: incoming.activity,
      activityFactor: incoming.activityFactor,
      bf: incoming.bf,
      bfAdjust: incoming.bfAdjust,
      goal: incoming.goal,
      goalAdjust: incoming.goalAdjust,
      days: incoming.days,
      tmb: incoming.tmb,
      maintenance: incoming.maintenance,
      target: incoming.target,
      diet: incoming.diet,
      workout: incoming.workout,
      protein: incoming.protein,
      carb: incoming.carb,
      fat: incoming.fat,
      dietBase: incoming.diet, // base original pra ajustes de fase futuros
      // ─── server-controlled (não confia no client) ───
      treinoPhase: '1.0',
      dietaPhase: '1.0',
      createdAt,
      recalcCount,
      lockedFromRecalc: false,
      phaseStartedAt: { treino: nowISO, dieta: nowISO },
    };

    await setProtocol(auth.email, protocol);
    return jsonRes(req, { ok: true, protocol });
  } catch (err) {
    console.error('protocol/save error:', err);
    return jsonRes(req, { ok: false, error: 'Erro interno: ' + (err?.message || 'desconhecido') }, { status: 500 });
  }
}
