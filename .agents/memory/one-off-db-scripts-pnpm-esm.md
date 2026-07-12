---
name: One-off DB scripts fail standalone in this pnpm/ESM workspace
description: tsx/esbuild ad-hoc scripts hit pg dynamic-require and @workspace/db export-resolution errors; use a temporary Express route instead.
---

In this monorepo's environment, there is no `tsx` available, and bundling an
ad-hoc script with esbuild to run a one-off DB migration/backfill reliably
hits either a dynamic-require failure inside `pg` or a directory-import
failure resolving `@workspace/db`'s package export.

**Why:** the workspace's pnpm hoisting + ESM setup doesn't make `pg` resolvable
as a plain `node_modules/pg` outside the `.pnpm` store, and `@workspace/db`
only exposes package-level exports, not deep file imports — both trip up
standalone script bundling even though the same imports work fine inside an
already-building app.

**How to apply:** when you need to run a one-off DB script (backfill, manual
migration, data fix) in an api-server-style app in this workspace, don't reach
for `tsx`/esbuild scripts. Instead: add a temporary internal Express route to
the already-building server, restart its workflow, trigger it once via curl,
then delete the route and revert the router registration. This reuses the
server's own working module resolution instead of fighting a separate bundler.
