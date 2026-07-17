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
