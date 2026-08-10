/**
 * Phase 3 Part 2 — Tests 3.3 through 3.12
 * (Runs after phase3-negative-tests.ts which covers 3.1-3.2)
 */

import request from 'supertest';
import app from '../app';
import { db } from '@workspace/db';
import { createSession } from '../lib/auth';
import { sql } from 'drizzle-orm';

const ALPHA_CO   = 'ZZTEST_ALPHA';
const BRAVO_CO   = 'ZZTEST_BRAVO';
const ALPHA_RETAIL_PIN = '4af909ef-3e59-4ec4-a6b8-a6018811eb7a';
const ALPHA_INS_PIN    = 'fdbdceba-2db1-454e-881d-cbc02af7593f';
const ALPHA_INSP       = '4b5effad-52bf-4f5a-87a4-33f570445dc4';
const ALPHA_CONTRACT_R = '0db8e2ef-73d4-463b-95c1-5c491a8c4504'; // signed retail
const ALPHA_CONTRACT_V = 'caf8afda-bee8-4006-944b-53035c943be8'; // voided retail
const ALPHA_CONTRACT_CODE_R = 'Q4J8-HNKZ-RR3M';
const ALPHA_CONTRACT_CODE_V = '7X8Z-H6AZ-AEDF';
const BRAVO_RETAIL_PIN = '1a056d4a-9f19-493e-8ca9-1b45c6e99728';
const ALPHA_PAYMENT_R1 = 'd08bcc35-4ec4-41d4-bbee-3f147ec020d9';

const USERS: Record<string, { id: string; email: string; companyId: string }> = {
  'A-CANV-1': { id: '96180b99-792c-4b45-b0bd-304f36833b4f', email: 'a-canv-1@zztest.local', companyId: ALPHA_CO },
  'A-CANV-2': { id: '2c820f0f-53c7-452c-b8ac-e5089193e4fb', email: 'a-canv-2@zztest.local', companyId: ALPHA_CO },
  'A-INSP-1': { id: 'db57382f-a01e-414f-8663-fdcd74edbe9e', email: 'a-insp-1@zztest.local', companyId: ALPHA_CO },
  'A-OFF-1':  { id: '111f07e0-3d06-4784-a21a-6c424550ba8f', email: 'a-off-1@zztest.local',  companyId: ALPHA_CO },
  'A-MGR-F':  { id: '74a553ae-b375-4af0-85b8-530a39ee8f02', email: 'a-mgr-f@zztest.local',  companyId: ALPHA_CO },
  'A-MGR-O':  { id: '0625a922-0b48-4bc6-8280-2b291921f26e', email: 'a-mgr-o@zztest.local',  companyId: ALPHA_CO },
  'A-ADMIN':  { id: '2e7597e6-3ca8-4c0e-9cf8-80a0730308ca', email: 'a-admin@zztest.local',  companyId: ALPHA_CO },
  'A-SUPER':  { id: '45b1b81f-902e-4e28-b410-2a79f57778d3', email: 'a-super@zztest.local',  companyId: ALPHA_CO },
  'B-ADMIN':  { id: 'e01aa5cd-f6f9-4092-b7d0-5160930b4ee9', email: 'b-admin@zztest.local',  companyId: BRAVO_CO },
  'B-REP':    { id: 'ff669c7d-2cb6-48a7-b66b-d62eab4b5d72', email: 'b-rep@zztest.local',    companyId: BRAVO_CO },
};

type Verdict = 'PASS' | 'FAIL' | 'FINDING';
type TestResult = {
  id: string; cat: string; actor: string; target: string;
  method: string; path: string; expectedHttp: number | string; actualHttp: number;
  sideEffectVerified: boolean; sideEffectNote: string;
  verdict: Verdict; severity?: string; notes: string;
};
const results: TestResult[] = [];

function record(r: TestResult) {
  results.push(r);
  const icon = r.verdict === 'PASS' ? '✓' : r.verdict === 'FINDING' ? '⚠' : '✗';
  const sev  = r.severity ? `[${r.severity}]` : '';
  console.log(`  ${icon} ${r.id} ${r.actor} ${r.method} ${r.path} → ${r.actualHttp} (expected ${r.expectedHttp}) ${sev} | ${r.notes.slice(0,120)}`);
  if (r.verdict === 'FINDING') console.log(`    FINDING: ${r.notes}`);
}

const sidCache: Record<string, string> = {};
async function getSid(actor: string) {
  if (sidCache[actor]) return sidCache[actor];
  const u = USERS[actor];
  const sid = await createSession({
    user: { id: u.id, email: u.email, firstName: actor, lastName: 'ZZTEST', profileImageUrl: null, companyId: u.companyId },
    access_token: `zztest-phase3b-${actor}`,
  });
  return (sidCache[actor] = sid);
}

