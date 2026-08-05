/**
 * Integration tests for IICRC citation placeholder runtime (Task #249).
 *
 * Verifies:
 * - The assembled prompt for a section with humanEnteredProvisionsOnly entries
 *   contains ZERO occurrences of 'S500', 'S520' as provision text
 * - The mocked AI response containing a placeholder token is stored verbatim
 * - The generated section carries an iicrc_citation_unfilled lint finding
 * - The approve route returns 422 while unfilled placeholders exist
 */

import {
  claimSectionsTable,
  companiesTable,
  db,
  inspectionsTable,
  standardsEntriesTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// ---------------------------------------------------------------------------
// Mock Gemini AI so tests don't make live API calls.
// The mock captures the prompt and returns a response containing the
// IICRC placeholder token — simulating a model that obeyed the directive.
// ---------------------------------------------------------------------------

let lastPromptSent = '';

vi.mock('@workspace/integrations-gemini-ai', () => ({
  ai: {
    models: {
      generateContent: vi.fn(
        async ({ contents }: { contents: Array<{ parts: Array<{ text: string }> }> }) => {
          lastPromptSent = contents?.[0]?.parts?.[0]?.text ?? '';
          // Simulate the AI obeying the IICRC directive by emitting the placeholder token
          // instead of any IICRC S500/S520 provision text.
          return {
            text:
              '<p>Based on the field record, interior water damage restoration methodology requires ' +
              '{{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}} compliance for all drying procedures.</p>',
          };
        },
      ),
    },
  },
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const RUN_ID = `iicrc-${Date.now().toString(36)}`;

interface SeededUser {
  companyId: string;
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: 'field_rep' | 'manager' | 'super_admin',
  department: 'inspector_canvasser' | 'canvasser',
  companyId: string,
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `iicrc-${label}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });
  return { companyId, userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('IICRC filter runtime — section generation route', () => {
  const companyId = `TEST-IICRC-${RUN_ID}`.toUpperCase();
  let inspector: SeededUser;
  let manager: SeededUser;
  let inspectionId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: companyId, name: 'IICRC Test Co' });

    inspector = await seedUser('inspector', 'field_rep', 'inspector_canvasser', companyId);
    manager = await seedUser('manager', 'manager', 'inspector_canvasser', companyId);
    userIds.push(inspector.userId, manager.userId);

    // Create a minimal inspection row. Full protocol data isn't required for
    // generation (the prompt just produces minimal content from what's present).
    const [inspection] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        inspectorUserId: inspector.userId,
        roofDamageFound: true,
        interiorDamageFound: true,
      })
      .returning();
    inspectionId = inspection.id;

    // Seed STD-WTR-01 as humanEnteredProvisionsOnly for this company.
    await db.insert(standardsEntriesTable).values({
      companyId,
      entryKey: 'STD-WTR-01',
      title: 'IICRC S500 Standard for Professional Water Damage Restoration',
      sourceType: 'IICRC',
      humanEnteredProvisionsOnly: true,
      verificationStatus: 'verify_before_ship',
      version: 1,
      createdBy: inspector.userId,
    });
  });

  afterAll(async () => {
    await db
      .delete(claimSectionsTable)
      .where(eq(claimSectionsTable.inspectionId, inspectionId));
    await db
      .delete(standardsEntriesTable)
      .where(eq(standardsEntriesTable.companyId, companyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it('generates successfully and returns 200', async () => {
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.contentHtml).toBeDefined();
  });

  it('assembled prompt contains ZERO occurrences of S500 or S520 as provision text', async () => {
    // Regenerate to capture a fresh prompt (findings section, no upstream deps).
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});

    expect(res.status).toBe(200);

    // The only allowable mention of S500/S520 in the prompt is inside the
    // "Do not write" / "must NOT" prohibition line of the IICRC directive.
    for (const pattern of ['S500', 'S520']) {
      const matches = [...lastPromptSent.matchAll(new RegExp(pattern, 'g'))];
      for (const match of matches) {
        const idx = match.index!;
        const lineStart = lastPromptSent.lastIndexOf('\n', idx);
        const lineEnd = lastPromptSent.indexOf('\n', idx);
        const line = lastPromptSent.slice(
          lineStart === -1 ? 0 : lineStart,
          lineEnd === -1 ? undefined : lineEnd,
        );
        expect(line, `"${pattern}" found outside prohibition line`).toMatch(
          /Do not write|must NOT/i,
        );
      }
    }
  });

  it('generated content contains the IICRC placeholder token', async () => {
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.contentHtml).toContain('{{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}}');
  });

  it('stored section row carries an iicrc_citation_unfilled lint finding', async () => {
    // Ensure there is a generated row by generating once more.
    const genRes = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});
    expect(genRes.status).toBe(200);

    const [sectionRow] = await db
      .select()
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          eq(claimSectionsTable.sectionType, 'findings'),
        ),
      )
      .limit(1);

    expect(sectionRow).toBeDefined();
    const findings = (sectionRow!.lintFindings as Array<{ ruleId: string }>) ?? [];
    const iicrcFinding = findings.find((f) => f.ruleId === 'iicrc_citation_unfilled');
    expect(iicrcFinding).toBeDefined();
  });

  it('approve route returns 422 when unfilled IICRC placeholders exist', async () => {
    // Ensure the section exists in generated state.
    const genRes = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});
    expect(genRes.status).toBe(200);

    // Attempt to approve — should be blocked because the placeholder is unfilled.
    const approveRes = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/approve`)
      .set(auth(inspector.sid))
      .send({});

    expect(approveRes.status).toBe(422);
    expect(approveRes.body.error).toMatch(/unfilled IICRC citation placeholder/i);
    expect(approveRes.body.unfilledCount).toBeGreaterThan(0);
  });

  it('section stays in generated state after a blocked approve attempt', async () => {
    const [sectionRow] = await db
      .select({ state: claimSectionsTable.state })
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          eq(claimSectionsTable.sectionType, 'findings'),
        ),
      )
      .limit(1);

    expect(sectionRow?.state).toBe('generated');
  });

  it('fill-iicrc-citations clears unfilled findings → approve succeeds (happy path)', async () => {
    // Ensure a fresh generated section with placeholder tokens.
    const genRes = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});
    expect(genRes.status).toBe(200);
    expect(genRes.body.contentHtml).toContain('{{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}}');

    // Submit fills for the placeholder.
    const fillRes = await request(app)
      .patch(`/api/inspections/${inspectionId}/sections/findings/fill-iicrc-citations`)
      .set(auth(inspector.sid))
      .send({
        citations: {
          'STD-WTR-01': {
            citationText:
              'Water damaged materials shall be dried using the psychrometric principles documented herein.',
            locator: 'S500 Section 7.3.2, p. 44',
          },
        },
      });

    expect(fillRes.status).toBe(200);
    expect(fillRes.body.filledCount).toBe(1);
    expect(fillRes.body.remainingUnfilled).toEqual([]);

    // Verify the iicrc_citation_unfilled finding was removed from the DB row.
    const [filledRow] = await db
      .select({ lintFindings: claimSectionsTable.lintFindings })
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          eq(claimSectionsTable.sectionType, 'findings'),
        ),
      )
      .limit(1);

    const remainingIicrc = (
      (filledRow!.lintFindings as Array<{ ruleId: string }>) ?? []
    ).filter((f) => f.ruleId === 'iicrc_citation_unfilled');
    expect(remainingIicrc).toHaveLength(0);

    // Approve should now succeed (no unfilled findings).
    const approveRes = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/approve`)
      .set(auth(inspector.sid))
      .send({});

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.state).toBe('approved');
  });

  it('auto-approve also enforces IICRC gate', async () => {
    // Generate a fresh section to reset it to generated state with unfilled tokens.
    await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/generate`)
      .set(auth(inspector.sid))
      .send({});

    // Auto-approve (manager) should also be blocked before fills.
    const autoApproveRes = await request(app)
      .post(`/api/inspections/${inspectionId}/sections/findings/auto-approve`)
      .set(auth(manager.sid))
      .send({});

    expect(autoApproveRes.status).toBe(422);
    expect(autoApproveRes.body.unfilledCount).toBeGreaterThan(0);
  });
});
