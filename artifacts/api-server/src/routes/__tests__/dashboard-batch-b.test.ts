/**
 * Batch-B widget verification tests.
 *
 * Covers per-spec requirements:
 *  1. TENANCY: company-A stage_transitions never bleed into company-B response
 *  2. SCOPING: field_rep on pending_inspections / claim_blockers sees only own rows
 *  3. 403: field_rep calling manager+ pipeline_funnel endpoints gets 403
 *  4. field_rep cannot widen scope via query params
 *  5. recent_activity shape: items/total/capped present
 *
 * Uses real DB rows + real sessions — no auth mocking.
 */

import {
  companiesTable,
  db,
  inspectionsTable,
  pinsTable,
  stageTransitionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `batchb-${Date.now().toString(36)}`;

interface Actor {
  userId: string;
  companyId: string;
  sid: string;
}

async function seedActor(
  label: string,
  role: 'field_rep' | 'manager',
  workflow: 'retail' | 'insurance_retail' = 'insurance_retail',
  department: 'inspector_canvasser' | 'office' | 'canvasser' = 'inspector_canvasser',
  sharedCompanyId?: string,
): Promise<Actor> {
  const companyId = sharedCompanyId ?? `TEST-${RUN_ID}-${label}`.toUpperCase();
  if (!sharedCompanyId) {
    await db.insert(companiesTable).values({ id: companyId, name: `BBTest ${label}` });
  }

  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `${label}-${RUN_ID}@bb.test` })
    .returning();

  await db.insert(userProfilesTable).values({
    userId: user.id,
    role,
    department,
    workflowAssignment: workflow,
  });

  const sid = await createSession({
    access_token: 'test-access-token',
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
  });

  return { userId: user.id, companyId, sid };
}

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

let repA: Actor;  // field_rep  — company A
let mgrA: Actor;  // manager    — company A (same company as repA)
let mgrB: Actor;  // manager    — company B (different company)

let repAInspectionId: string;   // inspection owned by repA
let otherInspectionId: string;  // inspection owned by mgrA (different rep)
let companyAPin: string;        // pin in company A
let companyBPin: string;        // pin in company B

beforeAll(async () => {
  // ── company A ────────────────────────────────────────────────────────────
  const companyAId = `TEST-${RUN_ID}-A`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyAId, name: `BBTest A` });

  repA = await seedActor('repA', 'field_rep', 'insurance_retail', 'inspector_canvasser', companyAId);
  mgrA = await seedActor('mgrA', 'manager', 'insurance_retail', 'inspector_canvasser', companyAId);

  // Seed a pin in company A
  const [pA] = await db
    .insert(pinsTable)
    .values({
      companyId: companyAId,
      userId: repA.userId,
      latitude: 38.9,
      longitude: -77.0,
      workflow: 'retail',
      status: 'active',
    })
    .returning();
  companyAPin = pA.id;

  // Inspection owned by repA (scheduled)
  const [inspRepA] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      pinId: companyAPin,
      inspectorUserId: repA.userId,
      status: 'scheduled',
      phase: 'preliminary',
    })
    .returning();
  repAInspectionId = inspRepA.id;

  // Inspection owned by mgrA (capturing) — repA should NOT see this
  const [pA2] = await db
    .insert(pinsTable)
    .values({ companyId: companyAId, userId: mgrA.userId, latitude: 38.91, longitude: -77.01, workflow: 'retail', status: 'active' })
    .returning();
  const [inspMgrA] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      pinId: pA2.id,
      inspectorUserId: mgrA.userId,
      status: 'capturing',
      phase: 'forensic',
    })
    .returning();
  otherInspectionId = inspMgrA.id;

  // Stage transition in company A (joined through companyAPin)
  await db.insert(stageTransitionsTable).values({
    leadId: companyAPin,
    toStage: 'appt_needed',
    trigger: 'manual_move',
    userId: repA.userId,
  });

  // ── company B ────────────────────────────────────────────────────────────
  mgrB = await seedActor('mgrB', 'manager', 'insurance_retail', 'inspector_canvasser');

  const [pB] = await db
    .insert(pinsTable)
    .values({
      companyId: mgrB.companyId,
      userId: mgrB.userId,
      latitude: 37.0,
      longitude: -122.0,
      workflow: 'retail',
      status: 'active',
    })
    .returning();
  companyBPin = pB.id;

  // Stage transition in company B — must NOT appear in company A's feed
  await db.insert(stageTransitionsTable).values({
    leadId: companyBPin,
    toStage: 'pin_dropped',
    trigger: 'manual_move',
    userId: mgrB.userId,
  });
});

