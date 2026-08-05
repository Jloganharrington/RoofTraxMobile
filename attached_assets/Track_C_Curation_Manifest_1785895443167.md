# Track C — Curation Manifest Completion (P1)
SCOPE: exhibit slot manifest derivation, comparison-type enum, pair-builder UI labels, captions generator branching for comparison sets. DO NOT touch: compile/attest code, badge assignment mechanics, standards/detriment data, pipeline stages.

Fixes audit finding F-9 (cause_differentiation comparison type absent) and completes verification of the earlier remediation Fix 4 (comparison vocabulary), which F-9 indicates only partially ran.

## 1. Comparison-type enum (verify + complete)
The enum must be exactly: 'recency' | 'cause_differentiation' | 'covered_vs_unrelated'. Currently only recency and covered_vs_unrelated exist.
- Add cause_differentiation everywhere the enum lives: schema, manifest derivation, pair builder, captions generator, any zod validators.
- Grep for any pre_loss_post_loss or pre-loss remnants — remove/migrate (map to 'recency').

## 2. Manifest derivation — cause_differentiation slot
Add to the deterministic slot derivation: a comparison_cause_differentiation slot is included when BOTH candidate sides exist in the attested record:
- Side A (localized condition): photos tagged with localized damage condition codes on a facet (impact/damage close-up classes).
- Side B (general weathering): photos documenting uniform/age-related surface condition (pre-existing/unrelated class with age-wear character, or facet-overview photos flagged with general-weathering notes).
Slot is omitted when either side lacks candidates — no empty homework, same rule as the other comparison slots. Peril gating: include for hail claims always-evaluated; for wind claims evaluate when granule/surface-wear documentation exists (the wear-and-tear differentiation applies to both perils — do not hail-gate this slot).

## 3. Pair builder + captions
- Pair builder UI: third type chip "Cause differentiation" with one-line description: "Localized event condition vs. general age-related weathering."
- Captions generator: branch per the caption library Class 6 — one set caption + one caption per photo stating precisely what that photo contributes. Cause-differentiation caption pattern: set caption "Comparison — localized impact condition (top) and general surface weathering (bottom), {facet}."; top caption states the distinct localized condition; bottom caption states the uniform condition documented as age-related surface wear. Follow the softened-wording rules (conditions 'documented as', never asserted beyond the record).
- Confirming the pair card remains the photoComparisonConfirmed gate act — no change to gate mechanics.

## 4. Tests
- Manifest derivation: claim with both-side candidates → slot present; claim missing side B → slot absent.
- Enum: zod/schema round-trip for all three types; zero pre_loss remnants (grep output in PR).
- Caption generation: a confirmed cause_differentiation pair produces a three-caption set matching the Class 6 structure.

Run the full test suite.
