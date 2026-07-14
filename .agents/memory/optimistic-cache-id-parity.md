---
name: Optimistic cache id parity with durable write id
description: Offline-first optimistic cache rows must use the same client id as the outbox/server write, and manifest/aggregate builders must only run over a synced package.
---

# Optimistic cache rows must carry the durable record id

When an offline-first create writes both (a) an optimistic row into the query
cache for instant UI/gate progress and (b) an outbox item that later performs
the idempotent server write, **both must use the same client-generated id**.

**Why:** any downstream feature that assembles data *from the cache* — e.g. the
inspection submission manifest, which lists record ids and photo hashes — will
otherwise bake in throwaway placeholder ids (the classic bug: a `pending:<uuid>`
cache id while the outbox payload/server row uses a different real uuid). The
server write is thin (no verification, M-F seam), so it happily stores a
manifest referencing ids that never persist — a silently invalid package that
only surfaces much later at verification/lock time.

**How to apply:**
- Generate the id once at capture time, pass it into BOTH the outbox payload and
  the optimistic-cache helper. Never mint a second id inside the cache helper.
- The server create must be idempotent on that client id (upsert / onConflict).
- For any "assemble a package/manifest from cache" step, gate it on the outbox
  being fully drained for that entity (count still-syncable items sharing the
  `inspectionId`, excluding the submission item itself). A permanently-failing
  child then shows as "still uploading" instead of producing a package that
  references an un-persisted record. This is separate from FIFO drain ordering —
  ordering alone does not guarantee the dependency actually succeeded.
