/**
 * Virginia Acceptance Fixture — Task #251
 *
 * Creates a fully-progressed Virginia wind-and-hail claim per run and
 * exercises every major code path end-to-end:
 *   field capture → curation → parallel section generation
 *   → approve/lock → compile → attest → deliver
 *
 * Run:
 *   cd artifacts/api-server
 *   npx tsx src/scripts/seed-acceptance-claim.ts
 *
 * Exits 0 when all steps pass; exits 1 on the first failure (after printing
 * the full pass/fail table).
 */

import request from 'supertest';
import { companiesTable, companyJurisdictionPacksTable, db, userProfilesTable, usersTable } from '@workspace/db';

import app from '../app';
import { createSession } from '../lib/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_ID = Date.now().toString(36).toUpperCase();

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

let _hashSeed = 0;
function nextHash(): string {
  _hashSeed += 1;
  return _hashSeed.toString(16).padStart(64, '0');
}

/** Step result tracking */
type StepResult = { step: string; passed: boolean; detail?: string };
const stepResults: StepResult[] = [];

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    stepResults.push({ step: name, passed: true });
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    stepResults.push({ step: name, passed: false, detail });
    process.stdout.write(`  ✗ ${name}: ${detail.slice(0, 120)}\n`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

interface PhotoRecord {
  id: string;
  sha256: string;
}

async function addPhoto(
  inspectionId: string,
  sid: string,
  body: Record<string, unknown>,
): Promise<PhotoRecord> {
  const sha256 = nextHash();
  const url = `https://example.test/${nextHash()}.jpg`;
  const res = await request(app)
    .post(`/api/inspections/${inspectionId}/photos`)
    .set(auth(sid))
    .send({ url, sha256, ...body });
  assert(
    res.status === 201,
    `Photo create failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`,
  );
  return { id: res.body.photo.id as string, sha256 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write(`\n🏃  Virginia Acceptance Fixture — Run ${RUN_ID}\n\n`);

  const COMPANY_ID = `TEST-VA-${RUN_ID}`;

  // State accumulated across steps
  let sid = '';
  let inspectionId = '';
  let gateInspectionId = '';
  let slope1Id = '';
  let slope2Id = '';
  let testSquareId = '';
  let tsWidePhotoId = '';
  let tsClosePhotoId = '';
  const photoHashes: { photoId: string; sha256: string }[] = [];
  const elevationIds: string[] = [];
  let attestationId = '';

  // ── 1. Company + manager user + session ────────────────────────────────────
  await step('Create test company (with licenses + qualifications)', async () => {
    await db.insert(companiesTable).values({
      id: COMPANY_ID,
      name: `Virginia Acceptance Co ${RUN_ID}`,
      contractorLicenses: [{ state: 'VA', licenseNumber: `CL-TEST-${RUN_ID}` }] as unknown as never,
      qualificationsText: 'Virginia-licensed residential roofing contractor with documented hail and wind damage inspection procedures.',
    });
  });

  await step('Seed VA Building Regulation Jurisdiction Pack', async () => {
    await db.insert(companyJurisdictionPacksTable).values({
      companyId: COMPANY_ID,
      jurisdiction: 'Fairfax County, VA (Acceptance Test)',
      state: 'VA',
      openingStatements: [] as unknown as never,
      uppaLaw: 'Va. Code Ann. § 38.2-2208',
      uppaStatement:
        'Under Virginia law, the policyholder has the right to select any licensed contractor.',
      generalCodeCitations: [] as unknown as never,
      roofingCodeCitations: [] as unknown as never,
      sidingCodeCitations: [] as unknown as never,
    });
  });

  await step('Create manager user + session', async () => {
    const [user] = await db
      .insert(usersTable)
      .values({
        companyId: COMPANY_ID,
        email: `va-mgr-${RUN_ID}@accept.test`,
        firstName: 'Virginia',
        lastName: 'Manager',
      })
      .returning();
    await db
      .insert(userProfilesTable)
      .values({ userId: user.id, role: 'manager', department: 'inspector_canvasser' });

    sid = await createSession({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        companyId: COMPANY_ID,
      },
      access_token: 'acceptance-test-token',
    });
  });

  await step('Set inspector signature on file', async () => {
    const seed = RUN_ID.repeat(3).slice(0, 64);
    const r = await request(app)
      .patch('/api/profile/signature')
      .set(auth(sid))
      .send({
        signatureUrl: `https://example.test/sig-${RUN_ID}.png`,
        signatureSha256: seed,
      });
    assert(r.status === 200, `Set signature failed (${r.status}): ${JSON.stringify(r.body)}`);
  });

  // ── 2. Create inspection ───────────────────────────────────────────────────
  await step('Create Virginia wind-and-hail inspection', async () => {
    const r = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({
        claimNumber: `VA-ACCEPT-${RUN_ID}`,
        insuredName: 'Robert A. Fixture',
        address: '1234 Discovery St, Reston, VA 20194',
        carrierName: 'Commonwealth Insurance',
        policyNumber: 'POL-VA-2026-001',
        dateOfLoss: '2026-05-15',
        damageType: 'hail_and_wind',
      });
    assert(r.status === 201, `Create inspection failed (${r.status}): ${JSON.stringify(r.body)}`);
    inspectionId = r.body.inspection.id as string;
  });

  // ── 3. Field capture ───────────────────────────────────────────────────────

  await step('Patch: arrival conditions + damage flags + storm of record', async () => {
    const r = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth(sid))
      .send({
        arrivalConditions: {
          sky: 'Clear',
          windCondition: 'Calm',
          temp: '68F',
          personnelPresent: ['Homeowner'],
          timeLocal: '5/15/2026, 10:30:00 AM',
          gpsLatitude: 38.9686,
          gpsLongitude: -77.3411,
          recordedAtUtc: new Date().toISOString(),
        },
        roofDamageFound: true,
        collateralDamageFound: true,
        interiorDamageFound: true,
        stormConfirmedRef: {
          type: 'hail',
          date: '2026-05-15',
          hailSize: 1.75,
          windSpeed: 68,
          distance: null,
          description: 'Derecho event — NWS Storm Data publication May 2026',
          queriedLocation: '1234 Discovery St, Reston, VA 20194',
          dateOfLoss: '2026-05-15',
          confirmedAtUtc: new Date().toISOString(),
        },
      });
    assert(r.status === 200, `Patch failed (${r.status}): ${JSON.stringify(r.body)}`);
  });

  await step('Create 4 elevations + wide photos', async () => {
    for (const direction of ['front', 'right', 'back', 'left'] as const) {
      const er = await request(app)
        .post(`/api/inspections/${inspectionId}/elevations`)
        .set(auth(sid))
        .send({ direction });
      assert(er.status === 201, `Elevation create failed (${er.status})`);
      const elevId = er.body.elevation.id as string;
      elevationIds.push(elevId);
      const photo = await addPhoto(inspectionId, sid, {
        subjectType: 'elevation',
        subjectId: elevId,
        triadRole: 'wide',
      });
      photoHashes.push({ photoId: photo.id, sha256: photo.sha256 });
    }
    // Roof-access photo
    const accessPhoto = await addPhoto(inspectionId, sid, {
      subjectType: 'inspection',
      stage: 'elevation_access',
      triadRole: 'wide',
    });
    photoHashes.push({ photoId: accessPhoto.id, sha256: accessPhoto.sha256 });
  });

  await step('Create 2 damaged slopes + wide overview photos', async () => {
    const s1 = await request(app)
      .post(`/api/inspections/${inspectionId}/slopes`)
      .set(auth(sid))
      .send({
        label: 'F1',
        pitchRise: 5,
        pitchRun: 12,
        areaSqft: 420,
        materialType: 'Asphalt shingle',
        damagePresent: true,
        damageType: 'hail',
      });
    assert(s1.status === 201, `Slope F1 create failed (${s1.status}): ${JSON.stringify(s1.body)}`);
    slope1Id = s1.body.slope.id as string;

    const s2 = await request(app)
      .post(`/api/inspections/${inspectionId}/slopes`)
      .set(auth(sid))
      .send({
        label: 'F2',
        pitchRise: 4,
        pitchRun: 12,
        areaSqft: 280,
        materialType: 'Asphalt shingle',
        damagePresent: true,
        damageType: 'hail',
      });
    assert(s2.status === 201, `Slope F2 create failed (${s2.status}): ${JSON.stringify(s2.body)}`);
    slope2Id = s2.body.slope.id as string;

    for (const slopeId of [slope1Id, slope2Id]) {
      const p = await addPhoto(inspectionId, sid, {
        subjectType: 'slope',
        subjectId: slopeId,
        triadRole: 'wide',
      });
      photoHashes.push({ photoId: p.id, sha256: p.sha256 });
    }
  });

  await step('Create damage instances + close-up photos', async () => {
    const d1 = await request(app)
      .post(`/api/inspections/${inspectionId}/damage-instances`)
      .set(auth(sid))
      .send({
        slopeId: slope1Id,
        damageType: 'hail_strike',
        severity: 'functional',
        causationNote: 'Granule displacement and mat bruising at hail contact points',
      });
    assert(d1.status === 201, `Damage instance F1 failed (${d1.status}): ${JSON.stringify(d1.body)}`);
    const dmgId = d1.body.damageInstance.id as string;

    const closePhoto = await addPhoto(inspectionId, sid, {
      subjectType: 'damage_instance',
      subjectId: dmgId,
      triadRole: 'close',
    });
    photoHashes.push({ photoId: closePhoto.id, sha256: closePhoto.sha256 });

    const d2 = await request(app)
      .post(`/api/inspections/${inspectionId}/damage-instances`)
      .set(auth(sid))
      .send({
        slopeId: slope2Id,
        damageType: 'hail_strike',
        severity: 'functional',
        causationNote: 'Wind scour along ridge and displacement of tab adhesive',
      });
    assert(d2.status === 201, `Damage instance F2 failed (${d2.status}): ${JSON.stringify(d2.body)}`);
    const dmgId2 = d2.body.damageInstance.id as string;
    const closePhoto2 = await addPhoto(inspectionId, sid, {
      subjectType: 'damage_instance',
      subjectId: dmgId2,
      triadRole: 'close',
    });
    photoHashes.push({ photoId: closePhoto2.id, sha256: closePhoto2.sha256 });
  });

  await step('Create collateral damage photo', async () => {
    const p = await addPhoto(inspectionId, sid, {
      subjectType: 'inspection',
      triadRole: 'collateral',
      stage: 'collateral',
    });
    photoHashes.push({ photoId: p.id, sha256: p.sha256 });
  });

  await step('Create measurement photo (edge-assembly slot candidate)', async () => {
    const p = await addPhoto(inspectionId, sid, {
      subjectType: 'inspection',
      triadRole: 'measurement',
      stage: 'components',
    });
    photoHashes.push({ photoId: p.id, sha256: p.sha256 });
  });

  await step('Create test squares (F1 + F2) + 14 hits + wide + close photos', async () => {
    // Test square for slope1 (F1) — primary RAP square
    const tsr = await request(app)
      .post(`/api/inspections/${inspectionId}/test-squares`)
      .set(auth(sid))
      .send({ slopeId: slope1Id, label: 'TS-1', sizeSqFt: 100 });
    assert(tsr.status === 201, `Test square create failed (${tsr.status}): ${JSON.stringify(tsr.body)}`);
    testSquareId = tsr.body.testSquare.id as string;

    // 14 hail hits across the 100 sqft square
    for (let i = 0; i < 14; i++) {
      const hr = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${testSquareId}/hits`)
        .set(auth(sid))
        .send({ hitType: 'hail_strike' });
      assert(hr.status === 201, `Hit ${i + 1} create failed (${hr.status})`);
    }

    // Wide photo → rap1_baseline + facet_overview candidates
    const wide = await addPhoto(inspectionId, sid, {
      subjectType: 'test_square',
      subjectId: testSquareId,
      triadRole: 'wide',
      stage: 'test_squares',
    });
    photoHashes.push({ photoId: wide.id, sha256: wide.sha256 });
    tsWidePhotoId = wide.id;

    // Close photo → rap_outcome_1 + test_square_1 + spatter candidates
    const close = await addPhoto(inspectionId, sid, {
      subjectType: 'test_square',
      subjectId: testSquareId,
      triadRole: 'close',
      stage: 'test_squares',
    });
    photoHashes.push({ photoId: close.id, sha256: close.sha256 });
    tsClosePhotoId = close.id;

    // Test square for slope2 (F2) — hail gate requires one per hail-damaged slope
    const tsr2 = await request(app)
      .post(`/api/inspections/${inspectionId}/test-squares`)
      .set(auth(sid))
      .send({ slopeId: slope2Id, label: 'TS-2', sizeSqFt: 100 });
    assert(tsr2.status === 201, `Test square F2 create failed (${tsr2.status}): ${JSON.stringify(tsr2.body)}`);
    const ts2Id = tsr2.body.testSquare.id as string;

    // Minimal hits for F2
    for (let i = 0; i < 8; i++) {
      await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${ts2Id}/hits`)
        .set(auth(sid))
        .send({ hitType: 'hail_strike' });
    }

    // Wide + close for TS-2
    const wide2 = await addPhoto(inspectionId, sid, {
      subjectType: 'test_square',
      subjectId: ts2Id,
      triadRole: 'wide',
      stage: 'test_squares',
    });
    photoHashes.push({ photoId: wide2.id, sha256: wide2.sha256 });

    const close2 = await addPhoto(inspectionId, sid, {
      subjectType: 'test_square',
      subjectId: ts2Id,
      triadRole: 'close',
      stage: 'test_squares',
    });
    photoHashes.push({ photoId: close2.id, sha256: close2.sha256 });
  });

  await step('Create interior observation entity + photos (opening + terminus)', async () => {
    // Create an interior observation entity first (required for subjectType: interior_observation
    // which satisfies the protocol gate interiorPhotoCaptured check)
    const ior = await request(app)
      .post(`/api/inspections/${inspectionId}/interior-observations`)
      .set(auth(sid))
      .send({
        location: 'Master bedroom — northeast corner ceiling',
        observationType: 'ceiling_stain',
        notes: 'Active moisture intrusion traced from ridge penetration to drywall surface',
      });
    assert(ior.status === 201, `Interior observation create failed (${ior.status}): ${JSON.stringify(ior.body)}`);
    const obsId = ior.body.interiorObservation.id as string;

    // Photos linked to the observation satisfy interiorPhotoCaptured gate
    for (let i = 0; i < 2; i++) {
      const p = await addPhoto(inspectionId, sid, {
        subjectType: 'interior_observation',
        subjectId: obsId,
        stage: 'interior',
        triadRole: 'wide',
      });
      photoHashes.push({ photoId: p.id, sha256: p.sha256 });
    }
  });

  await step('Create edge-assembly component (not_observed) + eave_edge zone photo', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/components`)
      .set(auth(sid))
      .send({
        componentType: 'drip_edge',
        status: 'not_observed',
        notes: 'Edge assembly inaccessible from ground; observation deferred per safety protocol',
      });
    assert(
      r.status === 201 || r.status === 200,
      `Component create failed (${r.status}): ${JSON.stringify(r.body)}`,
    );

    // Zone photo required by the gate: one shared photo per zone that has ≥1 component.
    // drip_edge → eave_edge zone. subjectType='component' + zone tag, no subjectId.
    const zp = await addPhoto(inspectionId, sid, {
      subjectType: 'component',
      zone: 'eave_edge',
      stage: 'components',
      triadRole: 'wide',
    });
    photoHashes.push({ photoId: zp.id, sha256: zp.sha256 });
  });

  await step('Create roof measurements', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/measurements`)
      .set(auth(sid))
      .send({ subjectType: 'inspection', measurementType: 'ridge_lf', value: 48, unit: 'lf' });
    assert(r.status === 201, `Measurement create failed (${r.status}): ${JSON.stringify(r.body)}`);
  });

  await step('Create discontinued product (field_identified)', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/products`)
      .set(auth(sid))
      .send({
        category: 'Shingle',
        brand: 'CertainTeed',
        productLine: 'Landmark TL — 40yr (Discontinued)',
        identificationMethod: 'field_identified',
        discontinued: 'discontinued',
        ordinaryAvailability: 'not_reasonably_available',
      });
    assert(r.status === 201, `Product create failed (${r.status}): ${JSON.stringify(r.body)}`);
  });

  await step('Set RAP v3 — damaged_target mode + delamination outcome', async () => {
    const r = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth(sid))
      .send({
        repairabilityAssessment: {
          version: 3,
          warranted: 'yes',
          systems: ['roof'],
          roofType: 'asphalt_shingle',
          rap: {
            selection: {
              mode: 'damaged_target',
              criteria: {
                fullLengthUncut: true,
                twoCoursesAboveEave: true,
                fullShingleLengthFromEdges: true,
                freeOfPenetrations: true,
                representativeExposure: true,
              },
            },
            manipulatedCount: 6,
            rap1PhotoId: tsWidePhotoId,
            matTransfer: { shingle1: 'no', shingle2: 'no' },
            damage: {
              delamination: {
                answer: 'yes',
                shingles: [3, 4, 5],
                photoId: tsClosePhotoId,
                note: 'Granule-mat delamination at shingles 3–5 consistent with hail contact force',
              },
              creasing: { answer: 'no', shingles: [] },
              nailZone: { answer: 'no', shingles: [] },
              puncture: { answer: 'no', shingles: [] },
              reseat: { answer: 'no', shingles: [] },
            },
          },
          recordedAtUtc: new Date().toISOString(),
        },
      });
    assert(r.status === 200, `RAP patch failed (${r.status}): ${JSON.stringify(r.body)}`);
  });

  await step('Set estimate with 3 line items', async () => {
    const r = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(sid))
      .send({
        wastePercent: 12,
        lines: [
          {
            description: 'Dimensional Asphalt Shingles — 40yr (Full Replacement)',
            quantity: 24.5,
            unit: 'SQ',
            unitPriceCents: 28500,
            isAdder: false,
            priceBookItemId: null,
          },
          {
            description: 'Synthetic Underlayment',
            quantity: 24.5,
            unit: 'SQ',
            unitPriceCents: 6200,
            isAdder: false,
            priceBookItemId: null,
          },
          {
            description: 'Aluminum Drip Edge — Eave and Rake',
            quantity: 280,
            unit: 'LF',
            unitPriceCents: 185,
            isAdder: false,
            priceBookItemId: null,
          },
        ],
        note: 'Full replacement per forensic field record — CertainTeed Landmark TL discontinued',
      });
    assert(r.status === 200, `Estimate PUT failed (${r.status}): ${JSON.stringify(r.body)}`);
  });

  await step('Create stage_signoff attestations (declaration + submit)', async () => {
    const decl = await request(app)
      .post(`/api/inspections/${inspectionId}/attestations`)
      .set(auth(sid))
      .send({ stage: 'declaration', attestationType: 'stage_signoff', signatureData: 'Robert A. Fixture' });
    assert(decl.status === 201, `Declaration attestation failed (${decl.status}): ${JSON.stringify(decl.body)}`);

    const submit = await request(app)
      .post(`/api/inspections/${inspectionId}/attestations`)
      .set(auth(sid))
      .send({ stage: 'submit', attestationType: 'stage_signoff' });
    assert(submit.status === 201, `Submit attestation failed (${submit.status}): ${JSON.stringify(submit.body)}`);
  });

  await step('Submit (lock) field record', async () => {
    const manifest = {
      protocolVersion: 'v1',
      generatedAtUtc: new Date().toISOString(),
      records: {
        slopes: [slope1Id, slope2Id],
        elevations: elevationIds,
        testSquares: [testSquareId],
      },
      photoHashes,
      gateResults: { deficiencies: [], softFlags: [] },
    };
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/submission`)
      .set(auth(sid))
      .send({ manifest });
    const deficiencies = r.body?.deficiencies as Array<{ stage: string; code: string; message: string }> | undefined;
    const defMsg = deficiencies?.map((d) => `[${d.stage}/${d.code}] ${d.message}`).join(' | ') ?? '';
    assert(
      r.status === 200 || r.status === 201,
      `Submit failed (${r.status}): ${defMsg || JSON.stringify(r.body).slice(0, 400)}`,
    );
  });

  // ── 4. AI Summary (required before compile) ────────────────────────────────
  await step('Generate AI summary', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/summary`)
      .set(auth(sid))
      .send({});
    assert(r.status === 200, `AI summary failed (${r.status}): ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(
      typeof r.body.summary?.forensicSummary === 'string' && r.body.summary.forensicSummary.length > 0,
      'AI summary: forensicSummary missing or empty',
    );
  });

  // ── 5. Curation — confirm all required slots dynamically ───────────────────
  let causeDiffBeforePhotoId = '';
  let causeDiffAfterPhotoId = '';

  await step('Confirm all required exhibit slots (dynamic)', async () => {
    // Note: exhibit-slots is mounted at /api/:id/exhibit-slots (not /api/inspections/:id/)
    const gr = await request(app)
      .get(`/api/${inspectionId}/exhibit-slots`)
      .set(auth(sid));
    assert(gr.status === 200, `Get exhibit slots failed (${gr.status}): ${JSON.stringify(gr.body).slice(0, 200)}`);

    type SlotCandidate = { id: string };
    type Slot = {
      slotKey: string;
      required: boolean;
      kind: string;
      candidates: SlotCandidate[];
      beforeCandidates?: SlotCandidate[];
      afterCandidates?: SlotCandidate[];
    };

    const slots = gr.body.slots as Slot[];
    process.stdout.write(
      `    ${slots.length} slots, ${slots.filter((s) => s.required).length} required\n`,
    );

    const requiredSingle = slots.filter((s) => s.required && s.kind === 'single');
    const missingCandidates: string[] = [];

    for (const slot of requiredSingle) {
      if (slot.candidates.length === 0) {
        missingCandidates.push(slot.slotKey);
        continue;
      }
      const photoId = slot.candidates[0].id;

      // Select photo into the exhibit selections table
      const sel = await request(app)
        .patch(`/api/${inspectionId}/curation/photos/${photoId}`)
        .set(auth(sid))
        .send({ selected: true });
      assert(
        sel.status === 200 || sel.status === 201,
        `Select photo failed for ${slot.slotKey} (${sel.status}): ${JSON.stringify(sel.body)}`,
      );

      // Emit slot_confirmed event
      // Note: events route is at /api/inspections/:id/events
      const ev = await request(app)
        .post(`/api/inspections/${inspectionId}/events`)
        .set(auth(sid))
        .send({ eventType: 'slot_confirmed', payload: { slotKey: slot.slotKey, photoId } });
      assert(
        ev.status === 201 || ev.status === 200,
        `slot_confirmed failed for ${slot.slotKey} (${ev.status}): ${JSON.stringify(ev.body).slice(0, 200)}`,
      );
    }

    if (missingCandidates.length > 0) {
      throw new Error(`Required slots with no candidates: ${missingCandidates.join(', ')}`);
    }

    // Capture cause_differentiation comparison slot photo IDs
    const causeDiff = slots.find((s) => s.slotKey === 'comparison_cause_differentiation');
    if (causeDiff?.beforeCandidates?.length && causeDiff.afterCandidates?.length) {
      causeDiffBeforePhotoId = causeDiff.beforeCandidates[0].id;
      causeDiffAfterPhotoId = causeDiff.afterCandidates[0].id;
    }
  });

  await step('Create cause_differentiation comparison pair', async () => {
    assert(causeDiffBeforePhotoId !== '', 'No before-photo for cause_differentiation slot');
    assert(causeDiffAfterPhotoId !== '', 'No after-photo for cause_differentiation slot');

    const r = await request(app)
      .post(`/api/${inspectionId}/curation/pairs`)
      .set(auth(sid))
      .send({
        beforePhotoId: causeDiffBeforePhotoId,
        afterPhotoId: causeDiffAfterPhotoId,
        pairType: 'cause_differentiation',
        notes: 'Storm-localized impact damage (test-square) vs. uniform general weathering pattern',
      });
    assert(
      r.status === 200 || r.status === 201,
      `Pair create failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  });

  await step('Finalize curation (badge freeze)', async () => {
    const r = await request(app)
      .post(`/api/${inspectionId}/curation/finalize`)
      .set(auth(sid))
      .send({});
    assert(r.status === 200, `Finalize failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('Generate exhibit captions (AI — per-photo + comparison pairs)', async () => {
    // Caption generation is required before compile: the compile gate checks that
    // every confirmed comparison pair has a non-null captionText in comparison_set_captions.
    // Retry up to 3× — "too few valid results" is a transient AI response issue.
    let r: Awaited<ReturnType<typeof request.prototype.send>>;
    let attempt = 0;
    while (true) {
      attempt++;
      r = await request(app)
        .post(`/api/${inspectionId}/sections/captions/generate`)
        .set(auth(sid))
        .send({});
      if (r.status === 200 || attempt >= 3) break;
      process.stdout.write(`    Caption attempt ${attempt} returned ${r.status}; retrying…\n`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
    assert(
      r!.status === 200,
      `Caption generate failed (${r!.status}): ${JSON.stringify(r!.body).slice(0, 300)}`,
    );
    const { captions = [], setCaptions = [] } = r!.body as {
      captions: Array<{ state: string }>;
      setCaptions: Array<{ state: string }>;
    };
    process.stdout.write(
      `    ${captions.length} photo captions, ${setCaptions.length} set captions generated\n`,
    );
  });

  await step('Approve exhibit captions', async () => {
    const r = await request(app)
      .post(`/api/${inspectionId}/sections/captions/approve`)
      .set(auth(sid))
      .send({});
    assert(r.status === 200, `Caption approve failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  // ── 6. Parallel section generation ────────────────────────────────────────
  const UPSTREAM_SECTIONS = [
    'findings',
    'causation',
    'detriment_application',
    'rap_narrative',
    'estimate_justifications',
  ] as const;

  type UpstreamSection = typeof UPSTREAM_SECTIONS[number];

  await step('Generate 5 upstream sections in parallel', async () => {
    const responses = await Promise.all(
      UPSTREAM_SECTIONS.map((sectionType) =>
        request(app)
          .post(`/api/inspections/${inspectionId}/sections/${sectionType}/generate`)
          .set(auth(sid))
          .send({}),
      ),
    );
    const failures: string[] = [];
    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      const sectionType = UPSTREAM_SECTIONS[i];
      if (r.status !== 200) {
        failures.push(
          `${sectionType}: HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 100)}`,
        );
      } else if (typeof r.body.contentHtml !== 'string' || r.body.contentHtml.length === 0) {
        failures.push(`${sectionType}: empty contentHtml`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Section generation failures:\n    ${failures.join('\n    ')}`);
    }
    process.stdout.write(`    All 5 sections generated\n`);
  });

  // ── 7. Approve upstream sections ───────────────────────────────────────────
  await step('Approve: findings', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/approve`)
      .set(auth(sid))
      .send({});
    assert(r.status === 200, `Approve findings failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('Approve: causation (causationReviewConfirmed: true)', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/causation/approve`)
      .set(auth(sid))
      .send({ causationReviewConfirmed: true });
    assert(r.status === 200, `Approve causation failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('Approve: detriment_application (causationReviewConfirmed: true)', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/detriment_application/approve`)
      .set(auth(sid))
      .send({ causationReviewConfirmed: true });
    assert(
      r.status === 200,
      `Approve detriment_application failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  });

  await step('Approve: rap_narrative (damaged_target mode — no extra flag)', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/rap_narrative/approve`)
      .set(auth(sid))
      .send({});
    assert(
      r.status === 200,
      `Approve rap_narrative failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  });

  await step('Approve: estimate_justifications', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/estimate_justifications/approve`)
      .set(auth(sid))
      .send({});
    assert(
      r.status === 200,
      `Approve estimate_justifications failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  });

  // ── 8. Lock upstream sections ──────────────────────────────────────────────
  await step('Lock all 5 upstream sections', async () => {
    const failures: string[] = [];
    for (const sectionType of UPSTREAM_SECTIONS) {
      const r = await request(app)
        .post(`/api/inspections/${inspectionId}/sections/${sectionType}/lock`)
        .set(auth(sid))
        .send({ overrideLintBlock: true }); // manager override for any lint blocks
      if (r.status !== 200) {
        failures.push(`${sectionType}: HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 100)}`);
      }
    }
    if (failures.length > 0) throw new Error(`Lock failures:\n    ${failures.join('\n    ')}`);
  });

  // ── 9. DAG-last sections: summary + closing ────────────────────────────────
  await step('Generate summary_of_findings', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/summary_of_findings/generate`)
      .set(auth(sid))
      .send({});
    assert(
      r.status === 200,
      `Generate summary_of_findings failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`,
    );
    assert(
      typeof r.body.contentHtml === 'string' && r.body.contentHtml.length > 0,
      'summary_of_findings: empty contentHtml',
    );
  });

  await step('Generate closing_statement', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/closing_statement/generate`)
      .set(auth(sid))
      .send({});
    assert(
      r.status === 200,
      `Generate closing_statement failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`,
    );
    assert(
      typeof r.body.contentHtml === 'string' && r.body.contentHtml.length > 0,
      'closing_statement: empty contentHtml',
    );
  });

  await step('Approve + lock summary_of_findings', async () => {
    const ar = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/summary_of_findings/approve`)
      .set(auth(sid))
      .send({});
    assert(ar.status === 200, `Approve summary failed (${ar.status}): ${JSON.stringify(ar.body).slice(0, 200)}`);

    const lr = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/summary_of_findings/lock`)
      .set(auth(sid))
      .send({ overrideLintBlock: true });
    assert(lr.status === 200, `Lock summary failed (${lr.status}): ${JSON.stringify(lr.body).slice(0, 200)}`);
  });

  await step('Approve + lock closing_statement', async () => {
    const ar = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/closing_statement/approve`)
      .set(auth(sid))
      .send({});
    assert(ar.status === 200, `Approve closing failed (${ar.status}): ${JSON.stringify(ar.body).slice(0, 200)}`);

    const lr = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/closing_statement/lock`)
      .set(auth(sid))
      .send({ overrideLintBlock: true });
    assert(lr.status === 200, `Lock closing failed (${lr.status}): ${JSON.stringify(lr.body).slice(0, 200)}`);
  });

  // ── 10. Compile ────────────────────────────────────────────────────────────
  await step('Compile report (gemini-3.1-pro-preview — retries up to 3×)', async () => {
    // The compile route uses gemini-3.1-pro-preview which may have transient failures.
    // Retry up to 3 times with a short back-off before treating it as a hard failure.
    let r: Awaited<ReturnType<typeof request.prototype.send>>;
    let attempt = 0;
    while (true) {
      attempt++;
      r = await request(app)
        .post(`/api/inspections/${inspectionId}/report/compile`)
        .set(auth(sid))
        .send({});
      if (r.status === 200 || attempt >= 3) break;
      process.stdout.write(`    Compile attempt ${attempt} returned ${r.status}; retrying…\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
    assert(r!.status === 200, `Compile failed (${r!.status}): ${JSON.stringify(r!.body).slice(0, 300)}`);
    // Compile returns { compiledReportPath, lintStatus, findings } directly.
    // compiledReportVersions is stored in the DB but not exposed by GET /inspections/:id.
    const compiledPath = r!.body.compiledReportPath as string | undefined;
    assert(typeof compiledPath === 'string' && compiledPath.length > 0, 'compiledReportPath missing from compile response');
    const safePath = compiledPath as string;
    const lintStatus = r!.body.lintStatus as string | undefined;
    process.stdout.write(`    Blob written at ${safePath.slice(-12)}; lintStatus: ${lintStatus ?? 'unknown'}\n`);
  });

  // ── 11. Attest ─────────────────────────────────────────────────────────────
  await step('Attest report (acknowledged: true)', async () => {
    const ar = await request(app)
      .post(`/api/inspections/${inspectionId}/report-attestation`)
      .set(auth(sid))
      .send({ acknowledged: true });
    assert(ar.status === 201, `Attest failed (${ar.status}): ${JSON.stringify(ar.body).slice(0, 300)}`);
    assert(ar.body.attested === true, `Expected attested=true, got: ${JSON.stringify(ar.body)}`);
    attestationId = (ar.body.attestation?.id as string) ?? '';
    assert(attestationId.length > 0, 'Attestation id missing from attest response');

    // Verify the signed blob was written by GET /report-attestation (it reads
    // compiledReportVersions directly from the DB, unlike GET /inspections/:id
    // which strips the field from its response schema).
    const gaR = await request(app)
      .get(`/api/inspections/${inspectionId}/report-attestation`)
      .set(auth(sid));
    assert(gaR.status === 200, `GET report-attestation failed (${gaR.status})`);
    assert(gaR.body.attested === true, 'GET report-attestation returned attested:false after POST');
    assert(gaR.body.attestation?.id === attestationId, 'Attestation id mismatch between POST and GET');

    // Check the signed entry in compiledReportVersions via the DB directly
    const { db: dbInst, inspectionsTable: inspTbl } = await import('@workspace/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await dbInst
      .select({ compiledReportVersions: inspTbl.compiledReportVersions })
      .from(inspTbl)
      .where(eq(inspTbl.id, inspectionId));
    const versions = (row?.compiledReportVersions ?? []) as Array<{
      isSignedVersion?: boolean;
      reportAttestationId?: string;
    }>;
    const signedVersion = versions.find((v) => v.isSignedVersion);
    assert(signedVersion !== undefined, 'No isSignedVersion entry in compiledReportVersions after attestation');
    assert(
      signedVersion!.reportAttestationId === attestationId,
      `reportAttestationId mismatch: expected ${attestationId}, got ${signedVersion!.reportAttestationId}`,
    );
    process.stdout.write(
      `    Signed blob written; reportAttestationId: ${attestationId.slice(0, 8)}…\n`,
    );
  });

  // ── 12. Deliver gate: out-of-order deliver must return 422 ─────────────────
  await step('Deliver gate: create fresh unattested claim for out-of-order test', async () => {
    const cr = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({ claimNumber: `VA-GATE-${RUN_ID}` });
    assert(cr.status === 201, `Gate claim create failed (${cr.status}): ${JSON.stringify(cr.body)}`);
    gateInspectionId = cr.body.inspection.id as string;
  });

  await step('Deliver gate: 422 when no compiled report (out-of-order deliver)', async () => {
    const r = await request(app)
      .post(`/api/inspections/${gateInspectionId}/email-report`)
      .set(auth(sid))
      .send({
        recipient: 'homeowner@example.test',
        pdfBase64: Buffer.from('%PDF-1.4 gate-test').toString('base64'),
        filename: 'report.pdf',
      });
    assert(
      r.status === 422,
      `Expected 422 for unattested deliver, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  });

  await step('Deliver attested claim (SMTP not configured → writes package_delivered event)', async () => {
    const r = await request(app)
      .post(`/api/inspections/${inspectionId}/email-report`)
      .set(auth(sid))
      .send({
        recipient: 'homeowner@example.test',
        pdfBase64: Buffer.from('%PDF-1.4 acceptance-test-delivery').toString('base64'),
        filename: 'claim-report-reston-va.pdf',
        subject: 'Forensic Roof Inspection Report — 1234 Discovery St',
        body: 'Please find attached the forensic roof inspection report for your claim.',
      });
    assert(
      r.status === 200,
      `Deliver failed (${r.status}): ${JSON.stringify(r.body).slice(0, 300)}`,
    );
    // Accept both sent=true (SMTP configured) and sent=false/skipped (no SMTP)
    assert(
      typeof r.body.sent === 'boolean',
      `Missing 'sent' field in deliver response: ${JSON.stringify(r.body)}`,
    );

    if (r.body.skipped) {
      process.stdout.write(`    SMTP not configured → email skipped (reason: ${r.body.reason})\n`);
    } else {
      process.stdout.write(`    Email sent successfully\n`);
    }

    // Verify package_delivered event written to claim timeline
    const eventsR = await request(app)
      .get(`/api/inspections/${inspectionId}/events`)
      .set(auth(sid));
    assert(eventsR.status === 200, `Get events failed (${eventsR.status})`);
    const events = eventsR.body.events as Array<{ eventType: string }>;
    const deliveryEvent = events.find((e) => e.eventType === 'package_delivered');
    assert(
      deliveryEvent !== undefined,
      `package_delivered event not found in claim timeline (events: ${events.map((e) => e.eventType).join(', ')})`,
    );
    process.stdout.write(`    package_delivered event written to claim timeline ✓\n`);
  });

  // ── Pass / fail table ──────────────────────────────────────────────────────
  const passed = stepResults.filter((r) => r.passed).length;
  const failed = stepResults.filter((r) => !r.passed).length;

  const LINE = '═'.repeat(68);
  process.stdout.write(`\n╔${LINE}╗\n`);
  process.stdout.write(`║${'  VIRGINIA ACCEPTANCE WALK — RESULTS'.padEnd(68)}║\n`);
  process.stdout.write(`╠${LINE}╣\n`);
  for (const r of stepResults) {
    const icon = r.passed ? '✓' : '✗';
    const label = `${icon} ${r.step}`.slice(0, 66).padEnd(66);
    process.stdout.write(`║  ${label}  ║\n`);
    if (!r.passed && r.detail) {
      const detail = `  → ${r.detail}`.slice(0, 66).padEnd(66);
      process.stdout.write(`║  ${detail}  ║\n`);
    }
  }
  process.stdout.write(`╠${LINE}╣\n`);
  process.stdout.write(
    `║  ${'PASSED: ' + passed + '   FAILED: ' + failed + '   Claim: ' + inspectionId.slice(0, 8) + '…'.padEnd(30)}`.padEnd(70) + `║\n`,
  );
  process.stdout.write(`╚${LINE}╝\n\n`);

  if (failed > 0) {
    process.stderr.write(`❌  ${failed} step(s) failed. Claim ID: ${inspectionId}\n\n`);
    process.exit(1);
  } else {
    process.stdout.write(`✅  All ${passed} steps passed. Claim ID: ${inspectionId}\n\n`);
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error:', err);
  process.exit(1);
});
