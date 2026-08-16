/**
 * Dev-only routes — unavailable in production (404 gate at top of each handler).
 *
 * POST /dev/login-as   Mint a real session for the first active user with the
 *                      requested role. Lets testers exercise different permission
 *                      levels in Expo without maintaining separate OIDC accounts.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, userProfilesTable, usersTable } from '@workspace/db';
import { createSession } from '../lib/auth';
import { Router, type Request, type Response } from 'express';

const VALID_ROLES = ['field_rep', 'manager', 'admin', 'super_admin'] as const;
type DevRole = (typeof VALID_ROLES)[number];

const router = Router();

router.post('/dev/login-as', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== 'development') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { role, companyId } = req.body as { role?: string; companyId?: string };

  if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({
      error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`,
    });
    return;
  }

  // Build WHERE clauses: matching role + active user, optionally in a company.
  const conditions = [
    eq(userProfilesTable.role, role as DevRole),
    isNull(usersTable.deactivatedAt),
  ];
  if (companyId) {
    conditions.push(eq(usersTable.companyId, companyId));
  }

  const [match] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      companyId: usersTable.companyId,
    })
    .from(userProfilesTable)
    .innerJoin(usersTable, eq(userProfilesTable.userId, usersTable.id))
    .where(and(...conditions))
    .limit(1);

  if (!match?.companyId) {
    res.status(404).json({
      error: `No active ${role} found${companyId ? ` in company ${companyId}` : ''}. Seed one first.`,
    });
    return;
  }

  const token = await createSession({
    user: {
      id: match.id,
      email: match.email ?? null,
      firstName: match.firstName ?? null,
      lastName: match.lastName ?? null,
      profileImageUrl: match.profileImageUrl ?? null,
      companyId: match.companyId,
    },
    access_token: `dev-token-${role}`,
    session_type: 'oidc',
  });

  res.json({ token, userId: match.id, role, companyId: match.companyId });
});

export default router;
