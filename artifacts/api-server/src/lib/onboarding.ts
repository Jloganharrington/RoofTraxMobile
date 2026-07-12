import { companiesTable, db, userProfilesTable, usersTable, type User } from '@workspace/db';
import { eq } from 'drizzle-orm';

export class MissingCompanyError extends Error {
  constructor() {
    super('A companyId is required to create a new account');
  }
}

export class CompanyNotFoundError extends Error {
  constructor(public companyId: string) {
    super(`No company with ID "${companyId}"`);
  }
}

export interface Claims {
  sub: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
  picture?: string | null;
}

// Company assignment is a one-time decision made the moment an account is
// first created (via the "join or create a company" screen). Every login
// afterward must ignore any companyId it is handed and keep the user's
// original company — otherwise a stale link or reused query param could
// silently move someone into a different tenant.
export async function upsertUserOnLogin(
  claims: Claims,
  companyId?: string,
): Promise<User> {
  const profileFields = {
    email: claims.email ?? null,
    firstName: claims.first_name ?? null,
    lastName: claims.last_name ?? null,
    profileImageUrl: (claims.profile_image_url ?? claims.picture) ?? null,
  };

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claims.sub));

  if (existing) {
    const [updated] = await db
      .update(usersTable)
      .set({ ...profileFields, updatedAt: new Date() })
      .where(eq(usersTable.id, claims.sub))
      .returning();
    return updated;
  }

  const normalizedCompanyId = companyId?.trim().toUpperCase();
  if (!normalizedCompanyId) {
    throw new MissingCompanyError();
  }

  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, normalizedCompanyId));
  if (!company) {
    throw new CompanyNotFoundError(normalizedCompanyId);
  }

  const [created] = await db
    .insert(usersTable)
    .values({ id: claims.sub, companyId: normalizedCompanyId, ...profileFields })
    .returning();

  // First person to ever log in for a company founds it and becomes admin.
  if (!company.founderUserId) {
    await db
      .update(companiesTable)
      .set({ founderUserId: created.id })
      .where(eq(companiesTable.id, normalizedCompanyId));

    await db
      .insert(userProfilesTable)
      .values({ userId: created.id, role: 'admin' })
      .onConflictDoNothing();
  }

  return created;
}
