#!/bin/bash
set -e

# Install / reconcile dependencies. Use --no-frozen-lockfile because task agents
# may add or remove packages, leaving the lockfile out of sync with package.json.
pnpm install --no-frozen-lockfile

# Push any pending DB schema changes.
pnpm --filter db push
