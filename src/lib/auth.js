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
export async function requireAuth(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const email = await emailFromToken(token);
  return { email, token };
}
