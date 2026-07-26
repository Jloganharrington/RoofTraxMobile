import type { AuthUser } from '@workspace/api-zod';
import { type NextFunction, type Request, type Response } from 'express';
import * as oidc from 'openid-client';

import {
  clearSession,
  getOidcConfig,
  getSession,
  getSessionId,
  updateSession,
  type SessionData,
} from '../lib/auth';

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

// Concurrent requests on the same session must NOT each attempt a token
// refresh: OIDC refresh tokens are single-use (rotated on each grant), so
// parallel refreshes race — the first wins, the rest get an error, and
// treating that error as "invalid session" destroyed a perfectly good login.
// Dedupe in-flight refreshes per sid, and on failure re-read the session
// from the DB before giving up (a sibling request may have just refreshed
// and rotated the tokens for us).
const inflightRefreshes = new Map<string, Promise<SessionData | null>>();

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  const existing = inflightRefreshes.get(sid);
  if (existing) return existing;

  const refreshPromise = (async (): Promise<SessionData | null> => {
    try {
      const config = await getOidcConfig();
      const tokens = await oidc.refreshTokenGrant(config, session.refresh_token!);
      session.access_token = tokens.access_token;
      session.refresh_token = tokens.refresh_token ?? session.refresh_token;
      session.expires_at = tokens.expiresIn()
        ? Math.floor(Date.now() / 1000) + tokens.expiresIn()!
        : session.expires_at;
      await updateSession(sid, session);
      return session;
    } catch {
      // The grant failed — most commonly because another server instance or
      // an earlier request already used (and rotated) this refresh token.
      // Re-read the stored session: if it now carries fresh tokens, use it
      // instead of destroying the login.
      const latest = await getSession(sid);
      if (
        latest?.user?.id &&
        (!latest.expires_at || Math.floor(Date.now() / 1000) <= latest.expires_at)
      ) {
        return latest;
      }
      return null;
    }
  })().finally(() => {
    inflightRefreshes.delete(sid);
  });

  inflightRefreshes.set(sid, refreshPromise);
  return refreshPromise;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request['isAuthenticated'];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  next();
}
