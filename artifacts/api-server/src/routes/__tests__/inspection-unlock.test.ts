import {
  companiesTable,
  db,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Manager-only unlock of a submitted (locked) inspection: role gate, required
// reason, append-only audit log, and idempotency of the not-locked case.

const RUN_ID = `unlock-${Date.now().toString(36)}`;
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });
const companyA = `TEST-UNLOCK-${RUN_ID}-A`.toUpperCase();
const companyB = `TEST-UNLOCK-${RUN_ID}-B`.toUpperCase();

async function seedUser(label: string, role: 'field_rep' | 'manager', companyId: string) {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `unlock-${label}-${RUN_ID}@example.test`, firstName: 'Mgr', lastName: label })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department: 'inspector_canvasser' });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });
  return { userId: user.id, sid };
}

let rep: { userId: string; sid: string };
let manager: { userId: string; sid: string };
let managerB: { userId: string; sid: string };
const inspectionIds: string[] = [];

async function seedLockedInspection() {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyA,
      inspectorUserId: rep.userId,
      phase: 'forensic',
      status: 'submitted',
      lockedAt: new Date('2026-07-01T12:00:00Z'),
      submissionManifest: { records: {}, photoHashes: [] },
    })
    .returning();
  inspectionIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: companyA, name: `UnlockCo A ${RUN_ID}` },
    { id: companyB, name: `UnlockCo B ${RUN_ID}` },
  ]);
  rep = await seedUser('rep', 'field_rep', companyA);
  manager = await seedUser('mgr', 'manager', companyA);
  managerB = await seedUser('mgr-b', 'manager', companyB);
});

afterAll(async () => {
  if (inspectionIds.length) {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, inspectionIds));
  }
});

describe('POST /inspections/:id/unlock', () => {
  it('field reps cannot unlock', async () => {
    const id = await seedLockedInspection();
    const res = await request(app).post(`/api/inspections/${id}/unlock`).set(auth(rep.sid)).send({ reason: 'please' });
    expect(res.status).toBe(403);
  });

  it('cross-tenant managers get 404', async () => {
    const id = await seedLockedInspection();
    const res = await request(app)
      .post(`/api/inspections/${id}/unlock`)
      .set(auth(managerB.sid))
      .send({ reason: 'not my company' });
    expect(res.status).toBe(404);
  });

  it('requires a reason', async () => {
    const id = await seedLockedInspection();
    const res = await request(app).post(`/api/inspections/${id}/unlock`).set(auth(manager.sid)).send({});
    expect(res.status).toBe(400);
    const blank = await request(app)
      .post(`/api/inspections/${id}/unlock`)
      .set(auth(manager.sid))
      .send({ reason: '   ' });
    expect(blank.status).toBe(400);
  });

  it('manager unlock clears the lock, reverts status, and appends a server-stamped audit entry', async () => {
    const id = await seedLockedInspection();
    const res = await request(app)
      .post(`/api/inspections/${id}/unlock`)
      .set(auth(manager.sid))
      .send({ reason: 'Add evidence links to estimate lines' });
    expect(res.status).toBe(200);
    expect(res.body.inspection.lockedAt).toBeNull();
    expect(res.body.inspection.status).toBe('capturing');
    expect(res.body.unlockEvent.unlockedBy).toBe(manager.userId);
    expect(res.body.unlockEvent.previousLockedAt).toBe('2026-07-01T12:00:00.000Z');

    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
    expect(row.lockedAt).toBeNull();
    expect(row.status).toBe('capturing');
    const log = row.unlockLog;
    expect(log).toHaveLength(1);
    expect(log[0].reason).toBe('Add evidence links to estimate lines');
    expect(log[0].unlockedBy).toBe(manager.userId);
    // Prior submission manifest is preserved until re-submission replaces it.
    expect(row.submissionManifest).not.toBeNull();

    // Second unlock of the now-unlocked record is a 400, not a silent no-op.
    const again = await request(app)
      .post(`/api/inspections/${id}/unlock`)
      .set(auth(manager.sid))
      .send({ reason: 'again' });
    expect(again.status).toBe(400);
  });

  it('concurrent unlocks append exactly one audit entry', async () => {
    const id = await seedLockedInspection();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post(`/api/inspections/${id}/unlock`)
          .set(auth(manager.sid))
          .send({ reason: `race attempt ${i}` }),
      ),
    );
    const wins = results.filter((r) => r.status === 200);
    expect(wins).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
    expect(row.unlockLog).toHaveLength(1);
  });

  it('unlock → edit → re-lock appends (never overwrites) the audit log', async () => {
    const id = await seedLockedInspection();
    await request(app).post(`/api/inspections/${id}/unlock`).set(auth(manager.sid)).send({ reason: 'first reopen' });
    // Simulate re-submission re-locking the record.
    await db
      .update(inspectionsTable)
      .set({ status: 'submitted', lockedAt: new Date() })
      .where(eq(inspectionsTable.id, id));
    const res = await request(app)
      .post(`/api/inspections/${id}/unlock`)
      .set(auth(manager.sid))
      .send({ reason: 'second reopen' });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
    expect(row.unlockLog.map((u) => u.reason)).toEqual(['first reopen', 'second reopen']);
  });
});
