/**
 * Trial-account sessions — separate, lightweight auth track for
 * pre-tenant trial accounts (spec §1: /proof-package/* authed routes).
 * Bearer token in the Authorization header; token is a DB row so it
 * survives restarts and can be revoked.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, trialAccounts, trialSessions, type TrialAccount } from '@workspace/db';
import type { NextFunction, Request, Response } from 'express';

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function createTrialSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.insert(trialSessions).values({
    token,
    accountId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function getTrialAccountByToken(token: string): Promise<TrialAccount | null> {
  const [session] = await db.select().from(trialSessions).where(eq(trialSessions.token, token));
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.delete(trialSessions).where(eq(trialSessions.token, token));
    return null;
  }
  const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, session.accountId));
  return account ?? null;
}

declare global {
  namespace Express {
    interface Request {
      trialAccount?: TrialAccount;
    }
  }
}

/** Require a valid trial session; sets req.trialAccount. */
export async function requireTrialAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const account = await getTrialAccountByToken(token);
  if (!account) {
    res.status(401).json({ error: 'Session expired' });
    return;
  }
  req.trialAccount = account;
  next();
}
