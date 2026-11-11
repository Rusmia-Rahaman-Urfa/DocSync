import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

/** Hash a password with scrypt. Format: scrypt$<salt>$<hash> */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Constant-time password verification. Never throws on malformed input. */
export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored ?? '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(String(password), salt, KEY_LEN);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
