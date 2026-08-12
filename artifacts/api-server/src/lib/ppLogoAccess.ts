/**
 * PP logo access helper — isolated so the ownership-gate can be unit-tested
 * without spinning up the full Express app or a real database.
 *
 * Security invariant: a signed read URL is ONLY returned when
 * `objectOwnershipTable` contains a row that ties `logoUrl` to `companyId`.
 * This prevents cross-tenant object disclosure when a malicious actor supplies
 * another company's object path during unauthenticated checkout/registration.
 */
import { and, eq } from 'drizzle-orm';
import { objectOwnershipTable } from '@workspace/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Minimal DB interface used by this helper (makes mocking in tests trivial). */
export interface LogoAccessDb {
  select: NodePgDatabase['select'];
}

/**
 * Returns a fresh signed read URL for `logoUrl` **only when** an ownership row
 * exists confirming the path belongs to `companyId`. Returns `null` otherwise.
 *
 * @param companyId       Authenticated PP company ID from the session.
 * @param logoUrl         Raw object path stored on the company row.
 * @param dbInstance      Drizzle DB instance (real or mock).
 * @param getSignedUrl    Signing callback, e.g. objectStorage.tryGetSignedObjectUrl.
 */
export async function getPPLogoSignedUrl(
  companyId: string,
  logoUrl: string | null,
  dbInstance: LogoAccessDb,
  getSignedUrl: (path: string, ttlSec: number) => Promise<string | null>,
): Promise<string | null> {
  if (!logoUrl) return null;

  const [owned] = await dbInstance
    .select({ objectPath: objectOwnershipTable.objectPath })
    .from(objectOwnershipTable)
    .where(
      and(
        eq(objectOwnershipTable.objectPath, logoUrl),
        eq(objectOwnershipTable.companyId, companyId),
      ),
    );

  if (!owned) return null;

  return getSignedUrl(logoUrl, 3600).catch(() => null);
}
