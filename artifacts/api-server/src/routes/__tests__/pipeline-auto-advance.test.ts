/**
 * Pipeline auto-advance — Step 1 remediation tests.
 *
 * Covers:
 *   - processPipelineEvent advances a pin whose current stage autoAdvances on
 *     the emitted event, writing exactly one stage_transitions row.
 *   - IDEMPOTENCY: re-emitting the same event is a no-op — no backwards move,
 *     no duplicate stage_transitions row.
 *   - Stage-mapping matrix for the six wired events:
 *       fipsa_signed           phase1_complete   → fipsa_signed   (insurance)
 *       report_attested        phase2_complete   → package_ready  (insurance)
 *       package_delivered      package_ready     → claim_filed    (insurance)
 *       contract_signed        contract_pending  → contract_signed (retail + insurance,
 *                              gated on payload.pipeline — cross-pipeline no-op verified)
 *       proof_package_compiled proof_package     → contract_generated (legacy insurance)
 *       deposit_received       ins_contract_signed → ins_deposit_received (legacy insurance)
 *   - emitPipelineEvent never throws (errors swallowed + logged).
 *   - Integration: POST payment (deposit) advances the pin, and a deliberately
 *     broken advance does NOT prevent the payment from saving.
 */

import {
  companiesTable,
  db,
  paymentsTable,
  pinsTable,
  stageTransitionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';
import { emitPipelineEvent, processPipelineEvent } from '../pipelineEvents';

const RUN_ID = Date.now().toString(36);
const COMPANY = `TEST-PAA-${RUN_ID}`.toUpperCase();

let managerSid: string;
let managerUserId: string;
const pinIds: string[] = [];

async function seedPin(workflow: 'retail' | 'insurance', pipelineStage: string): Promise<string> {
  const [row] = await db.insert(pinsTable).values({
    companyId: COMPANY,
    userId: managerUserId,
    latitude: 38.9,
    longitude: -77.0,
    workflow,
    pipelineStage,
    status: 'active',
  }).returning();
  pinIds.push(row.id);
  return row.id;
}

async function pinStage(pinId: string): Promise<string | null> {
  const [row] = await db
    .select({ pipelineStage: pinsTable.pipelineStage })
    .from(pinsTable)
    .where(eq(pinsTable.id, pinId));
  return row?.pipelineStage ?? null;
}

async function transitionCount(pinId: string): Promise<number> {
  const rows = await db
    .select({ id: stageTransitionsTable.id })
    .from(stageTransitionsTable)
    .where(eq(stageTransitionsTable.leadId, pinId));
  return rows.length;
}

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: COMPANY, name: 'Auto-Advance Test Co' });
  const [user] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY, email: `paa-mgr-${RUN_ID}@test.invalid` })
    .returning();
  managerUserId = user.id;
  await db.insert(userProfilesTable).values({ userId: user.id, role: 'manager' });
  managerSid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId: COMPANY,
    },
    access_token: 'test-tok',
  });
});

afterAll(async () => {
  if (pinIds.length) {
    await db.delete(stageTransitionsTable)
      .where(inArray(stageTransitionsTable.leadId, pinIds)).catch(() => {});
    await db.delete(paymentsTable)
      .where(inArray(paymentsTable.pinId, pinIds)).catch(() => {});
    await db.delete(pinsTable).where(inArray(pinsTable.id, pinIds)).catch(() => {});
  }
  await db.delete(userProfilesTable)
    .where(eq(userProfilesTable.userId, managerUserId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, managerUserId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY));
});

describe('processPipelineEvent — stage mapping for the six wired events', () => {
  it('fipsa_signed: phase1_complete → fipsa_signed (insurance)', async () => {
    const pinId = await seedPin('insurance', 'phase1_complete');
    const { results } = await processPipelineEvent({
      companyId: COMPANY, leadId: pinId, eventType: 'fipsa_signed',
    });
    expect(results).toEqual([{ leadId: pinId, fromStage: 'phase1_complete', toStage: 'fipsa_signed' }]);
    expect(await pinStage(pinId)).toBe('fipsa_signed');
    expect(await transitionCount(pinId)).toBe(1);
  });

  it('report_attested: phase2_complete → package_ready (insurance)', async () => {
    const pinId = await seedPin('insurance', 'phase2_complete');
    await processPipelineEvent({ companyId: COMPANY, leadId: pinId, eventType: 'report_attested' });
    expect(await pinStage(pinId)).toBe('package_ready');
  });

  it('package_delivered: package_ready → claim_filed (insurance)', async () => {
    const pinId = await seedPin('insurance', 'package_ready');
    await processPipelineEvent({ companyId: COMPANY, leadId: pinId, eventType: 'package_delivered' });
    expect(await pinStage(pinId)).toBe('claim_filed');
  });

  it('contract_signed: contract_pending → contract_signed (insurance, payload-gated)', async () => {
    const pinId = await seedPin('insurance', 'contract_pending');
    await processPipelineEvent({
      companyId: COMPANY, leadId: pinId, eventType: 'contract_signed',
      payload: { pipeline: 'insurance' },
    });
    expect(await pinStage(pinId)).toBe('contract_signed');
  });

  it('contract_signed: retail payload does NOT advance an insurance pin (cross-pipeline guard)', async () => {
    const pinId = await seedPin('insurance', 'contract_pending');
    const { results } = await processPipelineEvent({
      companyId: COMPANY, leadId: pinId, eventType: 'contract_signed',
      payload: { pipeline: 'retail' },
    });
    expect(results).toHaveLength(0);
    expect(await pinStage(pinId)).toBe('contract_pending');
    expect(await transitionCount(pinId)).toBe(0);
  });

  it('contract_signed: contract_pending → contract_signed (retail)', async () => {
    const pinId = await seedPin('retail', 'contract_pending');
    await processPipelineEvent({
      companyId: COMPANY, leadId: pinId, eventType: 'contract_signed',
      payload: { pipeline: 'retail' },
    });
    expect(await pinStage(pinId)).toBe('contract_signed');
  });

  it('proof_package_compiled: proof_package → contract_generated (legacy insurance)', async () => {
    const pinId = await seedPin('insurance', 'proof_package');
    await processPipelineEvent({ companyId: COMPANY, leadId: pinId, eventType: 'proof_package_compiled' });
    expect(await pinStage(pinId)).toBe('contract_generated');
  });

  it('deposit_received: ins_contract_signed → ins_deposit_received (legacy insurance)', async () => {
    const pinId = await seedPin('insurance', 'ins_contract_signed');
    await processPipelineEvent({
      companyId: COMPANY, leadId: pinId, eventType: 'deposit_received',
      payload: { pipeline: 'insurance' },
    });
    expect(await pinStage(pinId)).toBe('ins_deposit_received');
  });
});

