/**
 * Phase 4 — UI Screenshot Script
 * Creates sessions for all 10 test users, injects the `sid` cookie into
 * Playwright, and takes a dashboard screenshot for each.
 *
 * Usage: npx tsx src/scripts/phase4-screenshots.ts
 */

import { chromium } from 'playwright';
import { createSession } from '../lib/auth';
import path from 'path';
import fs from 'fs';

const OUT_DIR = '/tmp/phase4';
fs.mkdirSync(OUT_DIR, { recursive: true });

// rooftrax-web is proxied through localhost:80 at /rooftrax-web/
const BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:80/rooftrax-web';

const USERS = [
  { actor: 'A-CANV-1', id: '96180b99-792c-4b45-b0bd-304f36833b4f', email: 'a-canv-1@zztest.local', companyId: 'ZZTEST_ALPHA', role: 'field_rep/canvasser' },
  { actor: 'A-CANV-2', id: '2c820f0f-53c7-452c-b8ac-e5089193e4fb', email: 'a-canv-2@zztest.local', companyId: 'ZZTEST_ALPHA', role: 'field_rep/canvasser' },
  { actor: 'A-INSP-1', id: 'db57382f-a01e-414f-8663-fdcd74edbe9e', email: 'a-insp-1@zztest.local', companyId: 'ZZTEST_ALPHA', role: 'field_rep/inspector' },
  { actor: 'A-OFF-1',  id: '111f07e0-3d06-4784-a21a-6c424550ba8f', email: 'a-off-1@zztest.local',  companyId: 'ZZTEST_ALPHA', role: 'field_rep/office' },
  { actor: 'A-MGR-F',  id: '74a553ae-b375-4af0-85b8-530a39ee8f02', email: 'a-mgr-f@zztest.local',  companyId: 'ZZTEST_ALPHA', role: 'manager' },
  { actor: 'A-MGR-O',  id: '0625a922-0b48-4bc6-8280-2b291921f26e', email: 'a-mgr-o@zztest.local',  companyId: 'ZZTEST_ALPHA', role: 'manager' },
  { actor: 'A-ADMIN',  id: '2e7597e6-3ca8-4c0e-9cf8-80a0730308ca', email: 'a-admin@zztest.local',  companyId: 'ZZTEST_ALPHA', role: 'admin' },
  { actor: 'A-SUPER',  id: '45b1b81f-902e-4e28-b410-2a79f57778d3', email: 'a-super@zztest.local',  companyId: 'ZZTEST_ALPHA', role: 'super_admin' },
  { actor: 'B-ADMIN',  id: 'e01aa5cd-f6f9-4092-b7d0-5160930b4ee9', email: 'b-admin@zztest.local',  companyId: 'ZZTEST_BRAVO', role: 'admin' },
  { actor: 'B-REP',    id: 'ff669c7d-2cb6-48a7-b66b-d62eab4b5d72', email: 'b-rep@zztest.local',    companyId: 'ZZTEST_BRAVO', role: 'field_rep/canvasser' },
];

type UserResult = {
  actor: string;
  role: string;
  sid: string;
  screenshotPath: string;
  navItems: string[];
  widgets: string[];
  error?: string;
};

async function screenshotUser(user: typeof USERS[0]): Promise<UserResult> {
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.actor,
      lastName: 'ZZTEST',
      profileImageUrl: null,
      companyId: user.companyId,
    },
    access_token: `phase4-${user.actor}`,
  });

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Inject the session cookie — cookie is named 'sid', domain is localhost
  await context.addCookies([{
    name: 'sid',
    value: sid,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false, // http in dev
    sameSite: 'Lax',
  }]);

  const page = await context.newPage();
  const result: UserResult = { actor: user.actor, role: user.role, sid, screenshotPath: '', navItems: [], widgets: [] };

  try {
    // Navigate to the dashboard
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for either the dashboard grid or the loading spinner to resolve
    await page.waitForSelector('[data-testid="dashboard-grid"], .grid, main, [class*="dashboard"]', {
      timeout: 15000,
    }).catch(() => console.log(`  ${user.actor}: no dashboard selector found, proceeding`));

    // Extra wait for widgets to load
    await page.waitForTimeout(3000);

    // Collect visible nav items
    result.navItems = await page.$$eval('nav a, nav button, aside a, aside button, [role="navigation"] a',
      (els) => [...new Set(els.map(el => (el as unknown as { textContent?: string | null }).textContent?.trim()).filter(Boolean))] as string[]
    );

    // Collect visible widget text/headings
    result.widgets = await page.$$eval(
      '[class*="widget"], [class*="card"], h2, h3',
      (els) => [...new Set(els.slice(0, 30).map(el => (el as unknown as { textContent?: string | null }).textContent?.trim()?.slice(0, 60)).filter(Boolean))] as string[]
    );

    const screenshotPath = path.join(OUT_DIR, `${user.actor}-dashboard.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshotPath = screenshotPath;
    console.log(`  ✓ ${user.actor} (${user.role}): screenshot saved → ${screenshotPath}`);
    console.log(`    nav items: ${result.navItems.slice(0, 8).join(', ')}`);
    console.log(`    widgets sample: ${result.widgets.slice(0, 5).join(' | ')}`);
  } catch (err) {
    result.error = String(err);
    console.error(`  ✗ ${user.actor}: ${result.error}`);
  }

  await browser.close();
  return result;
}

async function main() {
  console.log('Phase 4 — UI Screenshot sweep');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Output dir: ${OUT_DIR}\n`);

  const results: UserResult[] = [];
  // Run sequentially to avoid DB contention
  for (const user of USERS) {
    const r = await screenshotUser(user);
    results.push(r);
  }

  // Write summary JSON
  const summaryPath = path.join(OUT_DIR, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\nSummary written to ${summaryPath}`);

  // Print table
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║ Actor    │ Role               │ Nav count │ Widget count │ OK  ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  for (const r of results) {
    const ok = r.error ? '✗' : '✓';
    console.log(`║ ${r.actor.padEnd(8)} │ ${r.role.padEnd(18)} │ ${String(r.navItems.length).padEnd(9)} │ ${String(r.widgets.length).padEnd(12)} │ ${ok}   ║`);
  }
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
