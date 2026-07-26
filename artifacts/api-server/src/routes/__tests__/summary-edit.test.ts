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

// PATCH /inspections/:id/summary — manual edit of the AI summary without
// regeneration: authz, lint enforcement on edited text, edit stamping, and
// preservation of generation metadata.

const RUN_ID = `sumedit-${Date.now().toString(36)}`;
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });
const companyA = `TEST-SUMEDIT-${RUN_ID}`.toUpperCase();

async function seedUser(label: string, role: 'field_rep' | 'manager') {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId: companyA, email: `sumedit-${label}-${RUN_ID}@example.test`, firstName: 'T', lastName: label })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department: 'inspector_canvasser' });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId: companyA,
    },
    access_token: 'test-access-token',
  });
  return { userId: user.id, sid };
}

let inspector: { userId: string; sid: string };
let peer: { userId: string; sid: string };
const inspectionIds: string[] = [];

async function seedInspection(opts: { withSummary?: boolean; locked?: boolean } = {}) {
  const { withSummary = true, locked = false } = opts;
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyA,
      inspectorUserId: inspector.userId,
      phase: 'forensic',
      status: locked ? 'submitted' : 'capturing',
      ...(locked ? { lockedAt: new Date() } : {}),
      ...(withSummary
        ? {
            aiSummary: {
              forensicSummary: 'The inspection documentation identifies hail impacts on two slopes.',
              repairabilityText: 'The repairability assessment records cracking during removal testing.',
              generatedAt: '2026-07-20T10:00:00.000Z',
            },
          }
        : {}),
    })
    .returning();
  inspectionIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: companyA, name: `SumEdit Co ${RUN_ID}` });
  inspector = await seedUser('insp', 'field_rep');
  peer = await seedUser('peer', 'field_rep');
});

afterAll(async () => {
  if (inspectionIds.length) {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, inspectionIds));
  }
});

describe('PATCH /inspections/:id/summary', () => {
  it('saves an edited forensic summary verbatim, stamps the edit, keeps generatedAt', async () => {
    const id = await seedInspection();
    const res = await request(app)
      .patch(`/api/inspections/${id}/summary`)
      .set(auth(inspector.sid))
      .send({ forensicSummary: 'The inspection record notes fractured shingles on the south slope.' });
    expect(res.status).toBe(200);
    expect(res.body.summary.forensicSummary).toBe(
      'The inspection record notes fractured shingles on the south slope.',
    );
    expect(res.body.summary.generatedAt).toBe('2026-07-20T10:00:00.000Z');
    expect(res.body.summary.editedAt).toBeTruthy();
    expect(res.body.summary.editedBy).toBe(inspector.userId);
    // Repairability untouched when not sent.
    expect(res.body.summary.repairabilityText).toContain('cracking during removal testing');
    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
    expect(row.aiSummary?.forensicSummary).toContain('fractured shingles');
  });

  it('re-lints edited text — advocacy language cannot bypass the lint', async () => {
    const id = await seedInspection();
    const res = await request(app)
      .patch(`/api/inspections/${id}/summary`)
      .set(auth(inspector.sid))
      .send({ forensicSummary: 'The carrier acted in bad faith and the insurer must pay for replacement.' });
    expect(res.status).toBe(200); // stored verbatim, never rewritten…
    expect(res.body.summary.lint.lintStatus).toBe('blocked'); // …but flagged
    expect(res.body.summary.lint.findings.length).toBeGreaterThan(0);
  });

  it('rejects empty summaries and empty payloads', async () => {
    const id = await seedInspection();
    expect((await request(app).patch(`/api/inspections/${id}/summary`).set(auth(inspector.sid)).send({ forensicSummary: '  ' })).status).toBe(400);
    expect((await request(app).patch(`/api/inspections/${id}/summary`).set(auth(inspector.sid)).send({})).status).toBe(400);
  });

  it('400s when no summary exists yet', async () => {
    const id = await seedInspection({ withSummary: false });
    const res = await request(app)
      .patch(`/api/inspections/${id}/summary`)
      .set(auth(inspector.sid))
      .send({ forensicSummary: 'Text' });
    expect(res.status).toBe(400);
  });

  it('a same-company peer without record-write authority gets 403', async () => {
    const id = await seedInspection();
    const res = await request(app)
      .patch(`/api/inspections/${id}/summary`)
      .set(auth(peer.sid))
      .send({ forensicSummary: 'Peer edit attempt' });
    expect(res.status).toBe(403);
  });

  it('works on a locked (submitted) inspection, matching regenerate', async () => {
    const id = await seedInspection({ locked: true });
    const res = await request(app)
      .patch(`/api/inspections/${id}/summary`)
      .set(auth(inspector.sid))
      .send({ forensicSummary: 'The submitted materials document impacts on the west elevation.' });
    expect(res.status).toBe(200);
    expect(res.body.summary.editedAt).toBeTruthy();
  });
});
