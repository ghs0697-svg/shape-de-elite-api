import {
  preflight, jsonRes, requireAuth, getProtocol, setProtocol,
  PHASE_LOCK_DAYS, daysSince, adjustDietForPhase, dietKcal
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

/**
 * POST /api/protocol/advance-phase
 * Body: { kind: 'treino'|'dieta', targetPhase: '2.0'|'3.0', newDays?: number (só treino) }
 *
 * Validações server-side (anti-piracy):
 *  - Protocol existe
 *  - Transição válida (1.0→2.0 ou 2.0→3.0)
 *  - 120 dias passaram desde phaseStartedAt[kind] (server time, não confia no client)
 *
 * Atualiza:
 *  - phaseStartedAt[kind] = NOW
 *  - lockedFromRecalc = true
 *  - Treino: treinoPhase, days, workout
 *  - Dieta: dietaPhase, diet, target, protein/carb/fat
 */
export async function POST(req) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return jsonRes(req, { ok: false, error: auth.error }, { status: auth.status });

    const { kind, targetPhase, newDays } = await req.json();
    if (!['treino', 'dieta'].includes(kind)) {
      return jsonRes(req, { ok: false, error: 'kind inválido' }, { status: 400 });
    }
    if (!['2.0', '3.0'].includes(targetPhase)) {
      return jsonRes(req, { ok: false, error: 'targetPhase inválido' }, { status: 400 });
    }

    const p = await getProtocol(auth.email);
    if (!p) {
      return jsonRes(req, { ok: false, error: 'Protocolo não encontrado. Faz a calculadora primeiro.' }, { status: 404 });
    }

    const curPhase = (kind === 'treino' ? p.treinoPhase : p.dietaPhase) || '1.0';
    const expected = curPhase === '1.0' ? '2.0' : (curPhase === '2.0' ? '3.0' : null);
    if (targetPhase !== expected) {
      return jsonRes(req, { ok: false, error: `Transição inválida: tu tá na ${curPhase}, só pode avançar pra ${expected || 'nada (já no máximo)'}.` }, { status: 400 });
    }

    // Validação de 120 dias (server time)
    const startedAt = p.phaseStartedAt?.[kind];
    const daysIn = daysSince(startedAt);
    if (daysIn < PHASE_LOCK_DAYS) {
      const daysLeft = PHASE_LOCK_DAYS - daysIn;
      return jsonRes(req, {
        ok: false,
        code: 'PHASE_LOCKED',
        error: `Faltam ${daysLeft} dias pra desbloquear a Fase ${targetPhase} ${kind === 'treino' ? 'do treino' : 'da dieta'}. Tu tá no dia ${daysIn}/${PHASE_LOCK_DAYS}.`,
        daysLeft, daysIn
      }, { status: 403 });
    }

    const nowISO = new Date().toISOString();
    const phaseStartedAt = { ...(p.phaseStartedAt || {}) };
    phaseStartedAt[kind] = nowISO;

    let updated = { ...p, phaseStartedAt, lockedFromRecalc: true };

    if (kind === 'treino') {
      const days = newDays || p.days;
      if (![3, 4, 5, 6].includes(days)) {
        return jsonRes(req, { ok: false, error: 'newDays inválido (3, 4, 5 ou 6)' }, { status: 400 });
      }
      const sex = p.sex === 'Mulher' ? ' FEM' : '';
      const newWorkout = `TREINO${sex} ${days}X ${targetPhase}`;
      updated = { ...updated, treinoPhase: targetPhase, days, workout: newWorkout };
    } else {
      const phaseStep = targetPhase === '2.0' ? 1 : 2;
      const dietBase = p.dietBase || p.diet;
      const newDiet = adjustDietForPhase(dietBase, p.goal, phaseStep);
      const newKcal = dietKcal(newDiet) || p.target;
      const proteinPerKg = p.goal === 'Emagrecer' ? 2.0 : (p.goal === 'Recompor' ? 1.8 : 1.6);
      const protein = Math.round(p.weight * proteinPerKg);
      const fat = Math.round((newKcal * 0.25) / 9);
      const carb = Math.round((newKcal - protein * 4 - fat * 9) / 4);
      updated = { ...updated, dietaPhase: targetPhase, diet: newDiet, target: newKcal, protein, carb, fat };
    }

    await setProtocol(auth.email, updated);
    return jsonRes(req, { ok: true, protocol: updated });
  } catch (err) {
    console.error('advance-phase error:', err);
    return jsonRes(req, { ok: false, error: 'Erro interno: ' + (err?.message || 'desconhecido') }, { status: 500 });
  }
}
