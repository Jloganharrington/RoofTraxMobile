---
name: Inspection authorization layers
description: The three distinct authz checks an inspection write must pass; company scope is not authorization.
---

# Inspection authorization is three separate layers

An inspection write in the api-server must clear three independent checks, in order. Missing any one is a security hole — they are NOT interchangeable:

1. **Module access** (department + role): `canAccessInspectionModule(role, dept)` — can this user reach the inspection feature at all? (dept `inspector_canvasser`, or `super_admin`). This is a *feature gate*, not a *record gate*.
2. **Tenant scope** (company): the record must be loaded scoped to the actor's `companyId` (404 if not) — cross-company isolation.
3. **Record write authority** (ownership OR rank): `canWriteInspection(role, actorId, inspectorUserId)` = actor is the assigned inspector OR manager+/super_admin. A same-company *peer* field rep passes (1) and (2) but must fail (3).

**Why:** A review found writes authorized by company only — a same-tenant peer could mutate another rep's inspection because they cleared module access + company scope. "Can reach the module" and "is in the same company" together are still not "may edit *this* record."

**How to apply:**
- Route every inspection write (PATCH incl. storm-confirm/arrival, and all child-write POSTs: slopes, elevations, damage-instances, test-squares, hits, photos, measurements, attestations) through the load-then-authorize helper (`loadWritableInspection`): company-scoped load → 404, then `canWriteInspection` → 403. Order matters: 404-before-403 so cross-company probes can't distinguish "exists but forbidden" from "not found".
- **Creation is a fourth concern**: `POST /inspections` establishes ownership, so gate *assignment* there — a field rep may only create for self; manager+ may assign to another user, and the assignee must be validated as same-company (else the create path becomes an ownership-spoofing / orphaning hole).
- Null `inspectorUserId` (nullable column) intentionally falls through to manager-only — safe default; don't "fix" it into owner-any.