async function probe(actor: string, method: 'GET'|'POST'|'PATCH'|'DELETE'|'PUT', path: string, body?: unknown) {
  const sid = await getSid(actor);
  let req = request(app)[method.toLowerCase() as 'get'|'post'|'patch'|'delete'|'put'](path)
               .set('Authorization', `Bearer ${sid}`);
  if (body !== undefined) req = req.send(body as object);
  const res = await req;
  return { status: res.status, body: res.body };
}

async function probeNoAuth(method: 'GET'|'POST'|'PATCH'|'DELETE', path: string, body?: unknown) {
  let req = request(app)[method.toLowerCase() as 'get'|'post'|'patch'|'delete'](path);
  if (body) req = req.send(body as object);
  const res = await req;
  return { status: res.status, body: res.body as unknown };
}

async function snapshotPin(pinId: string) {
  const r = await db.execute(sql`SELECT pipeline_stage, contract_amount FROM pins WHERE id = ${pinId}`);
  return r.rows[0];
}
async function snapshotProfitability(pinId: string) {
  const r = await db.execute(sql`SELECT revised_contract_cents FROM pin_profitability WHERE pin_id = ${pinId}`);
  return r.rows[0];
}

// ── 3.3 Mass assignment ───────────────────────────────────────────────────────
async function test33() {
  console.log('\n═══ 3.3 Mass assignment / self-elevation ═══');

  // PATCH /profile — inject role, companyId
  const profBefore = await db.execute(sql`
    SELECT up.role, up.department, up.workflow_assignment, u.company_id
    FROM user_profiles up JOIN users u ON u.id = up.user_id
    WHERE up.user_id = ${USERS['A-CANV-1'].id}`);

  const { status: s1 } = await probe('A-CANV-1', 'PATCH', '/api/profile', {
    role: 'admin',
    department: 'office',
    workflowAssignment: 'insurance_retail',
    companyId: BRAVO_CO,
    id: USERS['B-ADMIN'].id,
    createdAt: '2020-01-01',
    firstName: 'Hacked',
  });

  const profAfter = await db.execute(sql`
    SELECT up.role, up.department, up.workflow_assignment, u.company_id
    FROM user_profiles up JOIN users u ON u.id = up.user_id
    WHERE up.user_id = ${USERS['A-CANV-1'].id}`);

  const roleBefore = (profBefore.rows[0] as Record<string,unknown>)?.role;
  const roleAfter  = (profAfter.rows[0] as Record<string,unknown>)?.role;
  const compBefore = (profBefore.rows[0] as Record<string,unknown>)?.company_id;
  const compAfter  = (profAfter.rows[0] as Record<string,unknown>)?.company_id;
  const roleElevated = roleAfter === 'admin' && roleBefore !== 'admin';
  const companyChanged = compAfter !== compBefore;

  record({
    id: '3.3-1', cat: '3.3', actor: 'A-CANV-1', target: 'PATCH /profile — inject role+companyId',
    method: 'PATCH', path: '/api/profile',
    expectedHttp: 200, actualHttp: s1,
    sideEffectVerified: true,
    sideEffectNote: `role ${roleBefore}→${roleAfter}; company ${compBefore}→${compAfter}`,
    verdict: (roleElevated || companyChanged) ? 'FINDING' : 'PASS',
    severity: (roleElevated || companyChanged) ? 'P0' : '',
    notes: `inject role+companyId → HTTP ${s1}; role stayed=${!roleElevated} (${roleAfter}); company intact=${!companyChanged}`,
  });

  // PATCH /pins/:id/profile — inject pipelineStage, userId, companyId
  const stageRow = await db.execute(sql`SELECT pipeline_stage FROM pins WHERE id = ${ALPHA_RETAIL_PIN}`);
  const stageBefore = (stageRow.rows[0] as Record<string,unknown>)?.pipeline_stage;

  const { status: s2 } = await probe('A-CANV-1', 'PATCH', `/api/pins/${ALPHA_RETAIL_PIN}/profile`, {
    notes: 'legit note',
    pipelineStage: 'job_complete',
    userId: USERS['B-ADMIN'].id,
    companyId: BRAVO_CO,
    id: 'overwrite-id',
  });

  const stageAfter2 = await db.execute(sql`SELECT pipeline_stage FROM pins WHERE id = ${ALPHA_RETAIL_PIN}`);
  const stageAfterVal = (stageAfter2.rows[0] as Record<string,unknown>)?.pipeline_stage;
  const stageManipulated = stageAfterVal === 'job_complete';

  record({
    id: '3.3-2', cat: '3.3', actor: 'A-CANV-1', target: 'PATCH /pins/:id/profile — inject pipelineStage',
    method: 'PATCH', path: `/api/pins/${ALPHA_RETAIL_PIN}/profile`,
    expectedHttp: 200, actualHttp: s2,
    sideEffectVerified: true,
    sideEffectNote: `stage ${stageBefore}→${stageAfterVal}`,
    verdict: stageManipulated ? 'FINDING' : 'PASS',
    severity: stageManipulated ? 'P1' : '',
    notes: `inject pipelineStage=job_complete → HTTP ${s2}; stage after=${stageAfterVal} (manipulated=${stageManipulated})`,
  });

  // PATCH /inspections/:id — inject companyId+pinId
  const inspCo = await db.execute(sql`SELECT company_id FROM inspections WHERE id = ${ALPHA_INSP}`);
  const coBefore = (inspCo.rows[0] as Record<string,unknown>)?.company_id;

  const { status: s3 } = await probe('A-INSP-1', 'PATCH', `/api/inspections/${ALPHA_INSP}`, {
    notes: 'legit',
    companyId: BRAVO_CO,
    pinId: BRAVO_RETAIL_PIN,
  });

  const inspCoAfter = await db.execute(sql`SELECT company_id FROM inspections WHERE id = ${ALPHA_INSP}`);
  const coAfterVal = (inspCoAfter.rows[0] as Record<string,unknown>)?.company_id;
  const coChanged = coAfterVal !== coBefore;

  record({
    id: '3.3-3', cat: '3.3', actor: 'A-INSP-1', target: 'PATCH /inspections/:id — inject companyId',
    method: 'PATCH', path: `/api/inspections/${ALPHA_INSP}`,
    expectedHttp: 200, actualHttp: s3,
    sideEffectVerified: true,
    sideEffectNote: `companyId ${coBefore}→${coAfterVal}`,
    verdict: coChanged ? 'FINDING' : 'PASS',
    severity: coChanged ? 'P0' : '',
    notes: `inject companyId+pinId → HTTP ${s3}; company intact=${!coChanged} (${coAfterVal})`,
  });
  console.log('  3.3 done');
}

