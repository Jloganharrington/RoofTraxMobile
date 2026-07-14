---
name: Tenant-scoped privilege seeding in data migrations
description: Any migration that promotes a role or backfills ownership from a cross-table pointer must join through users with a same-company guard.
---

# Tenant-scoped privilege seeding

When a data migration seeds a privileged role (e.g. promoting
`companies.founder_user_id` to `super_admin`) or backfills ownership from a
pointer column, join the target **through `users`** and require
`users.company_id = <owning company>` (and `users.id = <pointer>`).

**Why:** `founder_user_id` (and similar pointer columns) are nullable, may be
stale, and are not FK-guaranteed to belong to the referencing tenant. Inserting
them blindly can (a) abort the whole migration on an FK violation, or (b)
escalate a user from the *wrong* company to a privileged role — a real
cross-tenant privilege-escalation bug caught in review here.

**How to apply:** in every step (the lazy profile insert *and* the role update),
join `users u ON u.id = <pointer> AND u.company_id = <company>`. Make role
seeding idempotent + "first only" with `NOT EXISTS (… role = 'super_admin' …)`
so re-runs never mint a second admin. This project uses `drizzle-kit push` (no
migration files); one-off backfills live as idempotent SQL in `data-migrations/`.
