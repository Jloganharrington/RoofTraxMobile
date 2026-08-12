/**
 * Password hashing and verification using Node.js built-in crypto.scrypt.
 * No third-party dependency — uses PBKDF2-class scrypt with a random salt.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

/** Hash a plaintext password. Returns "<salt>:<derivedKeyHex>". */
export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

/** Verify a plaintext password against a stored hash. Returns true iff match. */
export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const idx = stored.indexOf(':');
  if (idx === -1) return Promise.resolve(false);
  const salt = stored.slice(0, idx);
  const keyHex = stored.slice(idx + 1);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else {
        try {
          resolve(timingSafeEqual(Buffer.from(keyHex, 'hex'), key));
        } catch {
          resolve(false);
        }
      }
    });
  });
}
