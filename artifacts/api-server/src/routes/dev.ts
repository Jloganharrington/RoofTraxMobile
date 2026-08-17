/**
 * Developer-tools routes — protected by HTTP Basic Auth using the
 * DEV_TOOL_USERNAME / DEV_TOOL_PASSWORD environment secrets.
 *
 * These routes are intentionally available in all environments (including
 * production) so the developer can exercise persona switching without a
 * separate build. The Basic Auth wall ensures only the developer can use them.
 *
 * POST /dev/login-as   Mint a real session for the first active user matching
 *                      the requested persona (role + department + workflow).
 *                      Lets the developer exercise every distinct mobile
 *                      experience without maintaining separate OIDC accounts.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, userProfilesTable, usersTable } from '@workspace/db';
import type { Role, WorkflowAssignment } from '@workspace/db';
import { createSession } from '../lib/auth';
import { Router, type Request, type Response } from 'express';

type Department = 'canvasser' | 'inspector_canvasser' | 'office';

interface PersonaSpec {
  role: Role;
  workflowAssignment?: WorkflowAssignment;
  department?: Department;
}

/**
 * Maps the 7 mobile personas to the exact DB column values used to locate a
 * representative user. Every persona is fully discriminated by role +
 * department + workflowAssignment so the query is deterministic even when
 * multiple users share the same role.
 *
 * Fixture counterparts (phase1-fixture.ts):
 *   canvasser-retail    → A-CANV-1   (field_rep / canvasser / retail)
 *   canvasser-insurance → A-CANV-INS (field_rep / canvasser / insurance)
 *   canvasser-both      → A-CANV-BOTH(field_rep / canvasser / insurance_retail)
 *   field-rep           → A-INSP-1   (field_rep / inspector_canvasser / insurance_retail)
 *   manager             → A-MGR-F    (manager   / inspector_canvasser / insurance_retail)
 *   admin               → A-ADMIN    (admin     / office              / insurance_retail)
 *   super-admin         → A-SUPER    (super_admin / office            / insurance_retail)
 */
const PERSONA_MAP: Record<string, PersonaSpec> = {
  'canvasser-retail':    { role: 'field_rep',   department: 'canvasser',           workflowAssignment: 'retail' },
  'canvasser-insurance': { role: 'field_rep',   department: 'canvasser',           workflowAssignment: 'insurance' },
  'canvasser-both':      { role: 'field_rep',   department: 'canvasser',           workflowAssignment: 'insurance_retail' },
  'field-rep':           { role: 'field_rep',   department: 'inspector_canvasser', workflowAssignment: 'insurance_retail' },
  'manager':             { role: 'manager',     department: 'inspector_canvasser', workflowAssignment: 'insurance_retail' },
  'admin':               { role: 'admin',       department: 'office',              workflowAssignment: 'insurance_retail' },
  'super-admin':         { role: 'super_admin', department: 'office',              workflowAssignment: 'insurance_retail' },
};

/**
 * Constant-time string comparison — prevents timing-based credential guessing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify the incoming Authorization: Basic <b64> header against the
 * DEV_TOOL_USERNAME / DEV_TOOL_PASSWORD secrets.
 * Returns true if valid, false otherwise (or if secrets are not configured).
 */
function checkBasicAuth(req: Request, res: Response): boolean {
  const expectedUser = process.env.DEV_TOOL_USERNAME;
  const expectedPass = process.env.DEV_TOOL_PASSWORD;

  if (!expectedUser || !expectedPass) {
    res.status(503).json({ error: 'Dev tools are not configured (missing DEV_TOOL_USERNAME / DEV_TOOL_PASSWORD).' });
    return false;
  }

  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Developer Tools"');
    res.status(401).json({ error: 'Developer authentication required.' });
    return false;
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const colonIdx = decoded.indexOf(':');
  const providedUser = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
  const providedPass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';

  if (!timingSafeEqual(providedUser, expectedUser) || !timingSafeEqual(providedPass, expectedPass)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Developer Tools"');
    res.status(401).json({ error: 'Invalid developer credentials.' });
    return false;
  }

  return true;
}

const router = Router();

/**
 * POST /dev/verify
 * Checks username + password against server-side secrets and returns a
 * specific error for each failure case so the mobile gate can show the right
 * message without ever baking credentials into the bundle.
 */
router.post('/dev/verify', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const expectedUser = (process.env.DEV_TOOL_USERNAME ?? '').trim();
  const expectedPass = (process.env.DEV_TOOL_PASSWORD ?? '').trim();

  if (!expectedUser || !expectedPass) {
    res.status(503).json({ error: 'Dev tools are not configured on this server.' });
    return;
  }

  // Run both comparisons before branching to avoid timing leaks.
  const userOk = timingSafeEqual((username ?? '').trim(), expectedUser);
  const passOk = timingSafeEqual((password ?? '').trim(), expectedPass);

  if (!userOk) {
    res.status(401).json({ error: 'Username not found.' });
    return;
  }
  if (!passOk) {
    res.status(401).json({ error: 'Password is incorrect.' });
    return;
  }

  res.json({ ok: true });
});

router.post('/dev/login-as', async (req: Request, res: Response) => {
  if (!checkBasicAuth(req, res)) return;

  const { persona, companyId } = req.body as { persona?: string; companyId?: string };

  const spec = persona ? PERSONA_MAP[persona] : undefined;
  if (!spec) {
    res.status(400).json({
      error: `Invalid persona. Must be one of: ${Object.keys(PERSONA_MAP).join(', ')}`,
    });
    return;
  }

  // Build WHERE clauses from the persona spec.
  const conditions = [
    eq(userProfilesTable.role, spec.role),
    isNull(usersTable.deactivatedAt),
  ];
  if (spec.workflowAssignment) {
    conditions.push(eq(userProfilesTable.workflowAssignment, spec.workflowAssignment));
  }
  if (spec.department) {
    conditions.push(eq(userProfilesTable.department, spec.department));
  }
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
    .orderBy(asc(usersTable.createdAt), asc(usersTable.id))
    .limit(1);

  if (!match?.companyId) {
    res.status(404).json({
      error: `No active "${persona}" user found${companyId ? ` in company ${companyId}` : ''}. Seed one first.`,
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
    access_token: `dev-token-${persona}`,
    session_type: 'oidc',
  });

  res.json({ token, userId: match.id, persona, companyId: match.companyId });
});

export default router;