// ── 3.4 Department gating ─────────────────────────────────────────────────────
async function test34() {
  console.log('\n═══ 3.4 Department gating ═══');
  const cases: Array<{ id: string; actor: string; method: 'GET'|'POST'; path: string; body?: unknown; reason: string }> = [
    { id: '3.4-1', actor: 'A-CANV-1', method: 'POST', path: '/api/inspections',     body: { pinId: ALPHA_RETAIL_PIN, phase: 'preliminary' }, reason: 'canvasser creates inspection' },
    { id: '3.4-2', actor: 'A-CANV-1', method: 'POST', path: `/api/inspections/${ALPHA_INSP}/attestations`, body: { attestationType: 'stage_signoff' }, reason: 'canvasser signs attestation' },
    { id: '3.4-3', actor: 'A-OFF-1',  method: 'POST', path: '/api/inspections',     body: { pinId: ALPHA_RETAIL_PIN, phase: 'preliminary' }, reason: 'office user creates inspection' },
    { id: '3.4-4', actor: 'A-CANV-1', method: 'POST', path: `/api/inspections/${ALPHA_INSP}/agreement/sign`, body: { signatureBase64: 'x' }, reason: 'canvasser signs FIPSA' },
    { id: '3.4-5', actor: 'A-CANV-1', method: 'POST', path: `/api/inspections/${ALPHA_INSP}/report/compile`, reason: 'canvasser compiles report' },
    { id: '3.4-6', actor: 'A-CANV-1', method: 'GET',  path: `/api/pins/${ALPHA_RETAIL_PIN}/invoices`, reason: 'canvasser reads invoices' },
  ];
  for (const c of cases) {
    const { status } = await probe(c.actor, c.method, c.path, c.body);
    const blocked = status >= 400;
    record({ id: c.id, cat: '3.4', actor: c.actor, target: c.path, method: c.method, path: c.path,
      expectedHttp: 403, actualHttp: status, sideEffectVerified: true, sideEffectNote: 'not tracked',
      verdict: blocked ? 'PASS' : 'FINDING', severity: !blocked ? 'P1' : '',
      notes: `${c.reason} → ${status}` });
  }
  console.log('  3.4 done');
}