afterAll(async () => {
  const companyIds = [
    `TEST-${RUN_ID}-A`.toUpperCase(),
    mgrB?.companyId,
  ].filter(Boolean) as string[];

  if (!companyIds.length) return;

  // Use raw SQL to delete in FK-safe order.
  // sessions → user_profiles → users → (stage_transitions via pins) → inspections → pins → companies
  const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(', ');
  const client = db.$client as { query: (sql: string, params?: unknown[]) => Promise<unknown> };

  // sessions table has no userId column (only sid/sess/expire) — they expire naturally; skip.
  await client.query(
    `DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE company_id IN (${placeholders}))`,
    companyIds,
  );
  // inspections.inspector_user_id → users.id: delete inspections before users
  await client.query(
    `DELETE FROM stage_transitions WHERE lead_id IN (SELECT id FROM pins WHERE company_id IN (${placeholders}))`,
    companyIds,
  );
  await client.query(`DELETE FROM inspections WHERE company_id IN (${placeholders})`, companyIds);
  await client.query(`DELETE FROM pins WHERE company_id IN (${placeholders})`, companyIds);
  await client.query(`DELETE FROM users WHERE company_id IN (${placeholders})`, companyIds);
  await client.query(`DELETE FROM companies WHERE id IN (${placeholders})`, companyIds);
});

// ── 1. TENANCY ─────────────────────────────────────────────────────────────
describe('tenancy — stage_transitions via company-A manager', () => {
  it('recent_activity returns only company-A transitions (toStage=appt_needed), not company-B (pin_dropped)', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/recent_activity')
      .set(auth(mgrA.sid));

    expect(res.status).toBe(200);
    const items: { kind: string; text: string }[] = res.body.items;

    // Company A should see their transition
    const aTransitions = items.filter(
      (i) => i.kind === 'stage_transition' && i.text.includes('Appt. Needed'),
    );
    expect(aTransitions.length).toBeGreaterThan(0);

    // Company B's pin_dropped transition must NOT appear in company-A's feed
    const bLeak = items.filter(
      (i) => i.kind === 'stage_transition' && i.text.includes('Pin Dropped'),
    );
    expect(bLeak).toHaveLength(0);
  });
});

// ── 2. SCOPING: field_rep sees only own rows ───────────────────────────────
describe('pending_inspections scoping', () => {
  it('field_rep sees only their own inspection', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/pending_inspections')
      .set(auth(repA.sid));

    expect(res.status).toBe(200);
    expect(res.body.scopedToSelf).toBe(true);

    const ids: string[] = res.body.items.map((i: { inspectionId: string }) => i.inspectionId);
    expect(ids).toContain(repAInspectionId);
    expect(ids).not.toContain(otherInspectionId); // mgrA's inspection is invisible to repA
  });

  it('manager sees company-wide (both inspections)', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/pending_inspections')
      .set(auth(mgrA.sid));

    expect(res.status).toBe(200);
    expect(res.body.scopedToSelf).toBe(false);

    const ids: string[] = res.body.items.map((i: { inspectionId: string }) => i.inspectionId);
    expect(ids).toContain(repAInspectionId);
    expect(ids).toContain(otherInspectionId);
  });

  it('field_rep cannot widen scope via query param', async () => {
    // Server must ignore any client-supplied scope/userId params
    const res = await request(app)
      .get('/api/dashboard/widgets/pending_inspections?scope=company')
      .set(auth(repA.sid));

    expect(res.status).toBe(200);
    expect(res.body.scopedToSelf).toBe(true);
    const ids: string[] = res.body.items.map((i: { inspectionId: string }) => i.inspectionId);
    expect(ids).not.toContain(otherInspectionId);
  });
});

// ── 3. 403: field_rep on manager+ pipeline funnel ─────────────────────────
describe('pipeline_funnel authorization', () => {
  for (const pipeline of ['retail', 'insurance', 'project'] as const) {
    it(`field_rep calling pipeline=${pipeline} gets 403`, async () => {
      const res = await request(app)
        .get(`/api/dashboard/widgets/pipeline_funnel?pipeline=${pipeline}`)
        .set(auth(repA.sid));
      expect(res.status).toBe(403);
    });
  }

  it('manager can call pipeline_funnel', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/pipeline_funnel?pipeline=retail')
      .set(auth(mgrA.sid));
    // 200 (even if 0 pins) — shape check
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pipeline', 'retail');
    expect(res.body).toHaveProperty('stages');
    expect(res.body).toHaveProperty('activeTotal');
    expect(res.body).toHaveProperty('terminalTotal');
    // Labels come from SERVER_STAGES_ARRAY — confirm at least one stage label is a string
    const stages: { key: string; label: string; order: number }[] = res.body.stages;
    expect(stages.length).toBeGreaterThan(0);
    expect(typeof stages[0].label).toBe('string');
    expect(typeof stages[0].order).toBe('number');
  });

  it('pipeline_funnel rejects unknown pipeline param with 400', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/pipeline_funnel?pipeline=unknown')
      .set(auth(mgrA.sid));
    expect(res.status).toBe(400);
  });
});

// ── 4. recent_activity shape ───────────────────────────────────────────────
describe('recent_activity envelope shape', () => {
  it('returns items/total/capped; stage transition text is human-readable', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/recent_activity')
      .set(auth(mgrA.sid));

    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.capped).toBe('boolean');
    expect(Array.isArray(res.body.items)).toBe(true);

    const stItems = res.body.items.filter((i: { kind: string }) => i.kind === 'stage_transition');
    if (stItems.length > 0) {
      const item = stItems[0] as { text: string; actorName: string };
      // text should NOT be a raw enum key like 'appt_needed'
      expect(item.text).not.toBe('appt_needed');
      expect(item.actorName).not.toBe('');
    }
  });
});
