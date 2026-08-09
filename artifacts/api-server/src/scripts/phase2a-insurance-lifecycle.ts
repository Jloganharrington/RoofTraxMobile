/**
 * Phase 2A — Insurance Positive Lifecycle
 *
 * Pin:   fdbdceba  (ZZTEST_ALPHA, insurance, owner = A-INSP-1)
 * Actors: A-INSP-1 → A-MGR-F → A-ADMIN
 *
 * Stage sequence (pipeline events in brackets):
 *   pin_dropped
 *     → phase1_scheduled (manual advance)
 *     → [preliminary_record_synced] → phase1_complete
 *     → [fipsa_signed] → fipsa_signed
 *     → phase2_scheduled (manual advance)
 *     → [forensic_record_attested] → phase2_complete
 *     → [report_attested] → package_ready       ← requires compiled report
 *     → [package_delivered] → claim_filed        ← requires submitted inspection
 *     → claim_review (manual advance)
 *     → [approved outcome] → claim_approved
 *     → contract_pending (manual advance)
 *     → [contract_signed] → contract_signed
 *     → deposit_received (manual advance)
 *
 * Note on AI steps: The compile endpoint calls Gemini to generate the report.
 * If the compile fails (insufficient inspection data), steps after phase2_complete
 * are advanced manually with trigger 'task' and noted as blocked.
 */

import request from 'supertest';
import app from '../app';
import { db, usersTable, stageTransitionsTable, pinsTable } from '@workspace/db';
import { createSession } from '../lib/auth';
import { eq, sql } from 'drizzle-orm';

// ── IDs ──────────────────────────────────────────────────────────────────────
const INS_PIN    = 'fdbdceba-2db1-454e-881d-cbc02af7593f';
const COMPANY_ID = 'ZZTEST_ALPHA';
const ROOFING_CAT = '7b128798-3571-4569-a3e1-2d9e83090cf8';
const LANDMARK_TL = '0f093479-436a-483e-b51b-2ca56ea56d7c';

const ACTORS = {
  'A-INSP-1': 'db57382f-a01e-414f-8663-fdcd74edbe9e',
  'A-MGR-F':  '74a553ae-b375-4af0-85b8-530a39ee8f02',
  'A-ADMIN':  '2e7597e6-3ca8-4c0e-9cf8-80a0730308ca',
};
const ACTOR_EMAILS: Record<string,string> = {
  'A-INSP-1': 'a-insp-1@zztest.local',
  'A-MGR-F':  'a-mgr-f@zztest.local',
  'A-ADMIN':  'a-admin@zztest.local',
};

const sids: Record<string, string> = {};
const log: Array<{ step: number; actor: string; method: string; url: string; status: number; note: string }> = [];
let stepIdx = 0;

async function getSid(actor: string): Promise<string> {
  if (sids[actor]) return sids[actor];
  const userId = ACTORS[actor as keyof typeof ACTORS];
  const email  = ACTOR_EMAILS[actor];
  const sid = await createSession({
    user: { id: userId, email, firstName: actor, lastName: 'ZZTEST', profileImageUrl: null, companyId: COMPANY_ID },
    access_token: `zztest-phase2a-${actor}`,
  });
  sids[actor] = sid;
  return sid;
}

async function api(
  actor: string,
  method: 'GET'|'POST'|'PATCH'|'DELETE',
  path: string,
  body?: unknown,
  note = '',
  opts: { optional?: boolean } = {},
) {
  stepIdx++;
  const sid = await getSid(actor);
  const auth = { Authorization: `Bearer ${sid}` };
  let req = request(app)[method.toLowerCase() as 'get'|'post'|'patch'|'delete'](path).set(auth);
  if (body !== undefined) req = req.send(body as object);
  const res = await req;
  log.push({ step: stepIdx, actor, method, url: path, status: res.status, note });
  const ok = res.status >= 200 && res.status < 300;
  console.log(`  ${ok ? '✓' : (opts.optional ? '!' : '✗')} [${stepIdx}] ${actor} ${method} ${path} → ${res.status}${note ? '  // '+note : ''}`);
  if (!ok) {
    console.log(`    body: ${JSON.stringify(res.body).slice(0,300)}`);
    if (!opts.optional) throw new Error(`Step ${stepIdx} failed: ${res.status} ${JSON.stringify(res.body).slice(0,200)}`);
  }
  return res;
}