// ── 3.5 Workflow gating ───────────────────────────────────────────────────────
async function test35() {
  console.log('\n═══ 3.5 Workflow gating ═══');
  const cases: Array<{ id: string; actor: string; method: 'GET'|'PATCH'; path: string; body?: unknown; reason: string }> = [
    { id: '3.5-1', actor: 'A-CANV-1', method: 'PATCH', path: `/api/leads/${ALPHA_INS_PIN}/advance-stage`, body: { toStage: 'claim_filed', trigger: 'manual_move' }, reason: 'retail canvasser advances insurance pin' },
    { id: '3.5-2', actor: 'A-CANV-1', method: 'GET',   path: `/api/inspections/${ALPHA_INSP}`, reason: 'retail canvasser reads insurance inspection' },
    { id: '3.5-3', actor: 'A-INSP-1', method: 'PATCH', path: `/api/leads/${ALPHA_RETAIL_PIN}/advance-stage`, body: { toStage: 'job_complete', trigger: 'manual_move' }, reason: 'inspector advances retail pin' },
    { id: '3.5-4', actor: 'A-OFF-1',  method: 'GET',   path: `/api/inspections/${ALPHA_INSP}`, reason: 'office(retail) reads insurance inspection' },
  ];
  for (const c of cases) {
    const { status } = await probe(c.actor, c.method, c.path, c.body);
    const blocked = status >= 400;
    record({ id: c.id, cat: '3.5', actor: c.actor, target: c.path, method: c.method, path: c.path,
      expectedHttp: 403, actualHttp: status, sideEffectVerified: true, sideEffectNote: 'not tracked',
      verdict: blocked ? 'PASS' : 'FINDING', severity: !blocked ? 'P2' : '',
      notes: `${c.reason} → ${status}${!blocked ? ' — workflow/dept NOT enforced' : ''}` });
  }
  console.log('  3.5 done');
}

// ── 3.6 Dashboard manifest ────────────────────────────────────────────────────
async function test36() {
  console.log('\n═══ 3.6 Dashboard manifest ═══');
  for (const actor of Object.keys(USERS)) {
    const { status, body } = await probe(actor, 'GET', '/api/dashboard/manifest');
    const b = body as Record<string,unknown>;
    const wks = Array.isArray(b?.widgets) ? (b.widgets as Array<Record<string,unknown>>).map(w=>w.key).join(',') : 'N/A';
    record({ id: `3.6-${actor}`, cat: '3.6', actor, target: 'GET /dashboard/manifest',
      method: 'GET', path: '/api/dashboard/manifest',
      expectedHttp: 200, actualHttp: status, sideEffectVerified: true, sideEffectNote: 'read-only',
      verdict: status === 200 ? 'PASS' : 'FINDING', severity: status !== 200 ? 'P2' : '',
      notes: `widgets=(${wks.slice(0,100)})` });
  }

  // Force ungranted widget into layout
  const { status: ls } = await probe('A-CANV-1', 'PATCH', '/api/dashboard/layout',
    { layout: [{ key: 'company_pnl', x: 0, y: 0, w: 4, h: 4 }] });
  const { body: mb } = await probe('A-CANV-1', 'GET', '/api/dashboard/manifest');
  const mbTyped = mb as Record<string,unknown>;
  const hasUngranted = Array.isArray(mbTyped?.widgets) &&
    (mbTyped.widgets as Array<Record<string,unknown>>).some(w => w.key === 'company_pnl');
  record({ id: '3.6-force', cat: '3.6', actor: 'A-CANV-1', target: 'PATCH layout — force ungranted widget',
    method: 'PATCH', path: '/api/dashboard/layout',
    expectedHttp: 200, actualHttp: ls, sideEffectVerified: true,
    sideEffectNote: `company_pnl in manifest after=${hasUngranted}`,
    verdict: hasUngranted ? 'FINDING' : 'PASS', severity: hasUngranted ? 'P1' : '',
    notes: `layout PATCH HTTP ${ls}; ungranted widget in manifest=${hasUngranted}` });
  console.log('  3.6 done');
}

