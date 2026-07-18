import crypto from 'node:crypto';

// Encrypts per-user SMTP passwords at rest. AES-256-GCM keyed off
// SESSION_SECRET (already a required server secret). Format:
// v1:<iv b64>:<tag b64>:<ciphertext b64>. This is defense-in-depth against a
// leaked DB dump — anyone with SESSION_SECRET has the server anyway.
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.createHash('sha256').update(`smtp:${secret}`).digest();
}

export function encryptSmtpPassword(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSmtpPassword(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognized SMTP password format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
