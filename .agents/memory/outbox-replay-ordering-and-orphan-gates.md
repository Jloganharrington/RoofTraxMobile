---
name: Outbox replay ordering & orphan gate records
description: Two protocol-v2 review lessons — timestamp-only outbox ordering breaks delete-after-create replay, and gate rules must skip records orphaned by a parent delete.
---

**Rule 1:** The mobile outbox must drain in strict insertion order: `ORDER BY createdAt ASC, rowid ASC`. Timestamp-only ordering can replay a delete before its create when rows share timestamp granularity; combined with 404-tolerant deletes ("404 = already gone = success"), the create then lands afterward and resurrects a deleted record.
**Why:** Facet create→delete offline could resurrect the facet on sync.
**How to apply:** Any new outbox query or delete-tolerant handler must preserve the rowid tiebreak and assume deletes may race their creates.

**Rule 2:** Gate/deficiency rules must not hard-block on child records orphaned by a parent delete (e.g. damage records whose slopeId was FK-nulled or points at a deleted facet). Only require evidence for children attached to a *live* parent; otherwise the user has no UI path to clear the deficiency.
**Why:** Deleting a facet left MISSING_DAMAGE_PHOTO deficiencies that were unresolvable from any screen.
**How to apply:** When a rule iterates child records, filter to those whose parent id is in the live-parent set first. Builders coerce null slopeId to `''`, so filter via set membership, not null checks.

## Dead-lettered items must still block submission
Permanently rejected (4xx) outbox items are marked `dead` and never retried — but readiness/unsynced counts MUST include `dead` rows, or a package silently submits with evidence that never reached the server.
**Why:** dropping poisoned items from retry AND from the pending count broke the "submit only when fully drained" guarantee (caught in review).
**How to apply:** any new status that removes items from the drain loop must be added to `countUnsyncedWritesForInspection`-style gating queries.

- Editable child records (toggle-style UI) need: 404-tolerant replay on BOTH delete and update handlers (a queued update can trail a local delete), and a synchronous ref-based in-flight guard in the tap handler — React `disabled` state alone can't stop a double-tap from enqueuing conflicting ops.

**Self-sufficient gated patches:** any server-side 4xx gate on a PATCH field (e.g. preliminaryCompletedAt requires >=1 damage surface) can dead-letter a replayed outbox item and permanently count as an unsynced write. Client patches that trip such gates must carry the qualifying fields in the SAME patch (server evaluates the merged state), so a replay can never 400.
