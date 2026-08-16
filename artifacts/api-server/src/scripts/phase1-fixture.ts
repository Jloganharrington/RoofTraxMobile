/**
 * Phase 1 Fixture — Two Tenants, Ten Users, Three Leads
 *
 * Creates ZZTEST_ namespaced data for conformance testing.
 * Run teardown with: psql $DATABASE_URL -f scripts/zztest-teardown.sql
 *
 * Creation method per entity:
 *   Companies:       direct DB insert (POST /companies requires super_admin auth we can't bootstrap)
 *   Users:           direct DB insert (no user-create API endpoint — OIDC-only)
 *   User profiles:   direct DB insert (same reason)
 *   Sessions:        direct DB insert via createSession() (OIDC-only)
 *   Leads (pins):    real API via POST /pins (endpoint exists, used for each rep)
 */

import request from 'supertest';
import app from '../app';
import { db, companiesTable, usersTable, userProfilesTable } from '@workspace/db';
import { createSession } from '../lib/auth';
import { eq } from 'drizzle-orm';

// ── Constants ─────────────────────────────────────────────────────────────

const ALPHA_ID   = 'ZZTEST_ALPHA';
const ALPHA_NAME = 'ZZTEST_Alpha Roofing Co';
const BRAVO_ID   = 'ZZTEST_BRAVO';
const BRAVO_NAME = 'ZZTEST_Bravo Contractors';

// Location in a real US city for geocode-plausible coordinates
const TEST_LAT  = 38.8977;  // Washington DC area
const TEST_LON  = -77.0366;

// ── Step helper ───────────────────────────────────────────────────────────

