/**
 * Integration test — comparison pair three-caption structure
 *
 * Verifies:
 *  1. Finalization guarantees exhibit selection + per-photo caption slots for
 *     pair photos that were NOT pre-selected as individual exhibit selections.
 *  2. Caption generation fills all three caption strings (set + before + after)
 *     for a cause_differentiation pair.
 */

import {
  claimEventsTable,
  companiesTable,
  comparisonPairsTable,
  comparisonSetCaptionsTable,
  db,
  exhibitCaptionsTable,
  exhibitSelectionsTable,
  inspectionPhotosTable,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock Gemini before the app import so route modules see the mock.
vi.mock('@workspace/integrations-gemini-ai', () => ({
  ai: {
    models: {
      generateContent: vi.fn(),
    },
  },
}));

import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `cc-${Date.now().toString(36)}`;
const companyId = `TEST-CC-${RUN_ID}`.toUpperCase();
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });
const inspectionIds: string[] = [];

async function seedUser(role: 'field_rep' | 'manager') {
  const [user] = await db
    .insert(usersTable)
    .values({
      companyId,
      email: `cc-${role}-${RUN_ID}@example.test`,
      firstName: 'Test',
      lastName: role,
    })
    .returning();
  await db
    .insert(userProfilesTable)
    .values({ userId: user.id, role, department: 'inspector_canvasser' });
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
  return { userId: user.id, sid };
}

let manager: { userId: string; sid: string };

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: companyId, name: `CC Test ${RUN_ID}` });
  manager = await seedUser('manager');
});

afterAll(async () => {
  if (inspectionIds.length) {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, inspectionIds));
  }
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

// ── helpers ────────────────────────────────────────────────────────────────

async function seedMinimalInspection() {
  // No damage flags → deriveManifestRequirements has no required single slots
  // → checkAllRequiredSlotsConfirmedByEvents returns true (vacuous truth).
  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      inspectorUserId: manager.userId,
      phase: 'forensic',
    } as typeof inspectionsTable.$inferInsert)
    .returning();
  inspectionIds.push(insp.id);
  return insp;
}

