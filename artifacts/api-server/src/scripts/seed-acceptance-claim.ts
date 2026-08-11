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
import {
  companiesTable,
  companyJurisdictionPacksTable,
  contractScopePackagesTable,
  contractSelectionsTable,
  contractsTable,
  db,
  inspectionsTable,
  pinsTable,
  selectionBrandsTable,
  selectionCategoriesTable,
  selectionProductsTable,
  stageTransitionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, sql } from 'drizzle-orm';

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
// Pipeline assertion helpers (Deliverables 1 / 2 / 3)
// ---------------------------------------------------------------------------

/** Insert a bare pin at a specific stage; appends its id to `pinIds` for cleanup. */
async function seedPipelinePin(
  companyId: string,
  userId: string,
  workflow: 'retail' | 'insurance',
  stage: string,
  pinIds: string[],
): Promise<string> {
  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId, userId, latitude: 38.9686, longitude: -77.3411, workflow, pipelineStage: stage, status: 'active' })
    .returning();
  pinIds.push(pin!.id);
  return pin!.id;
}

/** Read the pin's current pipelineStage from the DB. */
async function pinStageNow(pinId: string): Promise<string | null> {
  const [row] = await db
    .select({ pipelineStage: pinsTable.pipelineStage })
    .from(pinsTable)
    .where(eq(pinsTable.id, pinId));
  return row?.pipelineStage ?? null;
}

/**
 * Poll until the pin reaches `expected` or the window expires.
 * Returns the actual stage at the end of the poll window.
 */
async function pollPinStage(pinId: string, expected: string, timeoutMs = 2500): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stage = await pinStageNow(pinId);
    if (stage === expected) return stage;
    await new Promise((r) => setTimeout(r, 120));
  }
  return pinStageNow(pinId);
}

