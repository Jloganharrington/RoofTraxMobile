#!/bin/bash
set -e

# Install / reconcile dependencies. Use --no-frozen-lockfile because task agents
# may add or remove packages, leaving the lockfile out of sync with package.json.
pnpm install --no-frozen-lockfile

# Rebuild lib/authz declarations (dist/ is gitignored; stale .d.ts breaks tsc
# whenever a task agent adds exports to lib/authz/src/).
cd lib/authz && npx tsc --build
cd "$OLDPWD"

# Rebuild lib/db declarations (same reason).
cd lib/db && npx tsc --build
cd "$OLDPWD"

# Schema migrations are NOT applied automatically on merge.
# See data-migrations/README.md — "Applying schema changes" — for the exact
# command and when to run it.  The push step was removed because the interactive
# TTY prompt drizzle-kit issues for new unique constraints cannot be answered in
# a non-interactive merge environment, and a silent failure there would leave the
# production DB out of sync with no indication.
