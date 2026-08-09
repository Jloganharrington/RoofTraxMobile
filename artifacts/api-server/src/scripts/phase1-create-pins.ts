/**
 * Phase 1 — Step 2: Create the 3 leads.
 * Companies and users were already created by phase1-fixture.ts.
 * This script re-mints sessions from DB and creates the pins via API.
 */
import request from 'supertest';
import app from '../app';
import { db, usersTable, sessionsTable } from '@workspace/db';
import { createSession } from '../lib/auth';
import { like, eq } from 'drizzle-orm';

async function sessionFor(email: string, companyId: string): Promise<string> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) throw new Error(`User not found: ${email}`);
  return createSession({
    user: { id: user.id, email, firstName: user.firstName ?? '', lastName: user.lastName ?? '', profileImageUrl: null, companyId },
    access_token: `zztest-pin-token`,
  });
}

async function main() {
  // Re-mint sessions for the three reps
  const aCanv1Sid  = await sessionFor('a-canv-1@zztest.local', 'ZZTEST_ALPHA');
  const aInsp1Sid  = await sessionFor('a-insp-1@zztest.local', 'ZZTEST_ALPHA');
  const bRepSid    = await sessionFor('b-rep@zztest.local',    'ZZTEST_BRAVO');

  const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

  // Pin 1: retail (ALPHA)
  const r1 = await request(app).post('/api/pins').set(auth(aCanv1Sid)).send({
    latitude: 38.8977, longitude: -77.0366,
    workflow: 'retail',
    doorKnockResult: 'appointment',
    customerName: 'ZZTEST Retail Homeowner',
  });
  if (r1.status !== 201) throw new Error(`Pin1 failed: ${r1.status} ${JSON.stringify(r1.body)}`);
  const pin1Id = r1.body.pin?.id ?? r1.body.id;
  console.log(`Pin 1 (retail/ALPHA): ${pin1Id}`);

  // Pin 2: insurance (ALPHA)
  const r2 = await request(app).post('/api/pins').set(auth(aInsp1Sid)).send({
    latitude: 38.9077, longitude: -77.0266,
    workflow: 'insurance',
    doorKnockResult: 'appointment',
    customerName: 'ZZTEST Insurance Homeowner',
    damageType: 'roof',
  });
  if (r2.status !== 201) throw new Error(`Pin2 failed: ${r2.status} ${JSON.stringify(r2.body)}`);
  const pin2Id = r2.body.pin?.id ?? r2.body.id;
  console.log(`Pin 2 (insurance/ALPHA): ${pin2Id}`);

  // Pin 3: retail (BRAVO)
  const r3 = await request(app).post('/api/pins').set(auth(bRepSid)).send({
    latitude: 38.9177, longitude: -77.0166,
    workflow: 'retail',
    doorKnockResult: 'appointment',
    customerName: 'ZZTEST Bravo Homeowner',
  });
  if (r3.status !== 201) throw new Error(`Pin3 failed: ${r3.status} ${JSON.stringify(r3.body)}`);
  const pin3Id = r3.body.pin?.id ?? r3.body.id;
  console.log(`Pin 3 (retail/BRAVO): ${pin3Id}`);

  console.log('\n✓ All 3 pins created');
  console.log(`  retailPinId:    ${pin1Id}`);
  console.log(`  insurancePinId: ${pin2Id}`);
  console.log(`  bravoPinId:     ${pin3Id}`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