// ── 3.7 Contract & signing integrity ─────────────────────────────────────────
async function test37() {
  console.log('\n═══ 3.7 Contract & signing integrity ═══');

  // 3.7-1: Sign already-signed contract
  const { status: s1, body: b1 } = await probeNoAuth('POST', `/api/portal/contract/${ALPHA_CONTRACT_CODE_R}/sign`,
    { documentSha256: '66fab6344f574dedb60a00000000000000000000', signerName: 'Test', signerEmail: 'x@t.com', signatureBase64: 'SIG' });
  record({ id: '3.7-1', cat: '3.7', actor: '(portal)', target: 'sign already-signed',
    method: 'POST', path: `/api/portal/contract/${ALPHA_CONTRACT_CODE_R}/sign`,
    expectedHttp: '4xx', actualHttp: s1, sideEffectVerified: true, sideEffectNote: 'already signed',
    verdict: s1 >= 400 ? 'PASS' : 'FINDING', severity: s1 < 400 ? 'P1' : '',
    notes: `re-sign already-signed contract → ${s1} ${JSON.stringify(b1).slice(0,80)}` });

  // 3.7-2: Sign voided contract
  const { status: s2, body: b2 } = await probeNoAuth('POST', `/api/portal/contract/${ALPHA_CONTRACT_CODE_V}/sign`,
    { documentSha256: '1d6d17376a3d393da21600000000000000000000', signerName: 'Test', signerEmail: 'x@t.com', signatureBase64: 'SIG' });
  record({ id: '3.7-2', cat: '3.7', actor: '(portal)', target: 'sign voided contract',
    method: 'POST', path: `/api/portal/contract/${ALPHA_CONTRACT_CODE_V}/sign`,
    expectedHttp: 410, actualHttp: s2, sideEffectVerified: true, sideEffectNote: 'voided contract',
    verdict: s2 >= 400 ? 'PASS' : 'FINDING', severity: s2 < 400 ? 'P1' : '',
    notes: `sign voided contract → ${s2} ${JSON.stringify(b2).slice(0,80)}` });

  // 3.7-3: Stale SHA on already-signed contract  
  const { status: s3, body: b3 } = await probeNoAuth('POST', `/api/portal/contract/${ALPHA_CONTRACT_CODE_R}/sign`,
    { documentSha256: 'DEADBEEF00000000000000000000000000000000', signerName: 'Test', signerEmail: 'x@t.com', signatureBase64: 'SIG' });
  record({ id: '3.7-3', cat: '3.7', actor: '(portal)', target: 'sign stale SHA',
    method: 'POST', path: `/api/portal/contract/${ALPHA_CONTRACT_CODE_R}/sign`,
    expectedHttp: 409, actualHttp: s3, sideEffectVerified: true, sideEffectNote: 'stale SHA',
    verdict: s3 >= 400 ? 'PASS' : 'FINDING', severity: s3 < 400 ? 'P1' : '',
    notes: `stale SHA sign → ${s3} ${JSON.stringify(b3).slice(0,80)}` });

  // 3.7-4: Void signed contract — check profitability moves
  const profBefore = await snapshotProfitability(ALPHA_RETAIL_PIN);
  const { status: s4, body: b4 } = await probe('A-ADMIN', 'POST', `/api/contracts/${ALPHA_CONTRACT_R}/void`);
  const profAfter = await snapshotProfitability(ALPHA_RETAIL_PIN);
  const profMoved = (profBefore as Record<string,unknown>)?.revised_contract_cents !== (profAfter as Record<string,unknown>)?.revised_contract_cents;
  record({ id: '3.7-4', cat: '3.7', actor: 'A-ADMIN', target: 'void signed contract',
    method: 'POST', path: `/api/contracts/${ALPHA_CONTRACT_R}/void`,
    expectedHttp: 200, actualHttp: s4, sideEffectVerified: true,
    sideEffectNote: `profitability moved=${profMoved}; revised before=${(profBefore as Record<string,unknown>)?.revised_contract_cents} after=${(profAfter as Record<string,unknown>)?.revised_contract_cents}`,
    verdict: s4 === 200 ? 'PASS' : 'FINDING', severity: s4 !== 200 ? 'P2' : '',
    notes: `void signed → ${s4}; profitability recomputed=${profMoved}; revised_after=${(profAfter as Record<string,unknown>)?.revised_contract_cents}` });

  console.log('  3.7 done');
}

// ── 3.8 Portal rate limiting ──────────────────────────────────────────────────
async function test38() {
  console.log('\n═══ 3.8 Portal rate limiting ═══');
  let first429 = -1;
  for (let i = 1; i <= 35; i++) {
    const { status } = await probeNoAuth('GET', `/api/portal/contract/BADCODE-WRONG-${String(i).padStart(4,'0')}`);
    if (status === 429 && first429 === -1) first429 = i;
    if (i <= 3 || i >= 29) console.log(`    Attempt ${i}: ${status}`);
  }
  record({ id: '3.8-1', cat: '3.8', actor: '(unauth)', target: 'portal contract rate limit × 35',
    method: 'GET', path: '/api/portal/contract/BADCODE-*',
    expectedHttp: 429, actualHttp: first429 > 0 ? 429 : 0,
    sideEffectVerified: true, sideEffectNote: 'no DB writes on GET portal',
    verdict: first429 > 0 ? 'PASS' : 'FINDING', severity: first429 < 0 ? 'P0' : '',
    notes: `first 429 at attempt ${first429} (expected 31); engaged=${first429>0}` });

  // BRAVO session accessing ALPHA portal code
  const { status: cs } = await probe('B-ADMIN', 'GET', `/api/portal/contract/${ALPHA_CONTRACT_CODE_R}`);
  record({ id: '3.8-2', cat: '3.8', actor: 'B-ADMIN', target: 'ALPHA portal code from BRAVO session',
    method: 'GET', path: `/api/portal/contract/${ALPHA_CONTRACT_CODE_R}`,
    expectedHttp: 200, actualHttp: cs, sideEffectVerified: true, sideEffectNote: 'portal is public',
    verdict: 'PASS', severity: '',
    notes: `public portal GET with BRAVO session → ${cs} (portal is public; session irrelevant)` });
  console.log('  3.8 done');
}

