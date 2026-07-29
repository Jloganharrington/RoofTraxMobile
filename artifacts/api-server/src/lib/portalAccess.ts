import { randomBytes } from 'node:crypto';
import type { Request } from 'express';

// Unambiguous alphabet (no 0/O, 1/I/L) — codes are read over the phone and
// typed from a printed report. 12 chars of base-31 ≈ 59 bits of entropy:
// unguessable, and the code is the sole capability for portal access.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 12;

/** Generate a portal share code like `A7KM-3QRD-XW29`. */
export function generatePortalAccessCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if ((i + 1) % 4 === 0 && i !== CODE_LENGTH - 1) out += '-';
  }
  return out;
}

/**
 * Normalize user input for lookup: uppercase, strip whitespace and dashes,
 * then re-insert canonical dashes. Returns null when the shape is wrong.
 */
export function normalizePortalAccessCode(raw: string): string | null {
  const bare = raw.toUpperCase().replace(/[\s-]/g, '');
  if (bare.length !== CODE_LENGTH) return null;
  for (const ch of bare) if (!CODE_ALPHABET.includes(ch)) return null;
  return `${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8, 12)}`;
}

/**
 * Build the portal-access block for report rendering from the serving
 * request's origin — never a hardcoded/stored domain, so packages compiled
 * in development and production each print their own correct URL.
 * Returns null when the inspection has no code yet.
 */
export function buildPortalAccessFromRequest(
  req: Request,
  portalAccessCode: string | null,
): { url: string; code: string } | null {
  if (!portalAccessCode) return null;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.headers.host;
  if (!host) return null;
  return { url: `${proto}://${host}/photo-portal/`, code: portalAccessCode };
}
