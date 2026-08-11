/**
 * profile-me.test.ts
 *
 * Regression guard for GET /api/profile/me.
 *
 * The route is gated by requirePermission('profile.read').  In August 2026
 * that permission's kind was briefly changed to 'floor' then 'selfOnly',
 * which silently caused the route to return 403 for every authenticated user.
 * The outage shipped clean because no test covered basic per-role reachability.
 *
 * This file closes that gap:
 *   • All four roles must receive 200.
 *   • Unauthenticated must receive 401.
 *   • The response envelope must contain a `profile` object with the caller's
 *     userId — ruling out a 200 with an empty/wrong body.
 */

import {
  companiesTable,
  db,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `pme-${Date.now().toString(36)}`;

const ROLES = ['field_rep', 'manager', 'admin', 'super_admin'] as const;
type Role = (typeof ROLES)[number];

interface Actor { id: string; sid: string; role: Role; }

let companyId: string;
const actors: Actor[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  companyId = `PME-${RUN_ID}`.toUpperCase().slice(0, 40);
  await db.insert(companiesTable).values({ id: companyId, name: `PME Test ${RUN_ID}` });

  for (const role of ROLES) {
    const [user] = await db
      .insert(usersTable)
      .values({ companyId, email: `pme-${role}-${RUN_ID}@example.test` })
      .returning();
    await db.insert(userProfilesTable).values({ userId: user.id, role });
    const sid = await createSession({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        companyId,
      },
      access_token: 'test-token',
    });
    actors.push({ id: user.id, sid, role });
    createdUserIds.push(user.id);
  }
});

afterAll(async () => {
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId]));
});

// ── Gate: unauthenticated ─────────────────────────────────────────────────────

describe('GET /api/profile/me — authentication gate', () => {
  it('no auth → 401', async () => {
    const res = await request(app).get('/api/profile/me');
    expect(res.status).toBe(401);
  });
});

// ── Per-role reachability ─────────────────────────────────────────────────────
// Every authenticated role must receive 200 with a well-formed envelope.
// A 403 here indicates that requirePermission('profile.read') is resolving
// denied, which means either the kind or the minRole gate is misconfigured.

describe('GET /api/profile/me — 200 for every authenticated role', () => {
  for (const actor of ROLES.map(r => ({ role: r }))) {
    it(`${actor.role} → 200`, async () => {
      const { sid, id } = actors.find(a => a.role === actor.role)!;
      const res = await request(app)
        .get('/api/profile/me')
        .set('Authorization', `Bearer ${sid}`);

      expect(res.status).toBe(200);

      // The envelope must contain a profile object.
      expect(res.body).toHaveProperty('profile');
      expect(typeof res.body.profile).toBe('object');

      // The profile must reference the caller — not another user's data.
      expect(res.body.profile.userId).toBe(id);

      // companyId must be scoped to the caller's company.
      expect(res.body.profile.companyId).toBe(companyId);
    });
  }
});

// ── Non-overridable guard ────────────────────────────────────────────────────
// profile.read is marked overridable: false in the registry.
// Attempting to grant or revoke it per-user must return 422.
// This ensures that even a super_admin cannot accidentally remove an actor's
// ability to reach their own profile via the override system.

describe('profile.read override rejection', () => {
  it('POST /team/users/:id/permissions with profile.read → 422', async () => {
    const superAdmin = actors.find(a => a.role === 'super_admin')!;
    const fieldRep   = actors.find(a => a.role === 'field_rep')!;

    const res = await request(app)
      .post(`/api/team/users/${fieldRep.id}/permissions`)
      .set('Authorization', `Bearer ${superAdmin.sid}`)
      .send({ permission: 'profile.read', granted: false, note: 'should be rejected' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/non-overridable/i);
  });

  it('DELETE /team/users/:id/permissions/profile.read → 422', async () => {
    const superAdmin = actors.find(a => a.role === 'super_admin')!;
    const fieldRep   = actors.find(a => a.role === 'field_rep')!;

    const res = await request(app)
      .delete(`/api/team/users/${fieldRep.id}/permissions/profile.read`)
      .set('Authorization', `Bearer ${superAdmin.sid}`)
      .send({ note: 'should be rejected' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/non-overridable/i);
  });
});