describe('processPipelineEvent — the two protocol-gated events', () => {
  it('preliminary_record_synced: phase1_scheduled → phase1_complete (insurance)', async () => {
    const pinId = await seedPin('insurance', 'phase1_scheduled');
    await processPipelineEvent({ companyId: COMPANY, leadId: pinId, eventType: 'preliminary_record_synced' });
    expect(await pinStage(pinId)).toBe('phase1_complete');
  });

  it('forensic_record_attested: phase2_scheduled → phase2_complete (insurance)', async () => {
    const pinId = await seedPin('insurance', 'phase2_scheduled');
    await processPipelineEvent({ companyId: COMPANY, leadId: pinId, eventType: 'forensic_record_attested' });
    expect(await pinStage(pinId)).toBe('phase2_complete');
  });
});

describe('idempotency', () => {
  it('re-emitting the same event is a no-op: no backwards move, no duplicate row', async () => {
    const pinId = await seedPin('insurance', 'phase1_complete');
    await processPipelineEvent({ companyId: COMPANY, leadId: pinId, eventType: 'fipsa_signed' });
    expect(await pinStage(pinId)).toBe('fipsa_signed');
    expect(await transitionCount(pinId)).toBe(1);

    // Re-emit — the pin is no longer in phase1_complete, so nothing matches.
    const second = await processPipelineEvent({
      companyId: COMPANY, leadId: pinId, eventType: 'fipsa_signed',
    });
    expect(second.results).toHaveLength(0);
    expect(second.reason).toBe('No pins are currently in matching stages');
    expect(await pinStage(pinId)).toBe('fipsa_signed');
    expect(await transitionCount(pinId)).toBe(1);
  });

  it('an event with no matching stage vocabulary is a no-op with a reason', async () => {
    const { results, reason } = await processPipelineEvent({
      companyId: COMPANY, eventType: 'nonexistent_event',
    });
    expect(results).toHaveLength(0);
    expect(reason).toBe('No stages match this event');
  });
});

describe('emitPipelineEvent — failure isolation', () => {
  it('never throws, even for garbage input', async () => {
    await expect(
      emitPipelineEvent({ companyId: 'NO-SUCH-COMPANY', eventType: 'fipsa_signed' }),
    ).resolves.toBeUndefined();
  });
});

describe('integration — POST payment (deposit) drives the pipeline', () => {
  it('records the payment AND advances a legacy-stage pin; payment saves even if pin cannot advance', async () => {
    const pinId = await seedPin('insurance', 'ins_contract_signed');

    const res = await request(app)
      .post(`/api/pins/${pinId}/payments`)
      .set({ Authorization: `Bearer ${managerSid}` })
      .send({ type: 'deposit', amountCents: 250000, paymentDate: new Date().toISOString() });
    expect(res.status).toBe(201);

    // Fire-and-forget advance — poll briefly for the async emit to land.
    let stage: string | null = null;
    for (let i = 0; i < 20; i++) {
      stage = await pinStage(pinId);
      if (stage === 'ins_deposit_received') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(stage).toBe('ins_deposit_received');
  });

  it('a failing/no-op advance does not affect the saved payment', async () => {
    // Pin in a stage with NO deposit_received autoAdvance (new-pipeline stage):
    // the advance no-ops, and the payment must still save.
    const pinId = await seedPin('retail', 'contract_signed');

    const res = await request(app)
      .post(`/api/pins/${pinId}/payments`)
      .set({ Authorization: `Bearer ${managerSid}` })
      .send({ type: 'deposit', amountCents: 100000, paymentDate: new Date().toISOString() });
    expect(res.status).toBe(201);

    // Give the async emit time to run, then confirm payment persisted and pin unmoved.
    await new Promise((r) => setTimeout(r, 300));
    const [payment] = await db
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(eq(paymentsTable.pinId, pinId));
    expect(payment).toBeTruthy();
    expect(await pinStage(pinId)).toBe('contract_signed');
    expect(await transitionCount(pinId)).toBe(0);
  });
});

describe('integration — manual advance route unaffected', () => {
  it('POST /api/events/pipeline still works for a manager', async () => {
    const pinId = await seedPin('insurance', 'phase2_complete');
    const res = await request(app)
      .post('/api/events/pipeline')
      .set({ Authorization: `Bearer ${managerSid}` })
      .send({ eventType: 'report_attested', leadId: pinId });
    expect(res.status).toBe(200);
    expect(res.body.advanced).toBe(true);
    expect(res.body.results).toEqual([
      { leadId: pinId, fromStage: 'phase2_complete', toStage: 'package_ready' },
    ]);
  });
});
