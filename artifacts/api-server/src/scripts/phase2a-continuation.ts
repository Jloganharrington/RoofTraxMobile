/**
 * Phase 2A continuation — completes from step 17 (portal select)
 *
 * Pin:        fdbdceba (insurance, currently at contract_pending)
 * contractId: 0a011c64-1e71-48ed-8a55-e1ad7326d345
 * accessCode: B3BP-2B2W-45TJ
 * pkgId:      queried below
 *
 * Steps already completed:
 *   1-7: phase1_scheduled + inspection + forensic + FIPSA + phase2_scheduled + attestation
 *   8: AI compile → 400 (BLOCKED — no inspection data sufficient for Gemini)
 *   9: BLOCKED note
 *   10: manual advance to claim_filed
 *   11: claim_filed → claim_review
 *   12: POST /events/pipeline { approved } → 200 (no-op; claim_review has outcomes only)
 *   13: PATCH advance-stage claim_review → contract_pending (manual, skipped claim_approved)
 *   14: create contract $18,000
 *   15: scope package (Roofing 30 SQ)
 *   16: send contract → status: sent
 */

import request from 'supertest';
import app from '../app';
import { db, stageTransitionsTable, pinsTable, contractScopePackagesTable } from '@workspace/db';
import { createSession } from '../lib/auth';
import { eq, sql } from 'drizzle-orm';

const INS_PIN    = 'fdbdceba-2db1-454e-881d-cbc02af7593f';
const COMPANY_ID = 'ZZTEST_ALPHA';
const CONTRACT_ID = '0a011c64-1e71-48ed-8a55-e1ad7326d345';
const ACCESS_CODE = 'B3BP-2B2W-45TJ';
const LANDMARK_TL = '0f093479-436a-483e-b51b-2ca56ea56d7c';

const ACTORS = {
  'A-ADMIN': '2e7597e6-3ca8-4c0e-9cf8-80a0730308ca',
};
const sids: Record<string, string> = {};

async function getSid(actor: string): Promise<string> {
  if (sids[actor]) return sids[actor];
  const sid = await createSession({
    user: { id: ACTORS['A-ADMIN'], email: 'a-admin@zztest.local', firstName: 'A-ADMIN', lastName: 'ZZTEST', profileImageUrl: null, companyId: COMPANY_ID },
    access_token: `zztest-phase2a-cont-admin`,
  });
  sids[actor] = sid;
  return sid;
}

const log: Array<{ step: number; actor: string; method: string; url: string; status: number; note: string }> = [];
let stepIdx = 16; // continuation from step 16

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const now = () => new Date().toISOString();

async function adminApi(method: 'GET'|'POST'|'PATCH'|'DELETE', path: string, body?: unknown, note = '') {
  stepIdx++;
  const sid = await getSid('A-ADMIN');
  const auth = { Authorization: `Bearer ${sid}` };
  let req = request(app)[method.toLowerCase() as 'get'|'post'|'patch'|'delete'](path).set(auth);
  if (body !== undefined) req = req.send(body as object);
  const res = await req;
  log.push({ step: stepIdx, actor: 'A-ADMIN', method, url: path, status: res.status, note });
  const ok = res.status >= 200 && res.status < 300;
  console.log(`  ${ok ? '✓' : '✗'} [${stepIdx}] A-ADMIN ${method} ${path} → ${res.status}${note ? '  // '+note : ''}`);
  if (!ok) console.error(`    body: ${JSON.stringify(res.body).slice(0,300)}`);
  if (!ok) throw new Error(`Step ${stepIdx} failed: ${res.status}`);
  return res;
}

