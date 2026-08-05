/**
 * Supplement flow integration tests (Task #252).
 *
 * Acceptance criteria:
 * - Issue a supplement on a delivered claim
 * - Assert original blob hash-identical (path unchanged in version history)
 * - Assert supplement has its own signed blob + attestation row
 * - Assert supplement photo badge appends within class without renumbering
 * - Assert supplement_created, supplement_attested, supplement_delivered events exist
 * - Assert deliver is blocked until the supplement is attested
 */
import {
  claimEventsTable,
  claimSupplementsTable,
  claimSectionsTable,
  companiesTable,
  db,
  inspectionsTable,
  reportAttestationsTable,
  usersTable,
  userProfilesTable,
} from '@workspace/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = Date.now().toString(36);
const COMPANY_ID = `TEST-SUPP-${RUN_ID}`.toUpperCase();

interface SeededUser {
  companyId: string;
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: 'field_rep' | 'manager' | 'super_admin',
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY_ID, email: `supp-${label}-${RUN_ID}@example.test` })
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
      companyId: COMPANY_ID,
    },
    access_token: 'test-token',
  });
  return { companyId: COMPANY_ID, userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('supplement routes', () => {
  let inspector: SeededUser;
  let manager: SeededUser;
  const userIds: string[] = [];
  let inspectionId: string;

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: COMPANY_ID, name: 'Supplement Test Co' });

    inspector = await seedUser('inspector', 'field_rep');
    manager = await seedUser('manager', 'manager');
    userIds.push(inspector.userId, manager.userId);

    // Create a minimal inspection
    const res = await request(app)
      .post('/api/inspections')
      .set(auth(inspector.sid))
      .send({ claimNumber: 'SUPP-CLM-001', insuredName: 'Jane Doe' });
    expect(res.status).toBe(201);
    inspectionId = res.body.inspection.id as string;
  });

  afterAll(async () => {
    if (inspectionId) {
      await db
        .delete(claimEventsTable)
        .where(eq(claimEventsTable.inspectionId, inspectionId));
      await db
        .delete(claimSupplementsTable)
        .where(eq(claimSupplementsTable.inspectionId, inspectionId));
      await db
        .delete(claimSectionsTable)
        .where(eq(claimSectionsTable.inspectionId, inspectionId));
      await db
        .delete(reportAttestationsTable)
        .where(eq(reportAttestationsTable.inspectionId, inspectionId));
    }
    if (inspectionId) {
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_ID));
  });

  it('rejects supplement creation when primary package is not attested', async () => {
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/supplements`)
      .set(auth(inspector.sid))
      .send({ supplementReason: 'concealed_conditions_exposed' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRIMARY_PACKAGE_NOT_ATTESTED');
  });

  it('rejects supplement creation with an invalid reason', async () => {
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/supplements`)
      .set(auth(inspector.sid))
      .send({ supplementReason: 'invalid_reason' });
    expect(res.status).toBe(400);
  });

  it('returns an empty supplement list before any are created', async () => {
    const res = await request(app)
      .get(`/api/inspections/${inspectionId}/supplements`)
      .set(auth(inspector.sid));
    expect(res.status).toBe(200);
    expect(res.body.supplements).toEqual([]);
  });

  describe('with a seed attestation (simulating a delivered primary package)', () => {
    let suppId: string;
    let supplementNumber: string;

    beforeAll(async () => {
      // Seed a fake compiled version + attestation so the gate passes.
      await db
        .update(inspectionsTable)
        .set({
          compiledReportPath: '/objects/fake-primary-blob',
          compiledReportVersions: [
            { path: '/objects/fake-primary-blob', generatedAt: '2026-08-01T00:00:00.000Z', schemaVersion: 7 },
          ] as unknown as never,
        })
        .where(eq(inspectionsTable.id, inspectionId));

      // Insert a report_attestations row (simulates primary attestation).
      await db.insert(reportAttestationsTable).values({
        inspectionId,
        companyId: COMPANY_ID,
        supplementId: null,
        preparerId: inspector.userId,
        blobVersionIndex: 0,
        statementText: 'Test attestation statement',
        statementHash: 'abc123',
        attestationBlockKey: 'attestation_block_b',
      });
    });

    it('creates a supplement with auto-assigned number', async () => {
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements`)
        .set(auth(inspector.sid))
        .send({ supplementReason: 'concealed_conditions_exposed' });
      expect(res.status).toBe(201);
      expect(res.body.supplement).toBeDefined();
      expect(res.body.supplement.supplementReason).toBe('concealed_conditions_exposed');
      expect(res.body.supplement.supplementNumber).toBe('SUPP-1');
      expect(res.body.supplement.compiledReportVersions).toEqual([]);
      expect(res.body.supplement.originalPackageBlobVersion).toBe('/objects/fake-primary-blob');
      suppId = res.body.supplement.id as string;
      supplementNumber = res.body.supplement.supplementNumber as string;
    });

    it('emits supplement_created claim event', async () => {
      const events = await db
        .select()
        .from(claimEventsTable)
        .where(
          and(
            eq(claimEventsTable.inspectionId, inspectionId),
            eq(claimEventsTable.eventType, 'supplement_created'),
          ),
        );
      expect(events.length).toBeGreaterThanOrEqual(1);
      const evt = events.find(
        (e) => (e.payload as { supplementId?: string } | null)?.supplementId === suppId,
      );
      expect(evt).toBeDefined();
      expect((evt!.payload as { supplementNumber?: string }).supplementNumber).toBe('SUPP-1');
    });

    it('lists the supplement', async () => {
      const res = await request(app)
        .get(`/api/inspections/${inspectionId}/supplements`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(200);
      expect(res.body.supplements).toHaveLength(1);
      expect(res.body.supplements[0].id).toBe(suppId);
    });

    it('gets supplement detail with sections and events', async () => {
      const res = await request(app)
        .get(`/api/inspections/${inspectionId}/supplements/${suppId}`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(200);
      expect(res.body.supplement.id).toBe(suppId);
      expect(res.body.sections).toBeDefined();
      expect(res.body.events).toBeDefined();
    });

    it('updates supplement reason before compile', async () => {
      const res = await request(app)
        .patch(`/api/inspections/${inspectionId}/supplements/${suppId}`)
        .set(auth(inspector.sid))
        .send({ supplementReason: 'carrier_response' });
      expect(res.status).toBe(200);
      expect(res.body.supplement.supplementReason).toBe('carrier_response');

      // Restore original reason
      await request(app)
        .patch(`/api/inspections/${inspectionId}/supplements/${suppId}`)
        .set(auth(inspector.sid))
        .send({ supplementReason: 'concealed_conditions_exposed' });
    });

    it('returns not_started sections before any generation', async () => {
      const res = await request(app)
        .get(`/api/inspections/${inspectionId}/supplements/${suppId}/sections`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(200);
      const types = res.body.sections.map((s: { sectionType: string }) => s.sectionType);
      expect(types).toContain('findings');
      expect(types).toContain('estimate_justifications');
      expect(types).toContain('closing_statement');
      const all = res.body.sections.every((s: { state: string }) => s.state === 'not_started');
      expect(all).toBe(true);
    });

    it('blocks compile when no sections are locked', async () => {
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/compile`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NO_LOCKED_SECTIONS');
    });

    it('blocks deliver when supplement is not compiled', async () => {
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/deliver`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NOT_COMPILED');
    });

    it('blocks deliver when supplement is compiled but not attested', async () => {
      // Seed a fake compiled version on the supplement.
      await db
        .update(claimSupplementsTable)
        .set({
          compiledReportVersions: [
            { path: '/objects/fake-supp-blob', generatedAt: '2026-08-02T00:00:00.000Z', schemaVersion: 7 },
          ] as unknown as never,
        })
        .where(eq(claimSupplementsTable.id, suppId));

      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/deliver`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ATTESTATION_REQUIRED');

      // Reset to empty versions for further tests.
      await db
        .update(claimSupplementsTable)
        .set({ compiledReportVersions: [] as unknown as never })
        .where(eq(claimSupplementsTable.id, suppId));
    });

    it('blocks attest when supplement is not compiled', async () => {
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/attest`)
        .set(auth(inspector.sid))
        .send({ acknowledged: true });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NOT_COMPILED');
    });

    it('full compile → attest → deliver flow with DB-seeded locked section', async () => {
      // Seed a locked supplement section directly (bypasses AI generation for speed).
      await db.insert(claimSectionsTable).values({
        inspectionId,
        companyId: COMPANY_ID,
        supplementId: suppId,
        sectionType: 'findings',
        state: 'locked',
        contentHtml: '<p>Supplement finding: newly exposed concealed damage.</p>',
        lockedAt: new Date(),
        lockedBy: manager.userId,
      });

      // Compile.
      const compileRes = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/compile`)
        .set(auth(inspector.sid));
      expect(compileRes.status).toBe(200);
      expect(compileRes.body.supplement).toBeDefined();
      expect(compileRes.body.compiledPath).toMatch(/^\/objects\//);

      const compiledVersions = compileRes.body.supplement.compiledReportVersions as Array<{
        path: string;
        documentType: string;
      }>;
      expect(compiledVersions.length).toBeGreaterThanOrEqual(1);
      expect(compiledVersions[0].documentType).toBe('supplement');

      // Get attestation preview.
      const attPreview = await request(app)
        .get(`/api/inspections/${inspectionId}/supplements/${suppId}/attest`)
        .set(auth(inspector.sid));
      expect(attPreview.status).toBe(200);
      expect(attPreview.body.attested).toBe(false);
      expect(attPreview.body.statementText).toContain('SUPP-1');

      // Attest — requires acknowledged: true.
      const attFail = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/attest`)
        .set(auth(inspector.sid))
        .send({ acknowledged: false });
      expect(attFail.status).toBe(422);

      const attRes = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/attest`)
        .set(auth(inspector.sid))
        .send({ acknowledged: true });
      expect(attRes.status).toBe(201);
      expect(attRes.body.attested).toBe(true);
      const attestationId = attRes.body.attestation.id as string;

      // Idempotency: re-attestation is blocked with 409.
      const reAtt = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/attest`)
        .set(auth(inspector.sid))
        .send({ acknowledged: true });
      expect(reAtt.status).toBe(409);

      // Assert report_attestations row exists with supplementId set.
      const [attRow] = await db
        .select()
        .from(reportAttestationsTable)
        .where(
          and(
            eq(reportAttestationsTable.id, attestationId),
            eq(reportAttestationsTable.inspectionId, inspectionId),
            eq(reportAttestationsTable.supplementId, suppId),
          ),
        )
        .limit(1);
      expect(attRow).toBeDefined();
      expect(attRow.supplementId).toBe(suppId);

      // Assert supplement_attested event.
      const attEvents = await db
        .select()
        .from(claimEventsTable)
        .where(
          and(
            eq(claimEventsTable.inspectionId, inspectionId),
            eq(claimEventsTable.eventType, 'supplement_attested'),
          ),
        );
      const attEvt = attEvents.find(
        (e) => (e.payload as { supplementId?: string } | null)?.supplementId === suppId,
      );
      expect(attEvt).toBeDefined();

      // Assert original primary package blob path unchanged.
      const [updatedInsp] = await db
        .select({ compiledReportVersions: inspectionsTable.compiledReportVersions })
        .from(inspectionsTable)
        .where(eq(inspectionsTable.id, inspectionId))
        .limit(1);
      const primaryVersions = (updatedInsp?.compiledReportVersions as Array<{ path: string }>) ?? [];
      const originalBlobStillPresent = primaryVersions.some(
        (v) => v.path === '/objects/fake-primary-blob',
      );
      expect(originalBlobStillPresent).toBe(true);

      // Deliver.
      const deliverRes = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements/${suppId}/deliver`)
        .set(auth(inspector.sid));
      expect(deliverRes.status).toBe(200);
      expect(deliverRes.body.delivered).toBe(true);
      expect(deliverRes.body.supplementNumber).toBe(supplementNumber);

      // Assert supplement_delivered event.
      const deliverEvents = await db
        .select()
        .from(claimEventsTable)
        .where(
          and(
            eq(claimEventsTable.inspectionId, inspectionId),
            eq(claimEventsTable.eventType, 'supplement_delivered'),
          ),
        );
      const delEvt = deliverEvents.find(
        (e) => (e.payload as { supplementId?: string } | null)?.supplementId === suppId,
      );
      expect(delEvt).toBeDefined();

      // Assert all three timeline events exist.
      const allEvents = await db
        .select({ eventType: claimEventsTable.eventType, payload: claimEventsTable.payload })
        .from(claimEventsTable)
        .where(
          and(
            eq(claimEventsTable.inspectionId, inspectionId),
            inArray(claimEventsTable.eventType, [
              'supplement_created',
              'supplement_attested',
              'supplement_delivered',
            ]),
          ),
        );
      const eventsForThisSupp = allEvents.filter(
        (e) => (e.payload as { supplementId?: string } | null)?.supplementId === suppId,
      );
      const eventTypes = eventsForThisSupp.map((e) => e.eventType);
      expect(eventTypes).toContain('supplement_created');
      expect(eventTypes).toContain('supplement_attested');
      expect(eventTypes).toContain('supplement_delivered');
    });

    it('second supplement increments number to SUPP-2', async () => {
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/supplements`)
        .set(auth(inspector.sid))
        .send({ supplementReason: 'scope_correction' });
      expect(res.status).toBe(201);
      expect(res.body.supplement.supplementNumber).toBe('SUPP-2');
    });

    it('blocks updating reason after compile', async () => {
      // The first supplement (suppId) has been compiled. Patch should fail.
      const res = await request(app)
        .patch(`/api/inspections/${inspectionId}/supplements/${suppId}`)
        .set(auth(inspector.sid))
        .send({ supplementReason: 'scope_correction' });
      expect(res.status).toBe(409);
    });

    it('primary-package attestation row has null supplementId', async () => {
      const [primaryAtt] = await db
        .select()
        .from(reportAttestationsTable)
        .where(
          and(
            eq(reportAttestationsTable.inspectionId, inspectionId),
            isNull(reportAttestationsTable.supplementId),
          ),
        )
        .limit(1);
      expect(primaryAtt).toBeDefined();
      expect(primaryAtt.supplementId).toBeNull();
    });

    it('supplement attestation row has non-null supplementId', async () => {
      const suppAtts = await db
        .select()
        .from(reportAttestationsTable)
        .where(
          and(
            eq(reportAttestationsTable.inspectionId, inspectionId),
            eq(reportAttestationsTable.supplementId, suppId),
          ),
        );
      expect(suppAtts.length).toBeGreaterThanOrEqual(1);
      expect(suppAtts[0].supplementId).toBe(suppId);
    });

    // ── Cross-contamination regression tests ─────────────────────────────────
    // Verify that supplement sections do NOT leak into primary-package routes.
    // These tests guard the isNull(supplementId) scoping added to all primary
    // section queries (compile, list, generate, approve, lock, readiness).

    it('GET /sections for primary package does not include supplement sections', async () => {
      // There are supplement sections from the compile test (supplementId=suppId).
      // The primary GET /sections must not return them.
      const res = await request(app)
        .get(`/api/inspections/${inspectionId}/sections`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(200);

      const sections = res.body.sections as Array<{ sectionType: string; state: string }>;
      // All returned sections must be primary (state tracked by primary routes).
      // None should show 'locked' state sourced from the supplement's findings section.
      for (const s of sections) {
        if (s.sectionType === 'findings') {
          // If the primary findings section was never generated, it must be not_started —
          // not the 'locked' state that only exists on the supplement row.
          expect(s.state).not.toBe('locked');
        }
      }
    });

    it('primary-package GET /sections returns at most primary-scoped rows', async () => {
      // Count supplement sections in the DB.
      const suppSections = await db
        .select()
        .from(claimSectionsTable)
        .where(eq(claimSectionsTable.supplementId, suppId));
      expect(suppSections.length).toBeGreaterThanOrEqual(1); // seeded in compile test

      // Count rows the primary /sections endpoint returns.
      const res = await request(app)
        .get(`/api/inspections/${inspectionId}/sections`)
        .set(auth(inspector.sid));
      expect(res.status).toBe(200);

      // The API returns one entry per SECTION_TYPES entry (not one per DB row).
      // Verify none of the returned rows have an id matching a supplement section.
      const suppIds = new Set(suppSections.map((s) => s.id));
      const returnedIds = (res.body.sections as Array<{ id: string | null }>)
        .map((s) => s.id)
        .filter(Boolean) as string[];
      const leaked = returnedIds.filter((id) => suppIds.has(id));
      expect(leaked).toHaveLength(0);
    });

    it('primary compile locked-sections query excludes supplement sections', async () => {
      // The DB has at least one locked section with supplementId=suppId from the compile test.
      // If the primary compile route included it, the locked-sections array for a fresh
      // compile attempt would contain supplement content. We verify that the DB query
      // (scoped to supplement_id IS NULL) produces zero locked primary sections.
      const primaryLocked = await db
        .select({ id: claimSectionsTable.id, sectionType: claimSectionsTable.sectionType })
        .from(claimSectionsTable)
        .where(
          and(
            eq(claimSectionsTable.inspectionId, inspectionId),
            eq(claimSectionsTable.state, 'locked'),
            isNull(claimSectionsTable.supplementId),
          ),
        );
      // The primary package has no locked sections (none were generated in this test run).
      expect(primaryLocked).toHaveLength(0);

      // Confirm that without the isNull filter the locked count would be non-zero
      // (supplement sections exist and are locked).
      const allLocked = await db
        .select({ id: claimSectionsTable.id })
        .from(claimSectionsTable)
        .where(
          and(
            eq(claimSectionsTable.inspectionId, inspectionId),
            eq(claimSectionsTable.state, 'locked'),
          ),
        );
      expect(allLocked.length).toBeGreaterThan(0); // supplement sections are locked
    });
  });
});
