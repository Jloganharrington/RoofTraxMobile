/**
 * Phase 2-R.2 — Compile Coverage Attempt (2-E closure)
 *
 * Seeds the existing insurance inspection (4b5effad) with the minimum data
 * required to pass the compile readiness gate, then attempts
 * POST /inspections/:id/report/compile to exercise the two previously-blocked
 * pipeline events (report_attested → package_ready, package_delivered → claim_filed).
 *
 * Seeded artifacts:
 *   - inspection_products row (ZZTEST marker, field_identified)
 *   - rap_gate_reason = 'not_authorized' patch to inspection
 *   - estimate with one manual line (30 SQ ZZTEST shingle replacement)
 *
 * All seeded rows are covered by zztest-teardown.sql.
 */

import request from 'supertest';
import app from '../app';
import { createSession } from '../lib/auth';

const INSPECTION_ID = '4b5effad-52bf-4f5a-87a4-33f570445dc4';
const COMPANY_ID    = 'ZZTEST_ALPHA';
const ACTOR_ID      = 'db57382f-a01e-414f-8663-fdcd74edbe9e'; // A-INSP-1
const ACTOR_EMAIL   = 'a-insp-1@zztest.local';

async function main() {
  const sid = await createSession({
    user: {
      id: ACTOR_ID, email: ACTOR_EMAIL,
      firstName: 'A-INSP-1', lastName: 'ZZTEST',
      profileImageUrl: null, companyId: COMPANY_ID,
    },
    access_token: 'zztest-phase2r2-insp1',
  });

  const auth = { Authorization: `Bearer ${sid}` };

  async function api(method: 'GET'|'POST'|'PATCH'|'PUT', path: string, body?: unknown) {
    const base = request(app) as unknown as Record<string, (p: string) => import('supertest').Test>;
    let req = base[method.toLowerCase()](path).set(auth);
    if (body !== undefined) req = req.send(body as object);
    return req;
  }

  // ── Step 0: readiness before seeding ────────────────────────────────────────
  console.log('── Readiness BEFORE seeding ──');
  const r0 = await api('GET', `/api/inspections/${INSPECTION_ID}/readiness`);
  console.log(`GET /readiness: ${r0.status}`);
  if (r0.status === 200 && r0.body?.readiness?.items) {
    for (const item of r0.body.readiness.items as Array<{state:string;key:string;detail:string|null}>) {
      console.log(`  [${item.state.padEnd(7)}] ${item.key}: ${item.detail ?? '—'}`);
    }
    console.log(`  overallPass: ${r0.body.readiness.overallPass}`);
  } else {
    console.log('  body:', JSON.stringify(r0.body).slice(0, 300));
  }

  // ── Step 1: seed inspection product (field_identified) ──────────────────────
  console.log('\n── Step 1: seed inspection product ──');
  const p1 = await api('POST', `/api/inspections/${INSPECTION_ID}/products`, {
    identificationMethod: 'field_identified',
    brand: 'ZZTEST Synthetic Brand',
    productLine: 'ZZTEST Shingle',
    notes: 'Seeded for compile readiness (ZZTEST marker)',
  });
  console.log(`POST /products: ${p1.status}`, p1.status >= 400 ? JSON.stringify(p1.body) : '');

  // ── Step 2: set rapGateReason on inspection ─────────────────────────────────
  console.log('\n── Step 2: set rapGateReason = not_authorized ──');
  const p2 = await api('PATCH', `/api/inspections/${INSPECTION_ID}`, {
    rapGateReason: 'not_authorized',
  });
  console.log(`PATCH /inspection: ${p2.status}`, p2.status >= 400 ? JSON.stringify(p2.body) : '');

  // ── Step 3: seed estimate with one manual line ──────────────────────────────
  console.log('\n── Step 3: seed estimate ──');
  const p3 = await api('PUT', `/api/inspections/${INSPECTION_ID}/estimate`, {
    wastePercent: 10,
    lines: [{
      priceBookItemId: null,
      description: 'ZZTEST Roofing Remove and Replace',
      unit: 'SQ',
      quantity: 30,
      unitPriceCents: 50000,
      isAdder: false,
    }],
    note: 'ZZTEST synthetic estimate seeded for compile readiness',
  });
  console.log(`PUT /estimate: ${p3.status}`, p3.status >= 400 ? JSON.stringify(p3.body) : '');

  // ── Step 4: readiness after seeding ─────────────────────────────────────────
  console.log('\n── Readiness AFTER seeding ──');
  const r1 = await api('GET', `/api/inspections/${INSPECTION_ID}/readiness`);
  console.log(`GET /readiness: ${r1.status}`);
  let overallPass = false;
  if (r1.status === 200 && r1.body?.readiness?.items) {
    overallPass = r1.body.readiness.overallPass as boolean;
    for (const item of r1.body.readiness.items as Array<{state:string;key:string;detail:string|null}>) {
      console.log(`  [${item.state.padEnd(7)}] ${item.key}: ${item.detail ?? '—'}`);
    }
    console.log(`  overallPass: ${overallPass}`);
  }

  // ── Step 5: attempt compile ──────────────────────────────────────────────────
  console.log('\n── Step 5: attempt compile ──');
  const p5 = await api('POST', `/api/inspections/${INSPECTION_ID}/report/compile`);
  console.log(`POST /report/compile: ${p5.status}`);
  if (p5.status >= 400) {
    console.log('  error body:', JSON.stringify(p5.body).slice(0, 800));
  } else {
    console.log('  SUCCESS — compile returned', p5.status);
    const versions = p5.body?.inspection?.compiledReportVersions;
    if (versions) console.log('  compiledReportVersions count:', versions.length);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n── Summary ──');
  console.log('Product seeded:', p1.status === 201 || p1.status === 200);
  console.log('rapGateReason set:', p2.status === 200);
  console.log('Estimate seeded:', p3.status === 200);
  console.log('Readiness overallPass:', overallPass);
  console.log('Compile status:', p5.status);
}

main().catch(e => { console.error(e); process.exit(1); });