async function portalPost(path: string, body: unknown, note = '') {
  stepIdx++;
  const res = await request(app).post(path).send(body as object);
  log.push({ step: stepIdx, actor: '(portal)', method: 'POST', url: path, status: res.status, note });
  const ok = res.status >= 200 && res.status < 300;
  console.log(`  ${ok ? '✓' : '✗'} [${stepIdx}] (portal) POST ${path.slice(-50)} → ${res.status}${note ? '  // '+note : ''}`);
  if (!ok) { console.error(`    body: ${JSON.stringify(res.body).slice(0,300)}`); throw new Error(`Portal step ${stepIdx}: ${res.status}`); }
  return res;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  PHASE 2A — CONTINUATION (steps 17–21)');
  console.log('══════════════════════════════════════════════════\n');

  // Look up pkgId
  const [pkg] = await db.select({ id: contractScopePackagesTable.id })
    .from(contractScopePackagesTable).where(eq(contractScopePackagesTable.contractId, CONTRACT_ID));
  if (!pkg) throw new Error('scope package not found for contract');
  const pkgId = pkg.id;
  console.log(`  pkgId: ${pkgId}`);

  // ── 17. Portal select product ─────────────────────────────────────────────
  await portalPost(`/api/portal/contract/${ACCESS_CODE}/select/${pkgId}`,
    { productId: LANDMARK_TL },
    'portal: select Landmark TL');

  // ── 18. Generate document ─────────────────────────────────────────────────
  const genRes = await adminApi('POST', `/api/contracts/${CONTRACT_ID}/generate-document`, {},
    'generate contract document → sha256');
  const documentSha256 = genRes.body.contract?.documentSha256 as string;
  console.log(`    sha256: ${documentSha256.slice(0,16)}...`);

  // ── 19. Portal sign ───────────────────────────────────────────────────────
  await portalPost(`/api/portal/contract/${ACCESS_CODE}/sign`, {
    customerPrintName:       'Morgan ZZTEST Homeowner',
    customerSignatureBase64: TINY_PNG_B64,
    documentSha256,
  }, 'portal sign → contract_signed event → insurance contract_pending → contract_signed');

  await new Promise(r => setTimeout(r, 400));

  // ── 20. Record ACV payment ────────────────────────────────────────────────
  await adminApi('POST', `/api/pins/${INS_PIN}/payments`, {
    type:        'acv',
    amountCents: 1650000,  // $16,500 (18,000 covered - 1,500 deductible)
    paymentDate: now(),
    notes:       'Phase 2A ACV payment',
  }, 'record ACV payment $16,500');

  // ── 21. Advance to deposit_received ───────────────────────────────────────
  await adminApi('PATCH', `/api/leads/${INS_PIN}/advance-stage`,
    { toStage: 'deposit_received', trigger: 'task' },
    'contract_signed → deposit_received');

  // ── ASSERTIONS ────────────────────────────────────────────────────────────
  console.log('\n  ── Full stage_transitions audit (all rows) ─────');
  const transitions = await db
    .select({
      fromStage:   stageTransitionsTable.fromStage,
      toStage:     stageTransitionsTable.toStage,
      trigger:     stageTransitionsTable.trigger,
      taskPayload: stageTransitionsTable.taskPayload,
    })
    .from(stageTransitionsTable)
    .where(eq(stageTransitionsTable.leadId, INS_PIN))
    .orderBy(stageTransitionsTable.createdAt);

  console.log(`  (${transitions.length} rows total)`);
  for (const t of transitions) {
    const event = (t.taskPayload as { eventType?: string } | null)?.eventType ?? '—';
    console.log(`    ${(t.fromStage ?? 'null').padEnd(24)} → ${t.toStage.padEnd(24)} trigger=${t.trigger}  event=${event}`);
  }

  // Profitability
  const profRows = await db.execute(sql`SELECT * FROM pin_profitability WHERE pin_id = ${INS_PIN}`);
  const prof = profRows.rows[0] as Record<string, unknown> | undefined;
  if (prof) {
    const fmt = (c: unknown) => c ? `$${((Number(c))/100).toFixed(2)}` : '$0.00';
    console.log('\n  pin_profitability (insurance):');
    console.log(`    base_contract_cents:     ${fmt(prof.base_contract_cents)}`);
    console.log(`    approved_co_cents:       ${fmt(prof.approved_co_cents)}`);
    console.log(`    revised_contract_cents:  ${fmt(prof.revised_contract_cents)}`);
    console.log(`    approved_rcv_cents:      ${fmt(prof.approved_rcv_cents)}`);
    console.log(`    expected_total_cents:    ${fmt(prof.expected_total_cents)}`);
    console.log(`    total_cost_cents:        ${fmt(prof.total_cost_cents)}`);
    console.log(`    net_project_margin_cents:${fmt(prof.net_project_margin_cents)}`);
    console.log(`    net_project_margin_pct:  ${prof.net_project_margin_pct ?? 'null'}`);
    console.log(`    payment_total_cents:     ${fmt(prof.payment_total_cents)}`);
    const base = Number(prof.base_contract_cents ?? 0);
    const co   = Number(prof.approved_co_cents ?? 0);
    const rev  = Number(prof.revised_contract_cents ?? 0);
    const cost = Number(prof.total_cost_cents ?? 0);
    const net  = Number(prof.net_project_margin_cents ?? 0);
    console.log(`    Arithmetic: base+co=${base+co} == revised(${rev})? ${base+co===rev?'YES ✓':'NO ✗'}  revised-cost=${rev-cost} == net(${net})? ${rev-cost===net?'YES ✓':'NO ✗'}`);
  } else {
    console.log('\n  pin_profitability: no row');
  }

  const [finalPin] = await db.select({ pipelineStage: pinsTable.pipelineStage, contractAmount: pinsTable.contractAmount })
    .from(pinsTable).where(eq(pinsTable.id, INS_PIN));
  console.log(`\n  Final pin state: stage=${finalPin?.pipelineStage}  contractAmount=${finalPin?.contractAmount}`);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  PHASE 2A COMPLETE');
  console.log('══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
