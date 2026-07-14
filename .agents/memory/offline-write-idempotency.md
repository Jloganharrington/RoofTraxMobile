---
name: Offline-first write idempotency (outbox replays)
description: Rules for making inspection child/photo creates safe to replay from the mobile outbox — client ids + parent-scoped conflict lookups.
---

# Offline-first write idempotency

The mobile app queues inspection writes in an outbox and drains them on
reconnect; a write can replay if the server commits but the response is lost.
Two rules keep replays from corrupting the evidentiary record.

## 1. Every replayable create needs a client-supplied id
Any create kind that flows through the outbox (child rows: slope / elevation /
damage; **and photos**; and attestations) must carry a client-generated `id`
so the server can upsert idempotently (201 insert / 200 existing / 409). Photos
were the easy one to miss because the handler uploads a file first — a replay
re-uploads (orphan object, harmless) but must NOT duplicate the DB row.

**Why:** without the id, a lost-response replay creates a duplicate evidence
row, inflating triad/gate counts and breaking the audit trail.

**How to apply:** when adding a new outbox write kind, add optional `id` to its
`Create*Input` in `lib/api-spec/openapi.yaml`, regenerate, and generate the id
on the client (`Crypto.randomUUID()`) at enqueue time — never let the server
mint it for queued writes.

## 2. Conflict-resolution lookups must be scoped to the parent, not just id+company
On an id collision (`onConflictDoNothing` returned nothing), the "fetch the
existing row and return 200" lookup must filter by the **parent** key
(`inspectionId`) in addition to `id` + `companyId`. If it only matches
id+companyId, a client id reused across a different inspection in the same
tenant silently returns the wrong inspection's row as a "successful retry".

**Why:** idempotency means "this exact create already happened" — a row under a
different parent is a genuine conflict, so it must 409, not 200.

**How to apply:** mirror the existing slope/elevation/damage/photo handlers in
`artifacts/api-server/src/routes/inspections.ts` — the existing-row `select`
includes `eq(table.inspectionId, inspectionId)`. Cross-tenant collisions
already 409 because the lookup is company-scoped; the parent scope closes the
same-tenant-different-parent gap.