let stepIdx = 0;
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  stepIdx++;
  try {
    const result = await fn();
    console.log(`  ✓ [${stepIdx}] ${label}`);
    return result;
  } catch (e: any) {
    console.error(`  ✗ [${stepIdx}] ${label}: ${e.message}`);
    throw e;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════');
  console.log('  PHASE 1 FIXTURE');
  console.log('══════════════════════════════════════\n');

  // ── COMPANIES ──────────────────────────────────────────────────────────
  const [alphaCompany] = await step('Create ZZTEST_Alpha company', async () => {
    return db.insert(companiesTable).values({
      id:   ALPHA_ID,
      name: ALPHA_NAME,
    }).returning();
  });

  const [bravoCompany] = await step('Create ZZTEST_Bravo company', async () => {
    return db.insert(companiesTable).values({
      id:   BRAVO_ID,
      name: BRAVO_NAME,
    }).returning();
  });

  // ── USERS ─────────────────────────────────────────────────────────────
  // workflowAssignment values match WORKFLOW_ASSIGNMENTS enum in @workspace/authz
  const userDefs = [
    // Alpha users
    { handle: 'A-CANV-1', companyId: ALPHA_ID, email: 'a-canv-1@zztest.local',    firstName: 'Alpha', lastName: 'Canv1',  role: 'field_rep',   dept: 'canvasser',             workflowAssignment: 'retail' },
    { handle: 'A-CANV-2', companyId: ALPHA_ID, email: 'a-canv-2@zztest.local',    firstName: 'Alpha', lastName: 'Canv2',  role: 'field_rep',   dept: 'canvasser',             workflowAssignment: 'retail' },
    { handle: 'A-CANV-INS',  companyId: ALPHA_ID, email: 'a-canv-ins@zztest.local',  firstName: 'Alpha', lastName: 'CanvIns',  role: 'field_rep', dept: 'canvasser',           workflowAssignment: 'insurance' },
    { handle: 'A-CANV-BOTH', companyId: ALPHA_ID, email: 'a-canv-both@zztest.local', firstName: 'Alpha', lastName: 'CanvBoth', role: 'field_rep', dept: 'canvasser',           workflowAssignment: 'insurance_retail' },
    { handle: 'A-INSP-1', companyId: ALPHA_ID, email: 'a-insp-1@zztest.local',    firstName: 'Alpha', lastName: 'Insp1',  role: 'field_rep',   dept: 'inspector_canvasser',   workflowAssignment: 'insurance_retail' },
    { handle: 'A-OFF-1',  companyId: ALPHA_ID, email: 'a-off-1@zztest.local',     firstName: 'Alpha', lastName: 'Off1',   role: 'field_rep',   dept: 'office',                workflowAssignment: 'retail' },
    { handle: 'A-MGR-F',  companyId: ALPHA_ID, email: 'a-mgr-f@zztest.local',     firstName: 'Alpha', lastName: 'MgrF',   role: 'manager',     dept: 'inspector_canvasser',   workflowAssignment: 'insurance_retail' },
    { handle: 'A-MGR-O',  companyId: ALPHA_ID, email: 'a-mgr-o@zztest.local',     firstName: 'Alpha', lastName: 'MgrO',   role: 'manager',     dept: 'office',                workflowAssignment: 'retail' },
    { handle: 'A-ADMIN',  companyId: ALPHA_ID, email: 'a-admin@zztest.local',     firstName: 'Alpha', lastName: 'Admin',  role: 'admin',       dept: 'office',                workflowAssignment: 'insurance_retail' },
    { handle: 'A-SUPER',  companyId: ALPHA_ID, email: 'a-super@zztest.local',     firstName: 'Alpha', lastName: 'Super',  role: 'super_admin', dept: 'office',                workflowAssignment: 'insurance_retail' },
    // Bravo users
    { handle: 'B-ADMIN',  companyId: BRAVO_ID, email: 'b-admin@zztest.local',     firstName: 'Bravo', lastName: 'Admin',  role: 'admin',       dept: 'office',                workflowAssignment: 'insurance_retail' },
    { handle: 'B-REP',    companyId: BRAVO_ID, email: 'b-rep@zztest.local',       firstName: 'Bravo', lastName: 'Rep',    role: 'field_rep',   dept: 'canvasser',             workflowAssignment: 'retail' },
  ];

  type UserRecord = { id: string; email: string; companyId: string; handle: string };
  const users: Record<string, UserRecord> = {};
  const sessions: Record<string, string> = {};

  for (const u of userDefs) {
    const [user] = await step(`Create user ${u.handle}`, async () => {
      return db.insert(usersTable).values({
        email:     u.email,
        firstName: u.firstName,
        lastName:  u.lastName,
        companyId: u.companyId,
      }).returning();
    });

    await step(`Create profile for ${u.handle}`, async () => {
      return db.insert(userProfilesTable).values({
        userId:             user.id,
        role:               u.role as any,
        department:         u.dept as any,
        workflowAssignment: u.workflowAssignment as any,
      });
    });

    const sid = await step(`Mint session for ${u.handle}`, async () => {
      return createSession({
        user: {
          id:              user.id,
          email:           u.email,           // use the known-non-null literal
          firstName:       u.firstName,
          lastName:        u.lastName,
          profileImageUrl: null,
          companyId:       u.companyId,
        },
        access_token: `zztest-token-${u.handle.toLowerCase()}`,
      });
    });

    users[u.handle]   = { id: user.id, email: u.email, companyId: u.companyId, handle: u.handle };
    sessions[u.handle] = sid;
  }

  // Helper: auth header for a handle
  const auth = (handle: string) => ({ Authorization: `Bearer ${sessions[handle]}` });

  // ── VERIFY AUTH — one GET /auth/user per user ──────────────────────────
  console.log('\n── Auth token verification ──');
  for (const u of userDefs) {
    const r = await step(`GET /auth/user as ${u.handle}`, async () => {
      const res = await request(app)
        .get('/api/auth/user')
        .set(auth(u.handle));
      if (res.status !== 200) throw new Error(`Expected 200 got ${res.status}: ${JSON.stringify(res.body)}`);
      if (res.body.user?.id !== users[u.handle].id) throw new Error(`User ID mismatch: ${res.body.user?.id}`);
      return res.body;
    });
  }

  // ── LEADS ──────────────────────────────────────────────────────────────
  console.log('\n── Lead creation ──');

  // Lead 1: retail, owned by A-CANV-1
  const retailPinRes = await step('Create retail lead (A-CANV-1)', async () => {
    const res = await request(app)
      .post('/api/pins')
      .set(auth('A-CANV-1'))
      .send({
        latitude:  TEST_LAT,
        longitude: TEST_LON,
        address:   '1600 Pennsylvania Ave NW, Washington, DC 20500',
        workflow:  'retail',
        customerName: 'ZZTEST Retail Homeowner',
        ownerFirstName: 'Retail',
        ownerLastName:  'Homeowner',
        ownerEmail:     'retail-owner@zztest.local',
        doorKnockResult: 'appointment',
      });
    if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  });
  const retailPinId = retailPinRes.pin?.id ?? retailPinRes.id;

  // Lead 2: insurance, owned by A-INSP-1
  const insurancePinRes = await step('Create insurance lead (A-INSP-1)', async () => {
    const res = await request(app)
      .post('/api/pins')
      .set(auth('A-INSP-1'))
      .send({
        latitude:  TEST_LAT + 0.01,
        longitude: TEST_LON + 0.01,
        address:   '1400 Independence Ave SW, Washington, DC 20228',
        workflow:  'insurance',
        customerName:   'ZZTEST Insurance Homeowner',
        ownerFirstName: 'Insurance',
        ownerLastName:  'Homeowner',
        ownerEmail:     'ins-owner@zztest.local',
        doorKnockResult: 'appointment',
        damageType: 'wind_hail',
      });
    if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  });
  const insurancePinId = insurancePinRes.pin?.id ?? insurancePinRes.id;

  // Lead 3: Bravo company, owned by B-REP
  const bravoPinRes = await step('Create Bravo lead (B-REP)', async () => {
    const res = await request(app)
      .post('/api/pins')
      .set(auth('B-REP'))
      .send({
        latitude:  TEST_LAT + 0.02,
        longitude: TEST_LON + 0.02,
        address:   '200 Constitution Ave NW, Washington, DC 20001',
        workflow:  'retail',
        customerName:   'ZZTEST Bravo Homeowner',
        ownerFirstName: 'Bravo',
        ownerLastName:  'Homeowner',
        ownerEmail:     'bravo-owner@zztest.local',
        doorKnockResult: 'appointment',
      });
    if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  });
  const bravoPinId = bravoPinRes.pin?.id ?? bravoPinRes.id;

  // ── FINAL SUMMARY ─────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  PHASE 1 RESULTS');
  console.log('══════════════════════════════════════');
  console.log('\n■ COMPANIES');
  console.log(`  ZZTEST_Alpha: id="${alphaCompany.id}" name="${alphaCompany.name}"`);
  console.log(`  ZZTEST_Bravo: id="${bravoCompany.id}" name="${bravoCompany.name}"`);

  console.log('\n■ USERS + SESSIONS');
  for (const u of userDefs) {
    const rec = users[u.handle];
    console.log(`  ${u.handle.padEnd(10)} id=${rec.id}  email=${rec.email}  session=${sessions[u.handle]}`);
  }

  console.log('\n■ PINS');
  console.log(`  retailPinId:    ${retailPinId}`);
  console.log(`  insurancePinId: ${insurancePinId}`);
  console.log(`  bravoPinId:     ${bravoPinId}`);

  // Three pre-existing non-test company IDs to probe in Phase 3.1
  const preExisting = await db
    .select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, companiesTable.id))  // any row
    .limit(10);
  const realCos = preExisting.filter(c => !c.id.startsWith('ZZTEST') && !c.id.startsWith('TEST-')).slice(0, 3);
  console.log('\n■ PRE-EXISTING COMPANIES FOR PHASE 3.1 CROSS-TENANT PROBES (read-only):');
  realCos.forEach(c => console.log(`  id="${c.id}" name="${c.name}"`));

  console.log('\n══════════════════════════════════════');
  console.log(`  PASSED: ${stepIdx} steps`);
  console.log('══════════════════════════════════════\n');

  process.exit(0);
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
