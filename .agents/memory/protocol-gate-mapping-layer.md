---
name: Protocol gate enforcement is split across two layers
description: Inspection stage gates (S0–S5) are enforced by the tested protocol rules AND by the untested mobile state-mapping layer; qualify inputs in BOTH or a gate is bypassable.
---

# Protocol gate enforcement lives in two layers

The inspection protocol (`lib/protocol`) computes stage deficiencies from an
`InspectionProtocolState`. Those rules are unit-tested. But that state is
produced by `buildProtocolState` in the mobile app
(`artifacts/mobile/lib/inspectionProtocolState.ts`), which maps raw hydrated
records (photos, attestations, test squares…) into the boolean gate flags —
**and there is no test harness in the mobile package** (no vitest/jest,
`pnpm --filter @workspace/mobile` has no `test` script).

**Rule:** when a gate requires a *specific kind* of evidence, qualify it in the
mapping, not just the rule. Two concrete gotchas that passed rules tests but
were bypassable in the mapping:
- An "overview photo captured" flag must require the intended `triadRole`
  (e.g. `wide`), not merely "any photo with `subjectType='test_square'`".
- A "documented inaccessible slope" escape hatch must require
  `stage==='S4' && attestationType==='stage_signoff'` (the full attestation
  contract), not just `details.kind==='inaccessible_slope'`.

**Why:** the rules layer can only be as strict as the state it's handed. A
loose mapping silently satisfies a gate the rules would otherwise flag, and the
green protocol test suite gives false confidence because it tests the rule, not
the mapping.

**How to apply:** any new stage gate → mirror the existing `triadRole`/subject
qualification pattern in `buildProtocolState`, and remember the mapping itself
is only covered by `tsc`, so review it by hand.

**Zone-based Step 5 (Components):** component photos are per-ZONE, not per-record — a shared photo has `subjectType:'component'` + `zone` (`eave_edge`/`ridge_hip`) and NO subjectId. Server rejects `zone` on other subject types and `zone`+`subjectId` together; the orphan-photo check has an explicit zone-photo exception. Penetrations stay per-record. Any new component type must be added to `componentZoneForType` in lib/protocol or its documentation never demands a photo.

**Siding components (positional jsonb):** facet.components[k-1] is S{n}C{k}; a component photo binds via sidingComponentIndex (1-based, only with sidingRole 'component'). When the components array shrinks, both the server patch route and the mobile optimistic cache must UNBIND (null role+index, keep the row) photos with index > new length — otherwise a re-added component silently inherits a stale photo and bypasses the per-component gate.
