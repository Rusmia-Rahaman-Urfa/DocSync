import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, sessionSecret } from './db.js';

export const SESSION_COOKIE = 'docsync_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

export function createSessionToken(userId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload), 'hex');
  const received = Buffer.from(signature, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.uid !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp < now) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === 'true' || Boolean(process.env.RENDER),
  };
}

export function setSessionCookie(res, userId) {
  res.cookie(SESSION_COOKIE, createSessionToken(userId), {
    ...cookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function findUserById(id) {
  if (!id) return null;
  return (
    getDb()
      .prepare('SELECT id, name, email, color FROM users WHERE id = ?')
      .get(id) ?? null
  );
}

/** Resolve the signed-in user for a request, or null. */
export function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const userId = readSessionToken(cookies[SESSION_COOKIE]);
  return findUserById(userId);
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Please sign in to continue.' });
  }
  req.user = user;
  return next();
}
