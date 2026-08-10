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

# Push any pending DB schema changes.
pnpm --filter db push