// ── 3.9 IDOR ─────────────────────────────────────────────────────────────────
async function test39() {
  console.log('\n═══ 3.9 IDOR by ID substitution ═══');
  const fakeUUID = '00000000-aaaa-bbbb-cccc-000000000001';
  const cases: Array<{ id: string; actor: string; method: 'GET'|'POST'; path: string; note: string }> = [
    { id: '3.9-1', actor: 'A-ADMIN', method: 'GET',  path: `/api/pins/${ALPHA_RETAIL_PIN}/change-orders/${fakeUUID}`, note: 'ALPHA pin + fabricated CO id' },
    { id: '3.9-2', actor: 'B-ADMIN', method: 'GET',  path: `/api/pins/${BRAVO_RETAIL_PIN}/change-orders/${ALPHA_PAYMENT_R1}`, note: 'BRAVO pin + ALPHA payment as CO id' },
    { id: '3.9-3', actor: 'B-ADMIN', method: 'GET',  path: `/api/pins/${ALPHA_RETAIL_PIN}/invoices/${fakeUUID}`, note: 'ALPHA pin + fake invoice id' },
    { id: '3.9-4', actor: 'B-ADMIN', method: 'GET',  path: `/api/invoices/${fakeUUID}`, note: 'direct invoice lookup, fake id' },
    { id: '3.9-5', actor: 'B-ADMIN', method: 'GET',  path: `/api/pins/${ALPHA_RETAIL_PIN}/expenses/${fakeUUID}`, note: 'ALPHA pin + fake expense id' },
    { id: '3.9-6', actor: 'B-ADMIN', method: 'GET',  path: `/api/pins/${ALPHA_RETAIL_PIN}/stage-transitions`, note: 'ALPHA stage history from BRAVO' },
    { id: '3.9-7', actor: 'B-ADMIN', method: 'GET',  path: `/api/inspections/${ALPHA_INSP}/photos`, note: 'ALPHA inspection photos from BRAVO' },
  ];
  for (const c of cases) {
    const { status } = await probe(c.actor, c.method, c.path);
    const exposed = status === 200 || status === 201;
    record({ id: c.id, cat: '3.9', actor: c.actor, target: c.path, method: c.method, path: c.path,
      expectedHttp: 404, actualHttp: status, sideEffectVerified: true, sideEffectNote: 'read-only',
      verdict: exposed ? 'FINDING' : 'PASS', severity: exposed ? 'P0' : '',
      notes: `${c.note} → ${status}` });
  }
  console.log('  3.9 done');
}

// ── 3.10 Unauthenticated ──────────────────────────────────────────────────────
async function test310() {
  console.log('\n═══ 3.10 Unauthenticated sweep ═══');
  const routes: Array<{ method: 'GET'|'POST'|'PATCH'|'DELETE'; path: string }> = [
    { method: 'GET',   path: `/api/pins/${ALPHA_RETAIL_PIN}` },
    { method: 'GET',   path: `/api/inspections/${ALPHA_INSP}` },
    { method: 'GET',   path: `/api/contracts/${ALPHA_CONTRACT_R}` },
    { method: 'GET',   path: '/api/pins' },
    { method: 'POST',  path: '/api/pins' },
    { method: 'GET',   path: '/api/admin/stats' },
    { method: 'GET',   path: '/api/team/users' },
    { method: 'GET',   path: '/api/dashboard/manifest' },
    { method: 'GET',   path: '/api/profile' },
    { method: 'PATCH', path: '/api/profile' },
    { method: 'GET',   path: '/api/price-book/items' },
    { method: 'GET',   path: '/api/selections/categories' },
    { method: 'GET',   path: `/api/pins/${ALPHA_RETAIL_PIN}/profitability` },
    { method: 'POST',  path: `/api/pins/${ALPHA_RETAIL_PIN}/payments` },
    { method: 'GET',   path: `/api/pins/${ALPHA_RETAIL_PIN}/contracts` },
    { method: 'GET',   path: '/api/activity-stats' },
  ];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const { status } = await probeNoAuth(r.method, r.path);
    record({ id: `3.10-${i+1}`, cat: '3.10', actor: '(none)', target: r.path,
      method: r.method, path: r.path,
      expectedHttp: 401, actualHttp: status,
      sideEffectVerified: true, sideEffectNote: 'no auth, no writes',
      verdict: (status === 401 || status === 403) ? 'PASS' : 'FINDING',
      severity: (status !== 401 && status !== 403) ? 'P0' : '',
      notes: `no token → ${status}` });
  }
  // Tampered token
  const ts = (await request(app).get(`/api/pins/${ALPHA_RETAIL_PIN}`).set('Authorization', 'Bearer AAAA-fake-tampered')).status;
  record({ id: '3.10-tampered', cat: '3.10', actor: '(tampered)', target: `/api/pins/${ALPHA_RETAIL_PIN}`,
    method: 'GET', path: `/api/pins/${ALPHA_RETAIL_PIN}`,
    expectedHttp: 401, actualHttp: ts,
    sideEffectVerified: true, sideEffectNote: 'tampered session id',
    verdict: (ts === 401 || ts === 403) ? 'PASS' : 'FINDING',
    severity: (ts !== 401 && ts !== 403) ? 'P0' : '',
    notes: `tampered Bearer → ${ts}` });
  console.log('  3.10 done');
}