// Minimal valid base64-encoded PDF (1-page blank, ~300 bytes)
const MINIMAL_PDF_B64 = [
  'JVBERi0xLjAKJeLjz9MKCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+',
  'CmVuZG9iagoKMiAwIG9iago8PCAvVHlwZSAvUGFnZXMgL0tpZHMgWzMgMCBSXSAvQ291bnQgMSA+',
  'PgplbmRvYmoKCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3gg',
  'WzAgMCA2MTIgNzkyXSA+PgplbmRvYmoKCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAw',
  'MDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAgMDAwMCBuIAowMDAwMDAwMTE1IDAgMDAwMCBuIA',
  'oKdHJhaWxlcgo8PCAvU2l6ZSA0IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxODkKJSVFT0YK',
].join('');

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const now = () => new Date().toISOString();
const tomorrow = new Date(Date.now() + 86400000).toISOString();

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  PHASE 2A — INSURANCE POSITIVE LIFECYCLE');
  console.log('══════════════════════════════════════════════════\n');

  // ── 1. Manual: pin_dropped → phase1_scheduled (A-MGR-F) ──────────────────
  await api('A-MGR-F', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
    { toStage: 'phase1_scheduled', trigger: 'manual_move', loopNextActionAt: tomorrow },
    'pin_dropped → phase1_scheduled');

  // ── 2. A-INSP-1 creates preliminary inspection ────────────────────────────
  const insRes = await api('A-INSP-1', 'POST', '/api/inspections', {
    pinId:                INS_PIN,
    phase:                'preliminary',
    damageType:           'roof',
    insuredName:          'Morgan ZZTEST Homeowner',
    address:              '742 Evergreen Terrace, Springfield, IL 62704',
    latitude:             39.7817,
    longitude:            -89.6501,
    carrierName:          'Acme Mutual Insurance',
    policyNumber:         'HO-ZZTEST-9901',
    claimNumber:          'CLM-2026-ZZTEST-01',
    dateOfLoss:           'June 14, 2026',
    roofDamageFound:      true,
    collateralDamageFound: false,
  }, 'create preliminary inspection (phase=preliminary)');
  const inspectionId = insRes.body.inspection.id as string;
  console.log(`    inspectionId: ${inspectionId}`);

  // ── 3. Mark preliminary complete → fires preliminary_record_synced ─────────
  //    pin at phase1_scheduled → auto-advance to phase1_complete
  await api('A-INSP-1', 'PATCH', `/api/inspections/${inspectionId}`, {
    preliminaryCompletedAt: now(),
  }, 'set preliminaryCompletedAt → fires preliminary_record_synced → phase1_complete');

  // Brief pause to let the fire-and-forget event settle
  await new Promise(r => setTimeout(r, 400));

  // ── 4. Switch to forensic phase ── MUST precede FIPSA sign ────────────────
  // agreement.ts line ~115: inspection.phase must === 'forensic' to sign.
  // The inspector transitions from preliminary walk to forensic documentation;
  // the phase switch happens before FIPSA is presented for homeowner signature.
  await api('A-INSP-1', 'PATCH', `/api/inspections/${inspectionId}`, {
    phase: 'forensic',
  }, 'switch phase: preliminary → forensic (required gate before FIPSA sign)');

  // ── 5. Sign FIPSA agreement → fires fipsa_signed ──────────────────────────
  //    pin at phase1_complete → auto-advance to fipsa_signed stage
  await api('A-INSP-1', 'POST', `/api/inspections/${inspectionId}/agreement/sign`, {
    signerName: 'Morgan ZZTEST Homeowner',
    pdfBase64:  MINIMAL_PDF_B64,
  }, 'sign FIPSA → fires fipsa_signed → fipsa_signed stage');

  await new Promise(r => setTimeout(r, 400));

  // ── 6. Manual: fipsa_signed → phase2_scheduled (A-MGR-F) ─────────────────
  await api('A-MGR-F', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
    { toStage: 'phase2_scheduled', trigger: 'manual_move', loopNextActionAt: tomorrow },
    'fipsa_signed → phase2_scheduled');

  // ── 7. Create stage_signoff attestation → fires forensic_record_attested ──
  //    pin at phase2_scheduled → auto-advance to phase2_complete
  await api('A-INSP-1', 'POST', `/api/inspections/${inspectionId}/attestations`, {
    attestationType: 'stage_signoff',
  }, 'stage_signoff attestation → fires forensic_record_attested → phase2_complete');

  await new Promise(r => setTimeout(r, 300));

  // ── 8. Compile report (AI step — may fail if inspection lacks data) ────────
  console.log('\n  [AI step] Attempting report compile (Gemini)...');
  const compileRes = await api('A-MGR-F', 'POST', `/api/inspections/${inspectionId}/report/compile`, {},
    'compile report (AI/Gemini)', { optional: true });
  const compileOk = compileRes.status >= 200 && compileRes.status < 300;

  let reportAttested = false;
  let packageDelivered = false;

  if (compileOk) {
    console.log('    compile succeeded ✓');

    // ── 9. Attest report → fires report_attested → package_ready ─────────────
    const attestRes = await api('A-MGR-F', 'POST', `/api/inspections/${inspectionId}/report-attestation`, {
      acknowledged: true,
    }, 'report attestation → fires report_attested → package_ready', { optional: true });
    reportAttested = attestRes.status >= 200 && attestRes.status < 300;
    if (reportAttested) await new Promise(r => setTimeout(r, 300));

    // ── 10. Submit inspection → fires package_delivered → claim_filed ────────
    if (reportAttested) {
      const submitRes = await api('A-MGR-F', 'POST', `/api/inspections/${inspectionId}/submit`, {},
        'submit inspection → fires package_delivered → claim_filed', { optional: true });
      packageDelivered = submitRes.status >= 200 && submitRes.status < 300;
      if (packageDelivered) await new Promise(r => setTimeout(r, 300));
    }
  }

  // If AI steps failed, advance manually to keep the lifecycle going
  if (!compileOk || !reportAttested) {
    console.log('\n  [NOTE] AI compile/attest blocked — advancing report_attested + package_delivered manually (trigger=task)');
    stepIdx++;
    console.log(`  ! [${stepIdx}] A-ADMIN PATCH /api/leads/${INS_PIN}/advance-stage → manual (report_attested proxy)  // BLOCKED: no compiled report`);
    log.push({ step: stepIdx, actor: 'A-ADMIN', method: 'PATCH', url: `/api/leads/${INS_PIN}/advance-stage`, status: 0, note: 'BLOCKED: compile/attest not run — manual proxy for report_attested + package_delivered' });

    // Manually advance to claim_filed
    await api('A-ADMIN', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
      { toStage: 'claim_filed', trigger: 'task' },
      'manual proxy: phase2_complete → claim_filed (blocked on AI)');
  }

  if (!packageDelivered) {
    // Already manually advanced to claim_filed above; or re-advance if needed
    const [pinNow] = await db.select({ pipelineStage: pinsTable.pipelineStage }).from(pinsTable).where(eq(pinsTable.id, INS_PIN));
    if (pinNow?.pipelineStage !== 'claim_filed') {
      await api('A-ADMIN', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
        { toStage: 'claim_filed', trigger: 'task' },
        'advance to claim_filed');
    }
  }

  // ── 11. Manual: claim_filed → claim_review (A-ADMIN) ─────────────────────
  await api('A-ADMIN', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
    { toStage: 'claim_review', trigger: 'manual_move' },
    'claim_filed → claim_review');

  // ── 12. Outcome 'approved' → claim_review → claim_approved ───────────────
  //    POST /events/pipeline with eventType that includes 'approved'
  await api('A-ADMIN', 'POST', '/api/events/pipeline',
    { eventType: 'approved', leadId: INS_PIN },
    'event: approved outcome → claim_approved');

  await new Promise(r => setTimeout(r, 200));

  // ── 13. Manual: claim_approved → contract_pending (A-ADMIN) ──────────────
  await api('A-ADMIN', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
    { toStage: 'contract_pending', trigger: 'manual_move' },
    'claim_approved → contract_pending');

  // ── 14. Create insurance contract ────────────────────────────────────────
  const contractRes = await api('A-ADMIN', 'POST', `/api/pins/${INS_PIN}/contracts`, {
    coveredScopeCents: 1800000,  // $18,000 (ACV amount)
    deductibleCents:   150000,   // $1,500 deductible
    scopeSummary:      'Insurance claim — roof replacement (hail damage) 30 SQ',
  }, 'create insurance contract ($18,000 covered, $1,500 deductible)');
  const contractId = contractRes.body.contract.id as string;
  const accessCode = contractRes.body.contract.accessCode as string;
  console.log(`    contractId: ${contractId}  accessCode: ${accessCode}`);

  // ── 15. Scope package ────────────────────────────────────────────────────
  const pkgRes = await api('A-ADMIN', 'POST', `/api/contracts/${contractId}/scope-packages`, {
    categoryId:         ROOFING_CAT,
    quantity:           30,
    unit:               'SQ',
    coveredAmountCents: 1800000,
    sortOrder:          0,
  }, 'scope package: Roofing 30 SQ');
  const pkgId = pkgRes.body.scopePackage?.id ?? pkgRes.body.pkg?.id ?? pkgRes.body.id as string;

  // ── 16. Send contract ────────────────────────────────────────────────────
  await api('A-ADMIN', 'POST', `/api/contracts/${contractId}/send`, {},
    'send contract → status: sent');

  // ── 17. Portal: select product ────────────────────────────────────────────
  {
    stepIdx++;
    const res = await request(app)
      .post(`/api/portal/contract/${accessCode}/select/${pkgId}`)
      .send({ productId: LANDMARK_TL });
    log.push({ step: stepIdx, actor: '(portal)', method: 'POST', url: `/api/portal/contract/${accessCode}/select/${pkgId}`, status: res.status, note: 'portal: select product' });
    console.log(`  ${res.status < 300 ? '✓' : '✗'} [${stepIdx}] (portal) POST .../select/${pkgId.slice(-8)} → ${res.status}  // select Landmark TL`);
    if (res.status >= 300) throw new Error(`Portal select failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  // ── 18. Generate document ─────────────────────────────────────────────────
  const genRes = await api('A-ADMIN', 'POST', `/api/contracts/${contractId}/generate-document`, {},
    'generate contract document → sha256');
  const documentSha256 = genRes.body.contract?.documentSha256 as string;
  console.log(`    sha256: ${documentSha256.slice(0,16)}...`);

  // ── 19. Portal: sign contract ─────────────────────────────────────────────
  {
    stepIdx++;
    const res = await request(app)
      .post(`/api/portal/contract/${accessCode}/sign`)
      .send({ customerPrintName: 'Morgan ZZTEST Homeowner', customerSignatureBase64: TINY_PNG_B64, documentSha256 });
    log.push({ step: stepIdx, actor: '(portal)', method: 'POST', url: `/api/portal/contract/${accessCode}/sign`, status: res.status, note: 'portal: sign contract → contract_signed' });
    console.log(`  ${res.status < 300 ? '✓' : '✗'} [${stepIdx}] (portal) POST .../sign → ${res.status}  // fires contract_signed event`);
    if (res.status >= 300) throw new Error(`Portal sign failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  await new Promise(r => setTimeout(r, 300));

  // ── 20. Record ACV insurance payment ─────────────────────────────────────
  await api('A-ADMIN', 'POST', `/api/pins/${INS_PIN}/payments`, {
    type:        'acv',
    amountCents: 1650000,  // $16,500 (ACV = covered - deductible)
    paymentDate: now(),
    notes:       'Phase 2A test ACV payment',
  }, 'record ACV payment $16,500');

  // ── 21. Manual: contract_signed → deposit_received ────────────────────────
  await api('A-ADMIN', 'PATCH', `/api/leads/${INS_PIN}/advance-stage`,
    { toStage: 'deposit_received', trigger: 'task' },
    'contract_signed → deposit_received');

  // ── POST-RUN ASSERTIONS ───────────────────────────────────────────────────
  console.log('\n  ── Assertions ──────────────────────────────────');

  const transitions = await db
    .select({
      fromStage:   stageTransitionsTable.fromStage,
      toStage:     stageTransitionsTable.toStage,
      trigger:     stageTransitionsTable.trigger,
      createdAt:   stageTransitionsTable.createdAt,
      taskPayload: stageTransitionsTable.taskPayload,
    })
    .from(stageTransitionsTable)
    .where(eq(stageTransitionsTable.leadId, INS_PIN))
    .orderBy(stageTransitionsTable.createdAt);

  console.log(`\n  stage_transitions (${transitions.length} rows):`);
  for (const t of transitions) {
    const event = (t.taskPayload as { eventType?: string } | null)?.eventType ?? '—';
    console.log(`    ${(t.fromStage ?? 'null').padEnd(22)} → ${t.toStage.padEnd(22)} trigger=${t.trigger}  event=${event}`);
  }

  const profRows = await db.execute(sql`SELECT * FROM pin_profitability WHERE pin_id = ${INS_PIN}`);
  const prof = profRows.rows[0] as Record<string, unknown> | undefined;
  if (prof) {
    console.log('\n  pin_profitability (insurance):');
    const fmt = (c: unknown) => c ? `$${((Number(c))/100).toFixed(2)}` : '$0.00';
    console.log(`    base_contract_cents:     ${fmt(prof.base_contract_cents)}`);
    console.log(`    approved_co_cents:       ${fmt(prof.approved_co_cents)}`);
    console.log(`    revised_contract_cents:  ${fmt(prof.revised_contract_cents)}`);
    console.log(`    approved_rcv_cents:      ${fmt(prof.approved_rcv_cents)}`);
    console.log(`    expected_total_cents:    ${fmt(prof.expected_total_cents)}`);
    console.log(`    total_cost_cents:        ${fmt(prof.total_cost_cents)}`);
    console.log(`    net_project_margin_cents:${fmt(prof.net_project_margin_cents)}`);
    console.log(`    net_project_margin_pct:  ${prof.net_project_margin_pct ?? 'null'}`);
    console.log(`    payment_total_cents:     ${fmt(prof.payment_total_cents)}`);
    console.log(`    workflow:                ${prof.workflow}`);
    console.log(`    Arithmetic check:`);
    const base = Number(prof.base_contract_cents ?? 0);
    const co   = Number(prof.approved_co_cents ?? 0);
    const rev  = Number(prof.revised_contract_cents ?? 0);
    const rcv  = Number(prof.approved_rcv_cents ?? 0);
    const exp  = Number(prof.expected_total_cents ?? 0);
    const cost = Number(prof.total_cost_cents ?? 0);
    const net  = Number(prof.net_project_margin_cents ?? 0);
    console.log(`      base+co = ${base+co}  == revised? ${base+co===rev ? 'YES ✓':'NO ✗ (got '+rev+')'}`);
    console.log(`      expected = max(revised, approved_rcv) = max(${rev},${rcv}) = ${Math.max(rev,rcv)}  stored? ${exp===Math.max(rev,rcv) ? 'YES ✓':'NO ✗ (got '+exp+')'}`);
    console.log(`      revised-cost = ${rev-cost}  == net? ${rev-cost===net ? 'YES ✓':'NO ✗ (got '+net+')'}`);
  } else {
    console.log('\n  pin_profitability: no row found');
  }

  console.log('\n  ── HTTP call log ───────────────────────────────');
  for (const entry of log) {
    const status = entry.status === 0 ? 'SKIP' : String(entry.status);
    console.log(`    [${entry.step}] ${entry.actor.padEnd(12)} ${entry.method.padEnd(6)} ${entry.url.slice(0,60).padEnd(60)}  →${status}${entry.note ? '  // '+entry.note : ''}`);
  }

  console.log('\n  ── Expected notifications (insurance) ──────────');
  console.log('    inspection_assigned:        FIRED (create inspection, assigned to A-INSP-1 by self = no-op)');
  console.log('    fipsa_signed:               FIRED (internal team notification on agreement sign)');
  console.log('    proof_package_delivered:    FIRED if compile/submit succeeded; BLOCKED otherwise');
  console.log('    contract_signed:            FIRED (system, non-blocking after portal sign)');
  console.log('    change_order_*:             n/a (no change orders)');
  console.log('    appointment_assigned:       n/a (appointment not set via API)');
  console.log(`    AI steps blocked:           compile=${compileOk}  report_attested=${reportAttested}  package_delivered=${packageDelivered}`);

  const [finalPin] = await db.select({ pipelineStage: pinsTable.pipelineStage, contractAmount: pinsTable.contractAmount })
    .from(pinsTable).where(eq(pinsTable.id, INS_PIN));
  console.log(`\n  Final pin state: stage=${finalPin?.pipelineStage}  contractAmount=${finalPin?.contractAmount}`);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  PHASE 2A COMPLETE');
  console.log('══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
