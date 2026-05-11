import { preflight, jsonRes, requireAuth, getProtocol } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req) { return preflight(req); }

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return jsonRes(req, { ok: false, error: auth.error }, { status: auth.status });

  const protocol = await getProtocol(auth.email);
  return jsonRes(req, { ok: true, exists: !!protocol, protocol: protocol || null });
}