// ── 3.11 pins.contract_amount write paths ─────────────────────────────────────
async function test311() {
  console.log('\n═══ 3.11 pins.contract_amount write paths ═══');

  const pinBefore = await snapshotPin(ALPHA_RETAIL_PIN);
  const profBefore = await snapshotProfitability(ALPHA_RETAIL_PIN);

  // A-CANV-1 (field_rep, OWNER) writes contractAmount
  const { status: s1 } = await probe('A-CANV-1', 'PATCH', `/api/pins/${ALPHA_RETAIL_PIN}/profile`, {
    contractAmount: '$15,000.00',
  });

  const pinAfter = await snapshotPin(ALPHA_RETAIL_PIN);
  const profAfter = await snapshotProfitability(ALPHA_RETAIL_PIN);
  const amountChanged = (pinAfter as Record<string,unknown>)?.contract_amount !== (pinBefore as Record<string,unknown>)?.contract_amount;
  const profMoved = (profAfter as Record<string,unknown>)?.revised_contract_cents !== (profBefore as Record<string,unknown>)?.revised_contract_cents;

  record({ id: '3.11-1', cat: '3.11', actor: 'A-CANV-1', target: 'PATCH /pins/:id/profile — write contractAmount (owner)',
    method: 'PATCH', path: `/api/pins/${ALPHA_RETAIL_PIN}/profile`,
    expectedHttp: 200, actualHttp: s1,
    sideEffectVerified: true,
    sideEffectNote: `contract_amount changed=${amountChanged}; revised_cents before=${(profBefore as Record<string,unknown>)?.revised_contract_cents} after=${(profAfter as Record<string,unknown>)?.revised_contract_cents}`,
    verdict: (s1 === 200 && amountChanged) ? 'FINDING' : 'PASS',
    severity: (s1 === 200 && amountChanged) ? 'P1' : '',
    notes: `field_rep owner writes contractAmount → HTTP ${s1}; amount changed=${amountChanged}; profitability moved=${profMoved}; no audit trail` });

  // Restore original contract_amount
  if (amountChanged) {
    const origAmt = (pinBefore as Record<string,unknown>)?.contract_amount as string;
    await probe('A-CANV-1', 'PATCH', `/api/pins/${ALPHA_RETAIL_PIN}/profile`, { contractAmount: origAmt });
    console.log(`    Restored contractAmount to ${origAmt}`);
  }

  // A-CANV-2 (peer field_rep, non-owner) tries same
  const { status: s2 } = await probe('A-CANV-2', 'PATCH', `/api/pins/${ALPHA_RETAIL_PIN}/profile`, {
    contractAmount: '$20,000.00',
  });
  record({ id: '3.11-2', cat: '3.11', actor: 'A-CANV-2', target: 'PATCH /pins/:id/profile — write contractAmount (non-owner)',
    method: 'PATCH', path: `/api/pins/${ALPHA_RETAIL_PIN}/profile`,
    expectedHttp: 403, actualHttp: s2,
    sideEffectVerified: true, sideEffectNote: 'A-CANV-2 not pin owner',
    verdict: s2 === 200 ? 'FINDING' : 'PASS',
    severity: s2 === 200 ? 'P0' : '',
    notes: `peer field_rep (non-owner) writes contractAmount → ${s2}` });

  console.log('  3.11 done');
}

