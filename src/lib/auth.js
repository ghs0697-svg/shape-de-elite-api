// Helpers de auth + CORS para o backend Shape de Elite
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// CORS — libera o app frontend
const ALLOWED_ORIGINS = [
  'https://app.shapedeelite.com.br',
  'http://app.shapedeelite.com.br',
  'https://shapedeelite.com.br',
  'http://shapedeelite.com.br',
  'https://ghs0697-svg.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

export function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function withCors(req, response) {
  const origin = req.headers.get('origin') || '';
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export function preflight(req) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}

export function jsonRes(req, body, init = {}) {
  return withCors(req, NextResponse.json(body, init));
}

// KV
export async function getKV() {
  const mod = await import('@vercel/kv');
  return mod.kv;
}

// Sessões — token aleatório guardado em KV
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 dias

export function genToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createSession(email) {
  const kv = await getKV();
  const token = genToken();
  await kv.set(`shape:session:${token}`, email, { ex: SESSION_TTL });
  return token;
}

export async function emailFromToken(token) {
  if (!token) return null;
  const kv = await getKV();
  return await kv.get(`shape:session:${token}`);
}

export async function destroySession(token) {
  if (!token) return;
  const kv = await getKV();
  await kv.del(`shape:session:${token}`);
}

// Bcrypt
export async function hashPassword(pwd) {
  return bcrypt.hash(pwd, 10);
}
export async function verifyPassword(pwd, hash) {
  if (!hash) return false;
  return bcrypt.compare(pwd, hash);
}

// Email normalize
export function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

// Auth gate — usa header Authorization: Bearer <token>
// Verifica:
//  1. token bate com session na KV
//  2. token === user.currentToken (single session)
//  3. user.status !== 'cancelled'
// Retorna { email, token, user } se OK; { error, status } se falhou.
export async function requireAuth(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { error: 'Sessão inválida', status: 401 };

  const email = await emailFromToken(token);
  if (!email) return { error: 'Sessão expirada', status: 401 };

  const kv = await getKV();
  const user = await kv.get(`shape:user:${email}`);
  if (!user) return { error: 'Conta não encontrada', status: 401 };

  // Single session: o token usado tem que ser o atual
  if (user.currentToken && user.currentToken !== token) {
    return { error: 'Sessão expirada (login em outro dispositivo)', status: 401 };
  }

  // Status check
  if (user.status === 'cancelled') {
    return { error: 'Conta cancelada (reembolso/cancelamento). Fala no suporte.', status: 403 };
  }

  return { email, token, user };
}

// Substitui o currentToken do user — invalida sessão anterior
export async function rotateUserToken(email, newToken) {
  const kv = await getKV();
  const user = (await kv.get(`shape:user:${email}`)) || {};
  // Apaga sessão antiga (best-effort)
  if (user.currentToken && user.currentToken !== newToken) {
    await kv.del(`shape:session:${user.currentToken}`).catch(() => {});
  }
  user.currentToken = newToken;
  user.lastLogin = Date.now();
  await kv.set(`shape:user:${email}`, user);
}

// ─── Protocol helpers ───
const MS_PER_DAY = 1000 * 60 * 60 * 24;
// Janela inicial de 8 dias após o cadastro — sai da garantia de 7 dias do Greenn
// e libera todas as fases (treino 2.0/3.0 + dieta 2.0/3.0) pra quem quiser acelerar.
// O aviso "faz pelo menos 1 semana antes de pular" fica como soft warning na UI.
export const INITIAL_GATE_DAYS = 8;
export const PHASE_LOCK_DAYS = INITIAL_GATE_DAYS; // backwards-compat alias
const DIET_ORDER = ['1.3K','1.5K','1.8K','2K','2.2K','2.5K','2.7K','3K','3.2K','3.5K'];
const DIET_KCAL  = { '1.3K':1300, '1.5K':1500, '1.8K':1800, '2K':2000, '2.2K':2200, '2.5K':2500, '2.7K':2700, '3K':3000, '3.2K':3200, '3.5K':3500 };

export async function getProtocol(email) {
  const kv = await getKV();
  return await kv.get(`shape:protocol:${email}`);
}

export async function setProtocol(email, protocol) {
  const kv = await getKV();
  protocol.updatedAt = new Date().toISOString();
  await kv.set(`shape:protocol:${email}`, protocol);
  return protocol;
}

export function adjustDietForPhase(currentDietName, goal, phaseStep) {
  const cur = String(currentDietName || '').replace(/^DIETA\s+/, '');
  const idx = DIET_ORDER.indexOf(cur);
  if (idx < 0) return currentDietName;
  let delta = 0;
  if (goal === 'Emagrecer') delta = -phaseStep;
  else if (goal === 'Ganhar massa') delta = +phaseStep;
  const newIdx = Math.max(0, Math.min(DIET_ORDER.length - 1, idx + delta));
  return 'DIETA ' + DIET_ORDER[newIdx];
}

export function dietKcal(dietName) {
  const cur = String(dietName || '').replace(/^DIETA\s+/, '');
  return DIET_KCAL[cur] || 0;
}

export function daysSince(isoDate) {
  if (!isoDate) return 0;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / MS_PER_DAY);
}

// Busca recursiva por uma chave em objeto aninhado (1ª string não-vazia que casar)
export function findKeyDeep(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === key.toLowerCase() && typeof obj[k] === 'string' && obj[k]) return obj[k];
  }
  for (const k of Object.keys(obj)) {
    if (obj[k] && typeof obj[k] === 'object') {
      const r = findKeyDeep(obj[k], key);
      if (r) return r;
    }
  }
  return null;
}

// Extrai telefone de qualquer payload (vários nomes de campo possíveis)
export function extractPhone(obj) {
  return findKeyDeep(obj, 'cellphone') || findKeyDeep(obj, 'phone') ||
         findKeyDeep(obj, 'whatsapp') || findKeyDeep(obj, 'celular') ||
         findKeyDeep(obj, 'telefone') || findKeyDeep(obj, 'mobile') || '';
}