/** Count stage_transitions rows written for a given pin. */
async function stageTransitionCount(pinId: string): Promise<number> {
  const rows = await db
    .select({ id: stageTransitionsTable.id })
    .from(stageTransitionsTable)
    .where(eq(stageTransitionsTable.leadId, pinId));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Contract-sign helper — reused by D2c, D3c, and 3b
// Builds a draft contract on pinId, pushes it to 'sent' via DB, reads the
// access code, and calls the portal sign route.  Uses customerSignaturePath
// to avoid triggering the object-storage upload path in test runs.
// ---------------------------------------------------------------------------

/**
 * Build a contract on `pinId`, push it to 'sent' via DB, read the access
 * code, and call the portal sign route.  Uses `customerSignaturePath` (not
 * `customerSignatureBase64`) to avoid triggering the object-storage upload
 * path in test runs.  `app` and `auth` are module-scope so are not repeated
 * in the opts.
 */
async function buildAndSignContract(opts: {
  sid: string;
  pinId: string;
  shaTag: string;
  catId: string;
  productId: string;
  companyId: string;
  /** Expected HTTP status of the portal sign call; default 200 */
  expectSignStatus?: number;
}): Promise<{ signStatus: number }> {
  const { sid, pinId, shaTag, catId, productId, companyId, expectSignStatus = 200 } = opts;

  // Create contract (draft)
  const cRes = await request(app)
    .post(`/api/pins/${pinId}/contracts`)
    .set(auth(sid))
    .send({ coveredScopeCents: 1500000 });
  assert(cRes.status === 201, `Contract create failed (${cRes.status}): ${JSON.stringify(cRes.body).slice(0, 200)}`);
  const contractId = cRes.body.contract.id as string;

  // Add scope package
  const pkgRes = await request(app)
    .post(`/api/contracts/${contractId}/scope-packages`)
    .set(auth(sid))
    .send({ categoryId: catId, quantity: 20, unit: 'SQ', coveredAmountCents: 1500000, sortOrder: 1 });
  assert(pkgRes.status === 201, `Scope package failed (${pkgRes.status}): ${JSON.stringify(pkgRes.body).slice(0, 200)}`);
  const pkgId = pkgRes.body.scopePackage.id as string;

  // Insert selection directly (avoids full picker API)
  await db.insert(contractSelectionsTable).values({
    companyId, contractId, scopePackageId: pkgId, productId,
    productName: 'Test Shingle', brandName: 'TestBrand',
    unitDeltaCents: 0, quantity: '20', extendedDeltaCents: 0, selectedBy: 'customer',
  });

  // Push to 'sent' + set SHA256 via DB (bypasses PDF generation)
  const sha256 = shaTag.padEnd(64, '0').slice(0, 64);
  await db.update(contractsTable)
    .set({ status: 'sent', documentSha256: sha256, updatedAt: new Date() })
    .where(eq(contractsTable.id, contractId));

  // Read accessCode (only exposed when status = 'sent')
  const [contractRow] = await db
    .select({ accessCode: contractsTable.accessCode })
    .from(contractsTable)
    .where(eq(contractsTable.id, contractId));
  const accessCode = contractRow!.accessCode!;

  // Portal sign
  const signRes = await request(app)
    .post(`/api/portal/contract/${accessCode}/sign`)
    .send({
      customerPrintName: 'Robert A. Fixture',
      customerSignaturePath: 'acceptance-test-sig-proof',
      documentSha256: sha256,
    });
  assert(
    signRes.status === expectSignStatus,
    `Portal sign: expected ${expectSignStatus}, got ${signRes.status}: ${JSON.stringify(signRes.body).slice(0, 300)}`,
  );
  return { signStatus: signRes.status };
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

  // ── Pipeline assertion state (Deliverables 1 / 2 / 3) ─────────────────────
  // Each pin starts at the stage that autoAdvances on the given event, so the
  // real business action (not POST /events/pipeline) drives the advance.
  let userId         = '';  // stored from user creation; required by seedPipelinePin
  let pipelinePinForensic = '';  // phase2_scheduled  → phase2_complete   (forensic_record_attested)
  let pipelinePinSubmit   = '';  // package_ready     → claim_filed        (package_delivered)
  let pipelinePinCompile  = '';  // proof_package     → contract_generated (proof_package_compiled)
  let pipelinePinAttest   = '';  // phase2_complete   → package_ready      (report_attested)
  const allPipelinePinIds: string[] = [];

  // Selection hierarchy — created once before D2c; reused in D2c (retail +
  // insurance contracts) and 3b (contract sign under broken pipeline).
  let selCatId     = '';
  let selProductId = '';

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
    userId = user.id; // store for seedPipelinePin calls
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

  // ── D1 setup: create assertion pins + link inspection ─────────────────────
  //
  // Four insurance pins are created at the stage that each event auto-advances
  // FROM.  The inspection's pinId is swapped to the right pin immediately
  // before each triggering business action so the real emitter fires.
  // Setting phase='forensic' ensures emitForensicRecordAttested does not exit
  // early on the phase guard at inspections.ts:2556.
  await step('D1 setup: create 4 assertion pins + link inspection to forensic pin', async () => {
    pipelinePinForensic = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'phase2_scheduled',  allPipelinePinIds);
    pipelinePinSubmit   = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'package_ready',     allPipelinePinIds);
    pipelinePinCompile  = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'proof_package',     allPipelinePinIds);
    pipelinePinAttest   = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'phase2_complete',   allPipelinePinIds);

    // Link the fixture inspection to pipelinePinForensic and force phase='forensic'
    // so the emitForensicRecordAttested guard passes on the next attestation POST.
    await db
      .update(inspectionsTable)
      .set({ pinId: pipelinePinForensic, phase: 'forensic' })
      .where(eq(inspectionsTable.id, inspectionId));

    const before = await pinStageNow(pipelinePinForensic);
    assert(before === 'phase2_scheduled', `Pin_forensic should start at phase2_scheduled, got: ${before}`);
    process.stdout.write(`    Pin_forensic ${pipelinePinForensic.slice(-8)}: stage = ${before}\n`);
    process.stdout.write(`    Pin_submit   ${pipelinePinSubmit.slice(-8)}: stage = package_ready\n`);
    process.stdout.write(`    Pin_compile  ${pipelinePinCompile.slice(-8)}: stage = proof_package\n`);
    process.stdout.write(`    Pin_attest   ${pipelinePinAttest.slice(-8)}: stage = phase2_complete\n`);
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

    // Fence: wait for the first void emitForensicRecordAttested to complete and
    // advance pipelinePinForensic before the submit POST fires a second emitter.
    // Without this, both fire-and-forget calls race: both find the pin at
    // phase2_scheduled → advancePinStage runs twice → 2 transition rows.
    await pollPinStage(pipelinePinForensic, 'phase2_complete', 2000);

    const submit = await request(app)
      .post(`/api/inspections/${inspectionId}/attestations`)
      .set(auth(sid))
      .send({ stage: 'submit', attestationType: 'stage_signoff' });
    assert(submit.status === 201, `Submit attestation failed (${submit.status}): ${JSON.stringify(submit.body)}`);
  });

  // D1 assert: forensic_record_attested fired during the attestation step above.
  // Both attestation POSTs (declaration + submit) fire emitForensicRecordAttested;
  // the first advances the pin (phase2_scheduled → phase2_complete) and the
  // second is a no-op (pin is no longer at the matching stage), so txCount = 1.
  await step('D1 assert: forensic_record_attested (phase2_scheduled → phase2_complete)', async () => {
    const after    = await pollPinStage(pipelinePinForensic, 'phase2_complete', 2500);
    const txCount  = await stageTransitionCount(pipelinePinForensic);
    assert(after === 'phase2_complete',
      `Expected phase2_complete, got: ${after} — emitter may not be wired or phase guard failed (transitions: ${txCount})`);
    assert(txCount === 1, `Expected exactly 1 stage_transitions row, got: ${txCount}`);
    process.stdout.write(`    Pin_forensic: phase2_scheduled → ${after} (${txCount} transition row) ✓\n`);
  });

  // Swap inspection.pinId to the package_ready pin BEFORE the submission
  // route fires so the package_delivered emitter at inspections.ts:2779 fires.
  await step('D1 switch: set inspection.pinId = pipelinePinSubmit (package_ready) before field-record lock', async () => {
    await db
      .update(inspectionsTable)
      .set({ pinId: pipelinePinSubmit })
      .where(eq(inspectionsTable.id, inspectionId));
    const before = await pinStageNow(pipelinePinSubmit);
    assert(before === 'package_ready', `Pin_submit should be at package_ready before submission, got: ${before}`);
    process.stdout.write(`    Pin_submit ${pipelinePinSubmit.slice(-8)}: stage = ${before}\n`);
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

  // D1 assert: package_delivered fired during the submission step above.
  await step('D1 assert: package_delivered (package_ready → claim_filed)', async () => {
    const after   = await pollPinStage(pipelinePinSubmit, 'claim_filed', 2500);
    const txCount = await stageTransitionCount(pipelinePinSubmit);
    assert(after === 'claim_filed',
      `Expected claim_filed, got: ${after} — emitter may not be wired (transitions: ${txCount})`);
    assert(txCount === 1, `Expected exactly 1 stage_transitions row, got: ${txCount}`);
    process.stdout.write(`    Pin_submit: package_ready → ${after} (${txCount} transition row) ✓\n`);
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

  // Swap inspection.pinId to the proof_package pin BEFORE compile so the
  // proof_package_compiled emitter at inspections.ts:6069 fires.
  await step('D1 switch: set inspection.pinId = pipelinePinCompile (proof_package) before compile', async () => {
    await db
      .update(inspectionsTable)
      .set({ pinId: pipelinePinCompile })
      .where(eq(inspectionsTable.id, inspectionId));
    const before = await pinStageNow(pipelinePinCompile);
    assert(before === 'proof_package', `Pin_compile should be at proof_package before compile, got: ${before}`);
    process.stdout.write(`    Pin_compile ${pipelinePinCompile.slice(-8)}: stage = ${before}\n`);
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

  // D1 assert: proof_package_compiled fired during the compile step above.
  await step('D1 assert: proof_package_compiled (proof_package → contract_generated)', async () => {
    const after   = await pollPinStage(pipelinePinCompile, 'contract_generated', 2500);
    const txCount = await stageTransitionCount(pipelinePinCompile);
    assert(after === 'contract_generated',
      `Expected contract_generated, got: ${after} — emitter may not be wired (transitions: ${txCount})`);
    assert(txCount === 1, `Expected exactly 1 stage_transitions row, got: ${txCount}`);
    process.stdout.write(`    Pin_compile: proof_package → ${after} (${txCount} transition row) ✓\n`);
  });

  // Swap inspection.pinId to the phase2_complete pin BEFORE attestation so the
  // report_attested emitter at inspections.ts:3324 fires.
  await step('D1 switch: set inspection.pinId = pipelinePinAttest (phase2_complete) before attest', async () => {
    await db
      .update(inspectionsTable)
      .set({ pinId: pipelinePinAttest })
      .where(eq(inspectionsTable.id, inspectionId));
    const before = await pinStageNow(pipelinePinAttest);
    assert(before === 'phase2_complete', `Pin_attest should be at phase2_complete before attest, got: ${before}`);
    process.stdout.write(`    Pin_attest ${pipelinePinAttest.slice(-8)}: stage = ${before}\n`);
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

  // D1 assert: report_attested fired during the attest step above.
  await step('D1 assert: report_attested (phase2_complete → package_ready)', async () => {
    const after   = await pollPinStage(pipelinePinAttest, 'package_ready', 2500);
    const txCount = await stageTransitionCount(pipelinePinAttest);
    assert(after === 'package_ready',
      `Expected package_ready, got: ${after} — emitter may not be wired (transitions: ${txCount})`);
    assert(txCount === 1, `Expected exactly 1 stage_transitions row, got: ${txCount}`);
    process.stdout.write(`    Pin_attest: phase2_complete → ${after} (${txCount} transition row) ✓\n`);
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

  // ── DELIVERABLE 2: manual proofs for events the fixture does not reach ─────
  //
  // Each step calls the REAL BUSINESS ROUTE (not POST /events/pipeline) and
  // asserts the before → after stage transition + a single transition row.
  process.stdout.write(`\n  ── Deliverable 2: manual pipeline proofs ──\n`);

  // D2a: preliminary_record_synced (phase1_scheduled → phase1_complete)
  // Emitter: PATCH /api/inspections/:id at inspections.ts:1270
  // Guard  : parsed.data.preliminaryCompletedAt && !inspection.preliminaryCompletedAt && effectivePinId
  await step('D2a: preliminary_record_synced (phase1_scheduled → phase1_complete)', async () => {
    const pin = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'phase1_scheduled', allPipelinePinIds);
    assert((await pinStageNow(pin)) === 'phase1_scheduled', 'Pin not at phase1_scheduled');

    // Fresh minimal inspection linked to the pin
    const cr = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({ claimNumber: `VA-PRS-${RUN_ID}`, damageType: 'hail_and_wind' });
    assert(cr.status === 201, `Create inspection failed (${cr.status}): ${JSON.stringify(cr.body)}`);
    const proofInspId = cr.body.inspection.id as string;

    await db.update(inspectionsTable).set({ pinId: pin }).where(eq(inspectionsTable.id, proofInspId));

    // Real business action: PATCH with preliminaryCompletedAt (first-time set triggers emitter).
    // Gate at inspections.ts:975 uses parsed.data.roofDamageFound ?? inspection.roofDamageFound,
    // so sending roofDamageFound=true in the same PATCH satisfies the damage-surface check.
    const r = await request(app)
      .patch(`/api/inspections/${proofInspId}`)
      .set(auth(sid))
      .send({ roofDamageFound: true, preliminaryCompletedAt: new Date().toISOString() });
    assert(r.status === 200, `PATCH preliminaryCompletedAt failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);

    const after   = await pollPinStage(pin, 'phase1_complete', 2500);
    const txCount = await stageTransitionCount(pin);
    assert(after === 'phase1_complete', `Expected phase1_complete, got: ${after} (transitions: ${txCount})`);
    assert(txCount === 1, `Expected 1 transition row, got: ${txCount}`);
    process.stdout.write(`    Pin ${pin.slice(-8)}: phase1_scheduled → ${after} (${txCount} row) ✓\n`);
  });

  // D2b: fipsa_signed (phase1_complete → fipsa_signed)
  // Emitter: POST /api/inspections/:id/agreement/sign at agreement.ts:231
  // Guard  : inspection.phase === 'forensic' && inspection.pinId
  await step('D2b: fipsa_signed (phase1_complete → fipsa_signed)', async () => {
    const pin = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'phase1_complete', allPipelinePinIds);
    assert((await pinStageNow(pin)) === 'phase1_complete', 'Pin not at phase1_complete');

    const cr = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({ claimNumber: `VA-FIPSA-${RUN_ID}`, damageType: 'hail_and_wind' });
    assert(cr.status === 201, `Create inspection failed (${cr.status}): ${JSON.stringify(cr.body)}`);
    const proofInspId = cr.body.inspection.id as string;

    // Phase must be 'forensic' for the FIPSA sign gate (agreement.ts:115)
    await db.update(inspectionsTable)
      .set({ pinId: pin, phase: 'forensic' })
      .where(eq(inspectionsTable.id, proofInspId));

    // Real business action: POST /agreement/sign
    // pdfBase64 must: (a) start with %PDF magic bytes (agreement.ts:152),
    // (b) be >= 100 base64 chars (SignAgreementBody: z.string().min(100)).
    const pdfBase64 = Buffer.from('%PDF-1.4 ' + 'x'.repeat(100)).toString('base64');
    const r = await request(app)
      .post(`/api/inspections/${proofInspId}/agreement/sign`)
      .set(auth(sid))
      .send({ signerName: 'Robert A. Fixture', pdfBase64 });
    assert(r.status === 201, `FIPSA sign failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);

    const after   = await pollPinStage(pin, 'fipsa_signed', 2500);
    const txCount = await stageTransitionCount(pin);
    assert(after === 'fipsa_signed', `Expected fipsa_signed, got: ${after} (transitions: ${txCount})`);
    assert(txCount === 1, `Expected 1 transition row, got: ${txCount}`);
    process.stdout.write(`    Pin ${pin.slice(-8)}: phase1_complete → ${after} (${txCount} row) ✓\n`);
  });

  // D2c setup: seed the selection hierarchy once — reused by D2c (retail +
  // insurance sign) and 3b (contract sign under broken pipeline).
  await step('D2c setup: seed selection hierarchy (catId + productId for contract tests)', async () => {
    const [cat] = await db.insert(selectionCategoriesTable)
      .values({ companyId: COMPANY_ID, name: 'Roofing', slug: `roofing-${RUN_ID}` })
      .returning();
    const [brand] = await db.insert(selectionBrandsTable)
      .values({ companyId: COMPANY_ID, categoryId: cat!.id, name: 'TestBrand' })
      .returning();
    const [product] = await db.insert(selectionProductsTable)
      .values({ companyId: COMPANY_ID, categoryId: cat!.id, brandId: brand!.id, name: 'Test Shingle', unit: 'SQ', isBase: true })
      .returning();
    selCatId     = cat!.id;
    selProductId = product!.id;
    process.stdout.write(`    catId=${selCatId.slice(-8)} productId=${selProductId.slice(-8)}\n`);
  });

  // D2c + 3c: contract_signed via portal + cross-pipeline guard
  // Emitter: POST /api/portal/contract/:code/sign at contractPortal.ts:560
  // Guard  : outcomeRules { pipeline } must match pin.workflow
  //
  // We prove BOTH directions: sign retail contract → retail pin advances,
  // insurance pin is untouched; sign insurance contract → insurance pin advances.
  await step('D2c + 3c: contract_signed retail/insurance + cross-pipeline guard', async () => {
    const pinRetail    = await seedPipelinePin(COMPANY_ID, userId, 'retail',    'contract_pending', allPipelinePinIds);
    const pinInsurance = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'contract_pending', allPipelinePinIds);
    assert((await pinStageNow(pinRetail))    === 'contract_pending', 'Retail pin not at contract_pending');
    assert((await pinStageNow(pinInsurance)) === 'contract_pending', 'Insurance pin not at contract_pending');

    // ── Sign retail contract ────────────────────────────────────────────────
    await buildAndSignContract({
      sid, pinId: pinRetail, shaTag: 'retail-contract-sha256-acceptance-test-proof',
      catId: selCatId, productId: selProductId, companyId: COMPANY_ID,
    });

    const afterRetail          = await pollPinStage(pinRetail,    'contract_signed', 3000);
    const insuranceAfterRetail = await pinStageNow(pinInsurance);

    // 3c guard: insurance pin must NOT have moved
    assert(afterRetail === 'contract_signed',
      `Retail pin: expected contract_signed, got: ${afterRetail}`);
    assert(insuranceAfterRetail === 'contract_pending',
      `CROSS-PIPELINE VIOLATION: insurance pin moved to ${insuranceAfterRetail} when retail contract was signed`);
    process.stdout.write(`    Retail pin:    contract_pending → ${afterRetail} ✓\n`);
    process.stdout.write(`    Insurance pin (guard): still at ${insuranceAfterRetail} ✓\n`);

    // ── Sign insurance contract ─────────────────────────────────────────────
    await buildAndSignContract({
      sid, pinId: pinInsurance, shaTag: 'insurance-contract-sha256-acceptance-test-proof',
      catId: selCatId, productId: selProductId, companyId: COMPANY_ID,
    });

    const afterInsurance = await pollPinStage(pinInsurance, 'contract_signed', 3000);
    assert(afterInsurance === 'contract_signed',
      `Insurance pin: expected contract_signed, got: ${afterInsurance}`);
    process.stdout.write(`    Insurance pin: contract_pending → ${afterInsurance} ✓\n`);

    const retailTx    = await stageTransitionCount(pinRetail);
    const insuranceTx = await stageTransitionCount(pinInsurance);
    assert(retailTx === 1,    `Expected 1 transition for retail, got: ${retailTx}`);
    assert(insuranceTx === 1, `Expected 1 transition for insurance, got: ${insuranceTx}`);
  });

  // D2d: deposit_received (legacy) — ins_contract_signed → ins_deposit_received
  // Emitter: POST /api/pins/:id/payments at the payments route
  await step('D2d: deposit_received (ins_contract_signed → ins_deposit_received)', async () => {
    const pin = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'ins_contract_signed', allPipelinePinIds);
    assert((await pinStageNow(pin)) === 'ins_contract_signed', 'Pin not at ins_contract_signed');

    // Real business action: POST a deposit payment
    const r = await request(app)
      .post(`/api/pins/${pin}/payments`)
      .set(auth(sid))
      // paymentDate must be ISO 8601 datetime (z.string().datetime()), not date-only
      .send({ type: 'deposit', amountCents: 500000, paymentDate: new Date().toISOString(), note: 'Acceptance test deposit' });
    assert(r.status === 201, `Payment POST failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);

    const after   = await pollPinStage(pin, 'ins_deposit_received', 2500);
    const txCount = await stageTransitionCount(pin);
    assert(after === 'ins_deposit_received', `Expected ins_deposit_received, got: ${after} (transitions: ${txCount})`);
    assert(txCount === 1, `Expected 1 transition row, got: ${txCount}`);
    process.stdout.write(`    Pin ${pin.slice(-8)}: ins_contract_signed → ${after} (${txCount} row) ✓\n`);
  });

  // D2e: claim_approved gate — upload approved estimate, then advance
  // Gate: PATCH /leads/:id/advance-stage with toStage=claim_approved requires
  // an approved estimate on file (uploaded via POST /leads/:id/approved-estimate).
  // Emitter: none — claim_approved is outcome-only (no autoAdvance).
  await step('D2e: claim_approved gate (upload estimate → advance)', async () => {
    const pin = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'claim_review', allPipelinePinIds);
    assert((await pinStageNow(pin)) === 'claim_review', 'Pin not at claim_review');

    // (a) Advance WITHOUT estimate → must 422
    const rGate = await request(app)
      .patch(`/api/leads/${pin}/advance-stage`)
      .set(auth(sid))
      .send({ toStage: 'claim_approved', trigger: 'task' });
    assert(
      rGate.status === 422,
      `Expected 422 for advance without estimate, got ${rGate.status}: ${JSON.stringify(rGate.body).slice(0, 200)}`,
    );
    assert(
      rGate.body?.missingDocument === 'approvedEstimate',
      `Expected missingDocument='approvedEstimate', got: ${JSON.stringify(rGate.body)}`,
    );
    process.stdout.write(`    Gate (no estimate): 422 with missingDocument=approvedEstimate ✓\n`);

    // (b) Upload the fixture estimate
    const estimateBytes = Buffer.from('%PDF-1.4 carrier-estimate-fixture ' + 'x'.repeat(200));
    const pdfBase64 = estimateBytes.toString('base64');
    const rUpload = await request(app)
      .post(`/api/leads/${pin}/approved-estimate`)
      .set(auth(sid))
      .send({ pdfBase64 });
    assert(
      rUpload.status === 200,
      `Upload estimate failed (${rUpload.status}): ${JSON.stringify(rUpload.body).slice(0, 200)}`,
    );
    assert(typeof rUpload.body?.objectPath === 'string', 'No objectPath in upload response');
    assert(typeof rUpload.body?.sha256 === 'string',     'No sha256 in upload response');

    // Verify sha256 matches the content
    const { createHash } = await import('node:crypto');
    const expectedSha = createHash('sha256').update(estimateBytes).digest('hex');
    assert(
      rUpload.body.sha256 === expectedSha,
      `sha256 mismatch: expected ${expectedSha}, got ${rUpload.body.sha256}`,
    );
    process.stdout.write(`    Upload: objectPath=${rUpload.body.objectPath.slice(-16)} sha256=${rUpload.body.sha256.slice(0, 12)}… ✓\n`);

    // (c) Advance WITH estimate → must 200
    const rAdvance = await request(app)
      .patch(`/api/leads/${pin}/advance-stage`)
      .set(auth(sid))
      .send({ toStage: 'claim_approved', trigger: 'task' });
    assert(
      rAdvance.status === 200,
      `Advance to claim_approved failed (${rAdvance.status}): ${JSON.stringify(rAdvance.body).slice(0, 200)}`,
    );
    assert(
      rAdvance.body?.lead?.pipelineStage === 'claim_approved',
      `Expected pipelineStage=claim_approved, got: ${rAdvance.body?.lead?.pipelineStage}`,
    );

    const after   = await pinStageNow(pin);
    const txCount = await stageTransitionCount(pin);
    assert(after === 'claim_approved', `Expected claim_approved, got: ${after} (transitions: ${txCount})`);
    assert(txCount === 1, `Expected 1 transition row, got: ${txCount}`);
    process.stdout.write(`    Pin ${pin.slice(-8)}: claim_review → ${after} (${txCount} row) ✓\n`);
  });

  // ── DELIVERABLE 3a: IDEMPOTENCY ────────────────────────────────────────────
  // Re-trigger the same real action on a pin that has already advanced.
  // emitPipelineEvent fires again but the pin is no longer at the matching
  // stage, so no second stage_transitions row is written.
  await step('3a Idempotency: re-deposit does not double-advance (ins_contract_signed)', async () => {
    const pin = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'ins_contract_signed', allPipelinePinIds);

    // First deposit → pin advances, transitions = 1
    const r1 = await request(app)
      .post(`/api/pins/${pin}/payments`)
      .set(auth(sid))
      .send({ type: 'deposit', amountCents: 250000, paymentDate: new Date().toISOString() });
    assert(r1.status === 201, `Payment 1 failed (${r1.status})`);
    await pollPinStage(pin, 'ins_deposit_received', 2500);
    const txAfterFirst = await stageTransitionCount(pin);
    assert(txAfterFirst === 1, `Expected 1 transition after first deposit, got: ${txAfterFirst}`);

    // Second deposit on the same pin: payment route fires emitPipelineEvent again
    // (deposit_received), but the pin is now at ins_deposit_received, not ins_contract_signed.
    // processPipelineEvent finds no matching autoAdvance → no transition row added.
    const r2 = await request(app)
      .post(`/api/pins/${pin}/payments`)
      .set(auth(sid))
      .send({ type: 'deposit', amountCents: 250000, paymentDate: new Date().toISOString() });
    assert(r2.status === 201, `Payment 2 failed (${r2.status})`);
    await new Promise((r) => setTimeout(r, 600)); // give any async advance time to (not) fire

    const txAfterSecond  = await stageTransitionCount(pin);
    const stageAfterBoth = await pinStageNow(pin);
    assert(txAfterSecond === 1,
      `IDEMPOTENCY FAIL: expected 1 transition after second deposit, got: ${txAfterSecond}`);
    assert(stageAfterBoth === 'ins_deposit_received',
      `Pin moved unexpectedly to: ${stageAfterBoth}`);
    process.stdout.write(`    Before: 1 row → After re-deposit: ${txAfterSecond} row. Stage: ${stageAfterBoth} ✓\n`);
  });

  // ── DELIVERABLE 3b: FAILURE ISOLATION — real pipeline throw ────────────────
  //
  // The isolation guarantee is not "a no-match event is harmless" — it is
  // specifically that emitPipelineEvent's try/catch (pipelineEvents.ts:219-226)
  // swallows a real DB throw so the calling business route is unaffected.
  //
  // Injection: ALTER TABLE … RENAME temporarily makes stage_transitions
  // invisible.  advancePinStage's INSERT INTO stage_transitions throws a
  // PgError "relation does not exist".  emitPipelineEvent catches it and logs.
  // The rename is reversed in a finally block so later steps are unharmed.
  //
  // Three routes are exercised (each has its own void emitPipelineEvent call):
  //   - payments.ts    → deposit_received
  //   - agreement.ts   → fipsa_signed
  //   - contractPortal.ts → contract_signed
  await step('3b (revised): real pipeline throw does not eat the business action', async () => {
    // Seed all pins and the FIPSA inspection BEFORE breaking the table
    // (seedPipelinePin itself writes to pinsTable, not stage_transitions)
    const pinPay   = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'ins_contract_signed', allPipelinePinIds);
    const pinFipsa = await seedPipelinePin(COMPANY_ID, userId, 'insurance', 'phase1_complete',     allPipelinePinIds);
    const pinCo    = await seedPipelinePin(COMPANY_ID, userId, 'retail',    'contract_pending',    allPipelinePinIds);

    // FIPSA: link a fresh inspection with phase='forensic'
    const criRes = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({ claimNumber: `VA-3B-FIPSA-${RUN_ID}`, damageType: 'hail_and_wind' });
    assert(criRes.status === 201, `3b inspection create failed (${criRes.status})`);
    const b3InspId = criRes.body.inspection.id as string;
    await db.update(inspectionsTable)
      .set({ pinId: pinFipsa, phase: 'forensic' })
      .where(eq(inspectionsTable.id, b3InspId));

    // CONTRACT: build draft + scope + selection BEFORE the rename
    // (all writes go to contracts/pins tables — stage_transitions not touched)
    const coRes = await request(app)
      .post(`/api/pins/${pinCo}/contracts`)
      .set(auth(sid))
      .send({ coveredScopeCents: 1500000 });
    assert(coRes.status === 201, `3b contract create failed (${coRes.status})`);
    const b3ContractId = coRes.body.contract.id as string;

    const pkgRes = await request(app)
      .post(`/api/contracts/${b3ContractId}/scope-packages`)
      .set(auth(sid))
      .send({ categoryId: selCatId, quantity: 20, unit: 'SQ', coveredAmountCents: 1500000, sortOrder: 1 });
    assert(pkgRes.status === 201, `3b scope package failed (${pkgRes.status})`);
    await db.insert(contractSelectionsTable).values({
      companyId: COMPANY_ID, contractId: b3ContractId,
      scopePackageId: pkgRes.body.scopePackage.id as string, productId: selProductId,
      productName: 'Test Shingle', brandName: 'TestBrand',
      unitDeltaCents: 0, quantity: '20', extendedDeltaCents: 0, selectedBy: 'customer',
    });
    const b3Sha256 = '3b-failure-isolation-sha256'.padEnd(64, '0').slice(0, 64);
    await db.update(contractsTable)
      .set({ status: 'sent', documentSha256: b3Sha256, updatedAt: new Date() })
      .where(eq(contractsTable.id, b3ContractId));
    const [b3Row] = await db
      .select({ accessCode: contractsTable.accessCode })
      .from(contractsTable)
      .where(eq(contractsTable.id, b3ContractId));
    const b3AccessCode = b3Row!.accessCode!;

    // ── Inject real failure: rename stage_transitions ───────────────────────
    // Clean up any leftover from a prior interrupted run (idempotent guard).
    await db.execute(sql`DROP TABLE IF EXISTS stage_transitions_broken_3b`);
    await db.execute(sql`ALTER TABLE stage_transitions RENAME TO stage_transitions_broken_3b`);

    try {
      // PAYMENT — emitter fires deposit_received → advancePinStage INSERT throws
      const rPay = await request(app)
        .post(`/api/pins/${pinPay}/payments`)
        .set(auth(sid))
        .send({ type: 'deposit', amountCents: 100000, paymentDate: new Date().toISOString() });
      assert(rPay.status === 201,
        `Payment should save even when pipeline throws (${rPay.status}): ${JSON.stringify(rPay.body).slice(0, 200)}`);
      process.stdout.write(`    Payment   (payments.ts → deposit_received):     201 ✓\n`);

      // FIPSA SIGN — emitter fires fipsa_signed → advancePinStage INSERT throws
      const pdfBase64 = Buffer.from('%PDF-1.4 ' + 'x'.repeat(100)).toString('base64');
      const rFipsa = await request(app)
        .post(`/api/inspections/${b3InspId}/agreement/sign`)
        .set(auth(sid))
        .send({ signerName: 'Robert A. Fixture', pdfBase64 });
      assert(rFipsa.status === 201,
        `FIPSA should sign even when pipeline throws (${rFipsa.status}): ${JSON.stringify(rFipsa.body).slice(0, 200)}`);
      process.stdout.write(`    FIPSA     (agreement.ts → fipsa_signed):         201 ✓\n`);

      // CONTRACT SIGN — emitter fires contract_signed → advancePinStage INSERT throws
      const rSign = await request(app)
        .post(`/api/portal/contract/${b3AccessCode}/sign`)
        .send({
          customerPrintName:     'Robert A. Fixture',
          customerSignaturePath: 'acceptance-test-sig-proof',
          documentSha256:        b3Sha256,
        });
      assert(rSign.status === 200,
        `Contract should sign even when pipeline throws (${rSign.status}): ${JSON.stringify(rSign.body).slice(0, 200)}`);
      process.stdout.write(`    Contract  (contractPortal.ts → contract_signed): 200 ✓\n`);

      // Give all three void emitPipelineEvent calls time to try, fail, and be caught
      await new Promise((r) => setTimeout(r, 900));

      // Verify NO pin stage changed: advancePinStage runs INSERT + pin UPDATE in
      // one transaction — if INSERT fails, pin UPDATE also rolls back.
      const stagePayAfter   = await pinStageNow(pinPay);
      const stageFipsaAfter = await pinStageNow(pinFipsa);
      const stageCoAfter    = await pinStageNow(pinCo);
      assert(stagePayAfter   === 'ins_contract_signed',
        `Pay pin should stay at ins_contract_signed (tx rolled back), got: ${stagePayAfter}`);
      assert(stageFipsaAfter === 'phase1_complete',
        `FIPSA pin should stay at phase1_complete (tx rolled back), got: ${stageFipsaAfter}`);
      assert(stageCoAfter    === 'contract_pending',
        `Contract pin should stay at contract_pending (tx rolled back), got: ${stageCoAfter}`);
      process.stdout.write(`    Pin stages unchanged: pay=${stagePayAfter} fipsa=${stageFipsaAfter} co=${stageCoAfter} ✓\n`);
    } finally {
      await db.execute(sql`ALTER TABLE stage_transitions_broken_3b RENAME TO stage_transitions`);
      process.stdout.write(`    stage_transitions restored ✓\n`);
    }

    // After restore: zero transition rows for all three pins (DB throw rolled back the insert)
    const txPay   = await stageTransitionCount(pinPay);
    const txFipsa = await stageTransitionCount(pinFipsa);
    const txCo    = await stageTransitionCount(pinCo);
    assert(txPay   === 0, `Expected 0 transitions for payment pin, got: ${txPay}`);
    assert(txFipsa === 0, `Expected 0 transitions for FIPSA pin, got: ${txFipsa}`);
    assert(txCo    === 0, `Expected 0 transitions for contract pin, got: ${txCo}`);
    process.stdout.write(`    Transition rows (all 0): pay=${txPay} fipsa=${txFipsa} co=${txCo} ✓\n`);
    process.stdout.write(`    emitPipelineEvent try/catch (pipelineEvents.ts:224) verified: ` +
      `real DB throw does not propagate to caller ✓\n`);
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