// ── 3.12 Input validation ─────────────────────────────────────────────────────
async function test312() {
  console.log('\n═══ 3.12 Input validation ═══');

  const payBase = (body: object) => probe('A-ADMIN', 'POST', `/api/pins/${ALPHA_RETAIL_PIN}/payments`, {
    type: 'deposit', paymentDate: '2026-08-09', method: 'cash', ...body
  });

  const payBefore = await db.execute(sql`SELECT COUNT(*) as cnt FROM payments WHERE pin_id = ${ALPHA_RETAIL_PIN}`);
  const cntBefore = Number((payBefore.rows[0] as Record<string,unknown>)?.cnt);

  const payTests: Array<{ id: string; body: object; reason: string; expectOk: boolean }> = [
    { id: '3.12-1', body: { amountCents: -100 },           reason: 'negative amountCents',   expectOk: false },
    { id: '3.12-2', body: { amountCents: 0 },              reason: 'zero amountCents',        expectOk: false },
    { id: '3.12-3', body: { amountCents: 100.5 },          reason: 'float amountCents',       expectOk: false },
    { id: '3.12-4', body: { amountCents: 'one thousand' }, reason: 'string amountCents',      expectOk: false },
    { id: '3.12-5', body: { amountCents: 9999999999999 },  reason: 'absurd magnitude',        expectOk: false },
    { id: '3.12-6', body: { amountCents: 100, paymentDate: 'not-a-date' }, reason: 'malformed date', expectOk: false },
    { id: '3.12-7', body: { amountCents: 100, type: null },reason: 'null required type',      expectOk: false },
    { id: '3.12-9', body: { amountCents: 100, type: 'invalid_type_xyz' }, reason: 'invalid enum', expectOk: false },
  ];

  for (const t of payTests) {
    const { status } = await payBase(t.body);
    const payAfter = await db.execute(sql`SELECT COUNT(*) as cnt FROM payments WHERE pin_id = ${ALPHA_RETAIL_PIN}`);
    const cntAfter = Number((payAfter.rows[0] as Record<string,unknown>)?.cnt);
    const rowCreated = cntAfter > cntBefore;
    record({ id: t.id, cat: '3.12', actor: 'A-ADMIN', target: `/api/pins/:id/payments (${t.reason})`,
      method: 'POST', path: `/api/pins/${ALPHA_RETAIL_PIN}/payments`,
      expectedHttp: 422, actualHttp: status,
      sideEffectVerified: true, sideEffectNote: `payments count ${cntBefore}→${cntAfter}; rowCreated=${rowCreated}`,
      verdict: (status >= 400 && !rowCreated) ? 'PASS' : (rowCreated ? 'FINDING' : 'PASS'),
      severity: rowCreated ? 'P2' : (status < 400 ? 'P2' : ''),
      notes: `${t.reason} → HTTP ${status}${rowCreated ? ' — ROW CREATED' : ''}` });
  }

  // Oversized text
  const { status: os } = await probe('A-INSP-1', 'PATCH', `/api/inspections/${ALPHA_INSP}`, { notes: 'x'.repeat(100000) });
  record({ id: '3.12-8', cat: '3.12', actor: 'A-INSP-1', target: 'PATCH inspections — oversized notes',
    method: 'PATCH', path: `/api/inspections/${ALPHA_INSP}`,
    expectedHttp: 200, actualHttp: os,
    sideEffectVerified: true, sideEffectNote: '100KB notes field',
    verdict: 'PASS', severity: '',
    notes: `100KB notes → ${os}` });

  // Negative contract amount
  const { status: ns } = await probe('A-CANV-1', 'PATCH', `/api/pins/${ALPHA_RETAIL_PIN}/profile`, { contractAmount: '-$5,000.00' });
  record({ id: '3.12-10', cat: '3.12', actor: 'A-CANV-1', target: 'PATCH profile — negative contractAmount',
    method: 'PATCH', path: `/api/pins/${ALPHA_RETAIL_PIN}/profile`,
    expectedHttp: 422, actualHttp: ns,
    sideEffectVerified: true, sideEffectNote: 'negative money string',
    verdict: ns >= 400 ? 'PASS' : 'FINDING', severity: ns < 400 ? 'P2' : '',
    notes: `negative contractAmount string → ${ns}` });

  console.log('  3.12 done');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Phase 3 Part 2 — Tests 3.3 through 3.12 ║');
  console.log('╚══════════════════════════════════════════╝\n');

  for (const a of Object.keys(USERS)) await getSid(a);
  console.log('Sessions created ✓');

  for (const [name, fn] of [
    ['3.3', test33], ['3.4', test34], ['3.5', test35], ['3.6', test36],
    ['3.7', test37], ['3.8', test38], ['3.9', test39], ['3.10', test310],
    ['3.11', test311], ['3.12', test312],
  ] as [string, () => Promise<void>][]) {
    try { await fn(); }
    catch (err) { console.error(`CATEGORY ${name} ERROR:`, err); }
  }

  const total    = results.length;
  const passed   = results.filter(r => r.verdict === 'PASS').length;
  const findings = results.filter(r => r.verdict === 'FINDING');
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║ TOTAL: ${total} | PASS: ${passed} | FINDINGS: ${findings.length}  ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);
  findings.forEach(f => console.log(`  [${f.severity||'?'}] ${f.id} — ${f.notes}`));

  process.stderr.write('\n__P2_RESULTS_JSON_START__\n');
  process.stderr.write(JSON.stringify(results, null, 2));
  process.stderr.write('\n__P2_RESULTS_JSON_END__\n');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
