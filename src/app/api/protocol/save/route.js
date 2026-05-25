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
      // Trava recalc: só se já avançou de fase manualmente OU já usou o recálculo 1x
      // (não mais checa treinoPhase !== '1.0', pq agora intermediário/avançado já começam em 2.0/3.0)
      if (existing.lockedFromRecalc) {
        return jsonRes(req, {
          ok: false,
          error: 'RECÁLCULO BLOQUEADO: tu já avançou de fase manualmente. Não dá pra recalcular o protocolo agora.',
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

    // Mapeia nível → fase inicial de treino
    // Iniciante: começa do zero (1.0). Intermediário: pula adaptação (2.0). Avançado: vai direto na 3.0.
    // Dieta sempre começa em 1.0 (depende da régua kcal, não da experiência).
    const level = ['iniciante', 'intermediario', 'avancado'].includes(incoming.level) ? incoming.level : 'iniciante';
    const treinoPhaseByLevel = { iniciante: '1.0', intermediario: '2.0', avancado: '3.0' };
    const initialTreinoPhase = treinoPhaseByLevel[level];

    // Recalcula workout com a fase inicial correta
    const sex = incoming.sex === 'Mulher' ? ' FEM' : '';
    const days = incoming.days;
    const workoutWithPhase = `TREINO${sex} ${days}X ${initialTreinoPhase}`;

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
      level,
      tmb: incoming.tmb,
      maintenance: incoming.maintenance,
      target: incoming.target,
      diet: incoming.diet,
      workout: workoutWithPhase,
      protein: incoming.protein,
      carb: incoming.carb,
      fat: incoming.fat,
      dietBase: incoming.diet, // base original pra ajustes de fase futuros
      // ─── server-controlled (não confia no client) ───
      treinoPhase: initialTreinoPhase,
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
