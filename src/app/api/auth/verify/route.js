import { preflight, jsonRes, requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

export async function GET(req) {
  const { email } = await requireAuth(req);
  if (!email) return jsonRes(req, { ok: false }, { status: 401 });
  return jsonRes(req, { ok: true, email });
}