async function seedPhoto(inspectionId: string, letter: string) {
  const [p] = await db
    .insert(inspectionPhotosTable)
    .values({
      companyId,
      inspectionId,
      url: `https://example.test/${letter}.jpg`,
      sha256: letter.repeat(64).slice(0, 64),
      stage: 'components',
      subjectType: 'component',  // valid INSPECTION_SUBJECT_TYPES value
    } as typeof inspectionPhotosTable.$inferInsert)
    .returning();
  return p;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Comparison pair three-caption structure', () => {
  it('finalize creates selection + caption slots for pair photos not yet in exhibit selections', async () => {
    const insp = await seedMinimalInspection();

    // Seed photos for the three always-required slots (front_elevation,
    // collateral_1, edge_assembly) so checkAllRequiredSlotsConfirmedByEvents passes.
    const [photoFront, photoCollateral, photoEdge] = await db
      .insert(inspectionPhotosTable)
      .values([
        { companyId, inspectionId: insp.id, url: 'https://x.test/front.jpg', sha256: 'f'.repeat(64), stage: 'elevation', subjectType: 'elevation' },
        { companyId, inspectionId: insp.id, url: 'https://x.test/coll.jpg', sha256: 'e'.repeat(64), stage: 'collateral', subjectType: 'component' },
        { companyId, inspectionId: insp.id, url: 'https://x.test/edge.jpg', sha256: 'd'.repeat(64), stage: 'components', subjectType: 'component' },
      ] as (typeof inspectionPhotosTable.$inferInsert)[])
      .returning();

    // Seed exhibit selections for the required-slot photos.
    await db.insert(exhibitSelectionsTable).values([
      { inspectionId: insp.id, companyId, photoId: photoFront.id, sortOrder: 0 },
      { inspectionId: insp.id, companyId, photoId: photoCollateral.id, sortOrder: 1 },
      { inspectionId: insp.id, companyId, photoId: photoEdge.id, sortOrder: 2 },
    ] as (typeof exhibitSelectionsTable.$inferInsert)[]);

    // Seed slot_confirmed events so the gate passes (photo must be in selections).
    await db.insert(claimEventsTable).values([
      { inspectionId: insp.id, companyId, eventType: 'slot_confirmed', payload: { slotKey: 'front_elevation', photoId: photoFront.id }, actorId: manager.userId },
      { inspectionId: insp.id, companyId, eventType: 'slot_confirmed', payload: { slotKey: 'collateral_1', photoId: photoCollateral.id }, actorId: manager.userId },
      { inspectionId: insp.id, companyId, eventType: 'slot_confirmed', payload: { slotKey: 'edge_assembly', photoId: photoEdge.id }, actorId: manager.userId },
    ] as (typeof claimEventsTable.$inferInsert)[]);

    // Pair photos — intentionally NOT in exhibit selections yet.
    const [photoB, photoC] = await db
      .insert(inspectionPhotosTable)
      .values([
        { companyId, inspectionId: insp.id, url: 'https://x.test/b.jpg', sha256: 'b'.repeat(64), stage: 'test_squares', subjectType: 'component' },
        { companyId, inspectionId: insp.id, url: 'https://x.test/c.jpg', sha256: 'c'.repeat(64), stage: 'components', subjectType: 'component' },
      ] as (typeof inspectionPhotosTable.$inferInsert)[])
      .returning();

    // Seed a confirmed comparison pair using photoB + photoC.
    const [pair] = await db
      .insert(comparisonPairsTable)
      .values({
        inspectionId: insp.id,
        companyId,
        beforePhotoId: photoB.id,
        afterPhotoId: photoC.id,
        pairType: 'cause_differentiation',
        confirmedBy: manager.userId,
        confirmedAt: new Date(),
      } as typeof comparisonPairsTable.$inferInsert)
      .returning();

    // Route is /:inspectionId/curation/finalize (no /inspections/ prefix)
    const res = await request(app)
      .post(`/api/${insp.id}/curation/finalize`)
      .set(auth(manager.sid));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // All three photos must now have exhibit selection rows.
    const allSels = await db
      .select()
      .from(exhibitSelectionsTable)
      .where(
        and(
          eq(exhibitSelectionsTable.inspectionId, insp.id),
          eq(exhibitSelectionsTable.companyId, companyId),
        ),
      );
    const selPhotoIds = new Set(allSels.map((s) => s.photoId));
    expect(selPhotoIds.has(photoB.id), 'before-photo selection').toBe(true);
    expect(selPhotoIds.has(photoC.id), 'after-photo selection').toBe(true);

    // Pair photo selections must be C-class.
    const bSel = allSels.find((s) => s.photoId === photoB.id)!;
    const cSel = allSels.find((s) => s.photoId === photoC.id)!;
    expect(bSel.exhibitClass).toBe('C');
    expect(cSel.exhibitClass).toBe('C');
    expect(bSel.finalizedAt).not.toBeNull();
    expect(cSel.finalizedAt).not.toBeNull();

    // Caption slots must exist for the pair selections.
    const allCaps = await db
      .select()
      .from(exhibitCaptionsTable)
      .where(
        and(
          eq(exhibitCaptionsTable.inspectionId, insp.id),
          eq(exhibitCaptionsTable.companyId, companyId),
        ),
      );
    const capSelIds = new Set(allCaps.map((c) => c.exhibitSelectionId));
    expect(capSelIds.has(bSel.id), 'before-photo caption slot').toBe(true);
    expect(capSelIds.has(cSel.id), 'after-photo caption slot').toBe(true);

    // Set-caption slot must exist for the pair.
    const [setCapRow] = await db
      .select()
      .from(comparisonSetCaptionsTable)
      .where(
        and(
          eq(comparisonSetCaptionsTable.inspectionId, insp.id),
          eq(comparisonSetCaptionsTable.comparisonPairId, pair.id),
        ),
      );
    expect(setCapRow, 'set-caption slot').toBeDefined();
    expect(setCapRow.state).toBe('pending');
  });

  it('caption generate produces all three non-empty caption strings for a cause_differentiation pair', async () => {
    const insp = await seedMinimalInspection();
    const photoB = await seedPhoto(insp.id, 'd');
    const photoC = await seedPhoto(insp.id, 'e');

    // Pre-seed fully-finalized selections so the generate gate passes.
    const now = new Date();
    const [bSel, cSel] = await db
      .insert(exhibitSelectionsTable)
      .values([
        {
          inspectionId: insp.id,
          companyId,
          photoId: photoB.id,
          exhibitClass: 'C',
          badgeLabel: 'C-1',
          sortOrder: 0,
          finalizedAt: now,
        },
        {
          inspectionId: insp.id,
          companyId,
          photoId: photoC.id,
          exhibitClass: 'C',
          badgeLabel: 'C-2',
          sortOrder: 1,
          finalizedAt: now,
        },
      ] as (typeof exhibitSelectionsTable.$inferInsert)[])
      .returning();

    // Per-photo caption slots.
    const [bCap, cCap] = await db
      .insert(exhibitCaptionsTable)
      .values([
        {
          inspectionId: insp.id,
          companyId,
          exhibitSelectionId: bSel.id,
          badgeLabel: 'C-1',
          state: 'pending',
        },
        {
          inspectionId: insp.id,
          companyId,
          exhibitSelectionId: cSel.id,
          badgeLabel: 'C-2',
          state: 'pending',
        },
      ] as (typeof exhibitCaptionsTable.$inferInsert)[])
      .returning();

    // Comparison pair + set-caption slot.
    const [pair] = await db
      .insert(comparisonPairsTable)
      .values({
        inspectionId: insp.id,
        companyId,
        beforePhotoId: photoB.id,
        afterPhotoId: photoC.id,
        pairType: 'cause_differentiation',
        confirmedBy: manager.userId,
        confirmedAt: now,
      } as typeof comparisonPairsTable.$inferInsert)
      .returning();

    const [setCapRow] = await db
      .insert(comparisonSetCaptionsTable)
      .values({
        inspectionId: insp.id,
        companyId,
        comparisonPairId: pair.id,
        state: 'pending',
      } as typeof comparisonSetCaptionsTable.$inferInsert)
      .returning();

    // Mock Gemini: only the comparison call runs (singleCaptions is empty).
    const mockGenerate = vi.mocked(geminiAi.models.generateContent);
    mockGenerate.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          setCaptionId: setCapRow.id,
          setCaption:
            'Comparison — localized impact condition (top) and general surface weathering (bottom), south slope.',
          beforeCaptionId: bCap.id,
          beforeCaption:
            'Photo — Exhibit C-1 — conditions documented as localized hail-impact bruising with granule displacement.',
          afterCaptionId: cCap.id,
          afterCaption:
            'Photo — Exhibit C-2 — conditions documented as uniform age-related surface wear across field shingles.',
        },
      ]),
    } as never);

    // Route is /:inspectionId/sections/captions/generate (no /inspections/ prefix)
    const res = await request(app)
      .post(`/api/${insp.id}/sections/captions/generate`)
      .set(auth(manager.sid));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // All three caption strings must be non-empty and match the expected patterns.
    const [updatedSet] = await db
      .select()
      .from(comparisonSetCaptionsTable)
      .where(eq(comparisonSetCaptionsTable.id, setCapRow.id));
    expect(updatedSet.captionText).toMatch(/Comparison.*localized impact.*general surface weathering/);
    expect(updatedSet.state).toBe('generated');

    const [updatedB] = await db
      .select()
      .from(exhibitCaptionsTable)
      .where(eq(exhibitCaptionsTable.id, bCap.id));
    expect(updatedB.captionText).toMatch(/conditions documented as.*bruising/);
    expect(updatedB.state).toBe('generated');

    const [updatedC] = await db
      .select()
      .from(exhibitCaptionsTable)
      .where(eq(exhibitCaptionsTable.id, cCap.id));
    expect(updatedC.captionText).toMatch(/conditions documented as.*surface wear/);
    expect(updatedC.state).toBe('generated');
  });

  it('lock is blocked when a comparison pair set caption is still pending', async () => {
    const insp = await seedMinimalInspection();
    const photoF = await seedPhoto(insp.id, 'f');
    const photoG = await seedPhoto(insp.id, 'g');

    // Pre-seed fully-finalized, already-approved per-photo selections so the
    // per-photo caption gate passes — only the set caption will block lock.
    const now = new Date();
    const [fSel, gSel] = await db
      .insert(exhibitSelectionsTable)
      .values([
        { inspectionId: insp.id, companyId, photoId: photoF.id, exhibitClass: 'C', badgeLabel: 'C-1', sortOrder: 0, finalizedAt: now },
        { inspectionId: insp.id, companyId, photoId: photoG.id, exhibitClass: 'C', badgeLabel: 'C-2', sortOrder: 1, finalizedAt: now },
      ] as (typeof exhibitSelectionsTable.$inferInsert)[])
      .returning();

    // Per-photo captions already approved.
    await db.insert(exhibitCaptionsTable).values([
      { inspectionId: insp.id, companyId, exhibitSelectionId: fSel.id, badgeLabel: 'C-1', state: 'approved', captionText: 'Photo — Exhibit C-1 — test.' },
      { inspectionId: insp.id, companyId, exhibitSelectionId: gSel.id, badgeLabel: 'C-2', state: 'approved', captionText: 'Photo — Exhibit C-2 — test.' },
    ] as (typeof exhibitCaptionsTable.$inferInsert)[]);

    // Comparison pair with a set caption still in `pending` state (never generated).
    const [pair] = await db
      .insert(comparisonPairsTable)
      .values({
        inspectionId: insp.id, companyId, beforePhotoId: photoF.id, afterPhotoId: photoG.id,
        pairType: 'cause_differentiation', confirmedBy: manager.userId, confirmedAt: now,
      } as typeof comparisonPairsTable.$inferInsert)
      .returning();
    await db.insert(comparisonSetCaptionsTable).values({
      inspectionId: insp.id, companyId, comparisonPairId: pair.id, state: 'pending',
    } as typeof comparisonSetCaptionsTable.$inferInsert);

    // Route: /:inspectionId/sections/captions/lock (no /inspections/ prefix)
    const res = await request(app)
      .post(`/api/${insp.id}/sections/captions/lock`)
      .set(auth(manager.sid));

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toMatch(/set caption.*not yet approved|comparison pair set caption/i);
  });

  it('legacy pair with no set-caption row: lock blocked, generate auto-creates slot', async () => {
    // Simulate a "legacy finalized" inspection: comparison pair exists but
    // comparison_set_captions was never seeded (predates this feature or
    // the backfill migration hasn't run yet).
    const insp = await seedMinimalInspection();
    const photoH = await seedPhoto(insp.id, 'h');
    const photoI = await seedPhoto(insp.id, 'i');

    const now = new Date();

    // Per-photo selections and already-approved captions.
    const [hSel, iSel] = await db
      .insert(exhibitSelectionsTable)
      .values([
        { inspectionId: insp.id, companyId, photoId: photoH.id, exhibitClass: 'C', badgeLabel: 'C-3', sortOrder: 0, finalizedAt: now },
        { inspectionId: insp.id, companyId, photoId: photoI.id, exhibitClass: 'C', badgeLabel: 'C-4', sortOrder: 1, finalizedAt: now },
      ] as (typeof exhibitSelectionsTable.$inferInsert)[])
      .returning();

    await db.insert(exhibitCaptionsTable).values([
      { inspectionId: insp.id, companyId, exhibitSelectionId: hSel.id, badgeLabel: 'C-3', state: 'approved', captionText: 'Photo — Exhibit C-3 — test.' },
      { inspectionId: insp.id, companyId, exhibitSelectionId: iSel.id, badgeLabel: 'C-4', state: 'approved', captionText: 'Photo — Exhibit C-4 — test.' },
    ] as (typeof exhibitCaptionsTable.$inferInsert)[]);

    // Comparison pair — intentionally NO set-caption row inserted.
    await db.insert(comparisonPairsTable).values({
      inspectionId: insp.id, companyId, beforePhotoId: photoH.id, afterPhotoId: photoI.id,
      pairType: 'cause_differentiation', confirmedBy: manager.userId, confirmedAt: now,
    } as typeof comparisonPairsTable.$inferInsert);

    // 1. Lock must be blocked because no set-caption row exists.
    const lockRes = await request(app)
      .post(`/api/${insp.id}/sections/captions/lock`)
      .set(auth(manager.sid));
    expect(lockRes.status, JSON.stringify(lockRes.body)).toBe(422);
    expect(lockRes.body.error).toMatch(/no set caption|missing.*slot|re-generate/i);

    // 2. Caption generate auto-creates the missing slot.
    // Mock returns a valid comparison response.
    const mockGemini = geminiAi as unknown as { models: { generateContent: ReturnType<typeof vi.fn> } };
    mockGemini.models.generateContent.mockResolvedValueOnce({ text: '[]' }); // single-captions (none to generate)
    mockGemini.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify([{
        setCaptionId: '__will_be_replaced_by_auto_create__', // placeholder; route uses the real DB id
        setCaption: 'Comparison — localized impact condition (top) and general surface weathering (bottom), roof deck.',
        beforeCaptionId: null,
        beforeCaption: 'Photo — Exhibit C-3 — conditions documented as localized impact bruising.',
        afterCaptionId: null,
        afterCaption: 'Photo — Exhibit C-4 — conditions documented as surface wear.',
      }]),
    });

    // generate route will auto-create the set-caption slot; we don't need
    // the AI to actually succeed — just confirm the slot is created.
    const genRes = await request(app)
      .post(`/api/${insp.id}/sections/captions/generate`)
      .set(auth(manager.sid));
    // 200 or 502 depending on mock validity — either way the slot must now exist.
    expect([200, 502], `status=${genRes.status}`).toContain(genRes.status);

    // 3. The set-caption row must now exist.
    const pairsAfter = await db.select({ id: comparisonPairsTable.id })
      .from(comparisonPairsTable)
      .where(and(eq(comparisonPairsTable.inspectionId, insp.id), eq(comparisonPairsTable.companyId, companyId)));
    const setCapsAfter = await db.select()
      .from(comparisonSetCaptionsTable)
      .where(and(eq(comparisonSetCaptionsTable.inspectionId, insp.id), eq(comparisonSetCaptionsTable.companyId, companyId)));
    expect(setCapsAfter.length, 'set-caption row auto-created').toBe(pairsAfter.length);
  });
});
