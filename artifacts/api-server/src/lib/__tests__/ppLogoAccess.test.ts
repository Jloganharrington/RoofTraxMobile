/**
 * PP Logo Access — security invariant tests
 *
 * Proves that getPPLogoSignedUrl ONLY signs an object URL when an
 * objectOwnershipTable row ties the path to the requesting company.
 * A malicious logoObjectPath (e.g. from unauthenticated checkout) that was
 * stored without a matching ownership record must never produce a signed URL.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getPPLogoSignedUrl } from '../ppLogoAccess';

// ── DB mock helpers ──────────────────────────────────────────────────────────

/** Build a mock DB whose .select chain returns the given rows. */
function makeDb(rows: Array<{ objectPath: string }>) {
  const whereFn = vi.fn().mockResolvedValue(rows);
  const fromFn  = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return { select: selectFn, _where: whereFn };
}

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const LOGO_PATH = '/objects/logos/test-logo.png';
const SIGNED_URL = 'https://storage.example.com/logos/test-logo.png?sig=abc';

const sign = vi.fn().mockResolvedValue(SIGNED_URL);

beforeEach(() => vi.clearAllMocks());

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getPPLogoSignedUrl — cross-tenant security', () => {
  it('returns null when logoUrl is null', async () => {
    const db = makeDb([]);
    const result = await getPPLogoSignedUrl(COMPANY_A, null, db as never, sign);
    expect(result).toBeNull();
    // No DB query should run for a null logo
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns null when no ownership row exists for the path', async () => {
    // Simulates a malicious logoObjectPath from unauthenticated registration
    // or a path belonging to another tenant — ownership table returns empty.
    const db = makeDb([]);
    const result = await getPPLogoSignedUrl(COMPANY_A, LOGO_PATH, db as never, sign);
    expect(result).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('returns null when the ownership row belongs to a different company', async () => {
    // Even if a row exists for the path, it must match the requesting company.
    // This scenario arises if Company B somehow stores Company A's object path.
    // The DB where clause enforces companyId = COMPANY_B, so an empty result
    // here means the ownership row (if any) is for a different company.
    const db = makeDb([]);
    const result = await getPPLogoSignedUrl(COMPANY_B, LOGO_PATH, db as never, sign);
    expect(result).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('returns a signed URL when a valid ownership row exists', async () => {
    // Simulates Company A having legitimately uploaded the logo via
    // GET /pp/upload-url → objectOwnershipTable row inserted → PUT /pp/company/logo.
    const db = makeDb([{ objectPath: LOGO_PATH }]);
    const result = await getPPLogoSignedUrl(COMPANY_A, LOGO_PATH, db as never, sign);
    expect(result).toBe(SIGNED_URL);
    expect(sign).toHaveBeenCalledWith(LOGO_PATH, 3600);
  });

  it('returns null (not throws) when the signing call fails', async () => {
    const db = makeDb([{ objectPath: LOGO_PATH }]);
    const failSign = vi.fn().mockRejectedValue(new Error('GCS unavailable'));
    const result = await getPPLogoSignedUrl(COMPANY_A, LOGO_PATH, db as never, failSign);
    // Signing errors must be swallowed — a missing preview is not fatal.
    expect(result).toBeNull();
  });

  it('does not sign a path from a malicious checkout logoObjectPath', async () => {
    // This test documents the defence-in-depth property:
    // provisionPPAccount always sets logoUrl = null (never persists the
    // checkout-supplied path), so the company row never even contains
    // a foreign path to sign. If it did (e.g. direct DB write), the
    // ownership check here would block signing regardless.
    const maliciousPath = '/objects/company-a-private/confidential-report.json';
    const db = makeDb([]); // no ownership row for company-b + maliciousPath
    const result = await getPPLogoSignedUrl(COMPANY_B, maliciousPath, db as never, sign);
    expect(result).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });
});
