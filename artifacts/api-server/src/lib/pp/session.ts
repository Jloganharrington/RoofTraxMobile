/**
 * PP (Proof Package) subscriber sessions.
 *
 * PP sessions use the SAME sessions table as OIDC sessions so all existing
 * middleware (requirePermission, authMiddleware) works without modification.
 * The session data carries session_type: 'pp' as a discriminator.
 *
 * Lifetime: PP_SESSION_TTL_MS (30 days). No OIDC refresh token — when the
 * session expires the user re-authenticates via POST /api/pp/login.
 */
import crypto from 'node:crypto';
import type { AuthUser } from '@workspace/api-zod';
import { db, sessionsTable } from '@workspace/db';
import { SESSION_COOKIE, type SessionData } from '../auth';
import type { Response } from 'express';

/** 30-day session lifetime for PP accounts (longer than the 7-day OIDC default). */
const PP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PP_SESSION_TTL_S = Math.floor(PP_SESSION_TTL_MS / 1000);

/**
 * Create a PP session for the given user and set the session cookie.
 *
 * Inserts directly into sessionsTable with a 30-day DB expire (instead of
 * calling createSession, which always uses the 7-day OIDC SESSION_TTL).
 * Returns the session ID.
 */
export async function createPPSession(user: AuthUser, res: Response): Promise<string> {
  const sid = crypto.randomBytes(32).toString('hex');
  const data: SessionData = {
    user,
    access_token: '',          // PP accounts have no OIDC access token
    session_type: 'pp',
    expires_at: Math.floor(Date.now() / 1000) + PP_SESSION_TTL_S,
  };
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + PP_SESSION_TTL_MS), // 30-day DB expiry
  });
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PP_SESSION_TTL_MS,
  });
  return sid;
}
