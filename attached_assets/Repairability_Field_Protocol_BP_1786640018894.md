# Repairability Assessment Field Protocol — v1.2
<!-- BOILERPLATE MODULE — Section: repairability_field_protocol -->
<!-- Classification: [BP] per-tenant, VERSION-CONTROLLED. Reports cite this document by name and version (STD-RPR-INT-01). -->
<!-- Template variables: {{company_name}} -->
<!-- Alignment reference: STD-RPR-01 (Williams, JNAFE 37(1) 2020) via the STD-RPR-01 Source Record. Deviations from the published method are recorded in §9 — never left implicit. -->
<!-- App implementation: Repairability module, field app Stage 7 path. Every numbered item below corresponds to a structured capture element. -->

## 1. Gate and Scope

The repairability assessment is performed only where recorded as **warranted and authorized** at Stage 7 of the Uniform Inspection Procedure. Where the assessment is not performed, the gate reason is recorded (Not Warranted — Discontinued; Not Authorized), and no repairability conclusion is drawn from an unperformed assessment. The assessment supplements the damage documentation completed in Stage 6; it is never performed in place of it (Source Record P12).

Assessment target (roof or siding) and covering type are recorded. This protocol version covers **asphalt shingle** roof coverings; other covering types proceed under their own protocol modules when published.

## 2. Conditions of Assessment

Environmental conditions are recorded twice. The Stage 2 Arrival Record establishes conditions on arrival. An **assessment-start conditions capture** is then recorded immediately before seal release at Stage 7, timestamped, and comprising: air temperature, wind speed and gusts, surface moisture state, precipitation status, and sky conditions. Conditions can change materially between arrival and Stage 7; the assessment-start capture is the record that governs the assessment, and where it differs from arrival both stand in the record.

The published method's environmental windows (air temperature 40–90°F; wind gusts under 25 mph; dry surfaces; no imminent precipitation; in-season testing preferred — Source Record P6) are the reference conditions. Where the assessment-start conditions fall outside those windows, the record notes the specific departure and its bearing on the results, consistent with the published method's off-season guidance that testing mirror the conditions of the anticipated repair. Where conditions change materially during the assessment, the change is recorded with its timestamp and the step at which it occurred.

## 3. Test Area Selection

The subject shingle is an **already-damaged field shingle** wherever available — a shingle with documented event-related physical damage in the Stage 6 record — on a slope where damage has been identified (Source Record P5). Where no damaged shingle is usable, the assessment is performed on a slope with identified damage, and the basis is recorded with a note (the published method's stated fallback).

Selection criteria are confirmed individually in the field application before marking begins, and the confirmations are transmitted with the assessment record: subject shingle full-length and uncut; at least two courses above any eave (a minimum, not a fixed position); at least one full shingle length from any rake, valley, or hip; no vents, penetrations, or appurtenances within the assessment area; and an assessment area representative of the overall roof exposure (not sheltered by trees or adjacent structures). Where roof surfaces include shingles of different types or installation dates, an assessment is performed for each damaged type.

## 4. Marking and Baseline (RAP1 / RAP1-D)

1. Identify the damaged field shingle to be pulled and mark it "X."
2. Mark the shingles directly below X as **1 and 2**.
3. Mark the shingles left and right of X as **3 and 4**.
4. Mark the two shingles above X as **5 and 6**.
5. Mark the shingles above 5 and 6 as **7 and 8**, where the layout requires their manipulation.
6. Record the number of shingles requiring manipulation to complete the protocol (**6, 7, or 8**).
7. Mark any pre-existing damage within the assessment area in a distinct, distinguishable manner before any manipulation, so that pre-existing conditions are separated from assessment-induced conditions in the photographic record.
8. Photograph the marked assessment area (**RAP1** — post-markup, pre-manipulation baseline), framed so that every shingle number within the assessment area is legible in the image.
9. Photograph each numbered shingle individually at baseline (**RAP1-D** detail set), each image sufficient to establish that shingle's pre-manipulation condition on its own. RAP1 establishes the layout, numbering, and marked pre-existing conditions; the RAP1-D set establishes each shingle's condition. An outcome recorded in §7 for a shingle without a RAP1-D baseline image is recorded, and the absence of the baseline detail is recorded with it.

## 5. Pull Sequence

1. Break all seals securing the assessment area using a standard flat bar or 5-in-1 painter's tool.
2. Locate and gently remove all nails fastening shingle X.
3. Pull shingle X.
4. Record whether **Shingle 1** and **Shingle 2** each sustained mat transfer during the removal process (individually determined, Yes/No).
5. While X is removed, observe and photograph the exposed underlayment at the removal location; record any damage attributable to the removal process.

## 6. Replace and Re-Secure

1. Replace shingle X to its original location.
2. Without over-lifting the surrounding shingles, properly re-nail all removed fasteners in **new hole locations**, straight and flush.
3. Verify re-seating by hand-tapping the surface of all manipulated shingles at approximately six-inch intervals (by hand only — no tool).

*Conditional variant — sample retention:* where laboratory product identification has been recommended (product_id_class = lab_recommended) and a manufacturer-compliant replacement shingle is available on site, shingle X may instead be **retained as the laboratory sample** and a new shingle installed and secured per the manufacturer's instructions. The variant used is recorded. (Aligns with Source Record P13 and the published method's step 8.)

## 7. Outcome Determination

For each condition question, an affirmative answer opens per-shingle selection (shingles 3–8; shingles 1 and 2 carry their own mat-transfer determinations in §5), one example photograph, and a photo note identifying the shingle and the observed condition:

1. **Delamination** sustained by any shingle (laminate sheet separation).
2. **Creasing, cracking, or fracturing** sustained by any shingle.
3. **Nail pull-through or nail-zone damage** sustained by any shingle.
4. **Puncture, tearing, or gouging** sustained while seals were being released.
5. **Failure to re-seat flat or to be properly re-secured** after replacement of X.

Pre-existing conditions marked under §4.7 are excluded from all outcome determinations; only conditions arising from the assessment are recorded as outcomes (Source Record P4).

## 8. Scorecard and Derived Measures

The scorecard records: manipulated-shingle count; new collateral-damaged shingle count; mat-transfer findings on shingles 1–2; and per-condition counts for delamination, creasing/cracking/fracture, nail-zone damage, puncture/tear/gouge, and **re-seat / re-secure outcome**.

The re-seat / re-secure outcome records what §6.3 actually verifies: whether each manipulated shingle lies flat and was properly re-secured. It is not a finding about the factory sealant bond. Whether the sealant bond has been restored, and whether a field-applied adhesive restores the identified product's listed wind-resistance configuration, are separate product-specific questions determined from that product's installation instructions and listing — not from this scorecard field.

Derived at processing (Members application), consistent with the published method's reporting definitions:

- **Damage rate** — the number of *unique* shingles (1–8) that sustained any assessment-induced condition, counted once per shingle regardless of how many condition types it sustained (Source Record P4). Damage to shingle X itself is documented where noteworthy but excluded from the rate.
- **Damage ratio** — the damage rate over the number of shingles manipulated, reported as "(rate) to (manipulated count)."
- **Total repairability assessment score** — the damage rate plus the general-conditions score (deterioration, installation errors, prior repairs, manufacturing defects, material obsolescence, visual incompatibility — scored not-present/present/limiting from the attested inspection record, per Source Record P10), evaluated against the published thresholds. The general-conditions inputs are drawn from the Stage 6 record and the product-identification record; they are not re-judged at the roof edge.

## 9. Recorded Deviations from the Published Method
*(per the Source Record's rule: deviations are recorded, not left implicit)*

1. **Personnel.** The published method contemplates a licensed professional engineer as evaluator with an independent roofing contractor performing manipulations. This protocol is performed by {{company_name}}'s credentialed inspector as a contractor assessment. Reports cite alignment with the method's mechanics, never performance under the published method (Source Record, Alignment Constraint 1).
2. **Reinstatement of X.** The published method installs a new manufacturer-compliant shingle. This protocol's default reinstates the original shingle X with fasteners in new hole locations, returning the roof to an as-found configuration without introducing repair materials; the new-shingle path is the conditional variant in §6. The default is the less invasive procedure for an assessment performed before any repair contract exists.
3. **Manipulated count.** The published method fixes the primary damage assessment area at eight perimeter shingles; this protocol records the actual manipulated count (6–8) as the layout requires, and reports the damage ratio against that recorded count.
4. **Condition-type capture.** The published method strikes shingle numbers and counts struck shingles; this protocol captures per-condition, per-shingle outcomes (richer record), from which the published per-shingle damage rate is derived without double counting.
5. **Re-seat verification.** The six-inch hand-tap verification in §6.3 is a protocol addition not present in the published method.
6. **Assessment-start conditions.** The published method states environmental windows for testing; this protocol adds a timestamped capture of conditions taken immediately before seal release and governs the assessment by that capture rather than by arrival conditions (§2).
7. **Per-shingle baseline detail.** The published method requires a marked baseline photograph; this protocol adds the RAP1-D per-shingle detail set (§4.9), so that each shingle's pre-manipulation condition is established individually rather than inferred from the area image.
8. **Component-adjacent attempts.** The published method's selection criteria hold the assessment area clear of appurtenances and transitions and contemplate no test adjacent to them. This protocol adds §11 as a separate record, outside the assessment area and excluded from the published method's measures.

## 10. Report Outputs and Source-Record Retention

**Report.** The scorecard, the RAP1 baseline photograph, and up to two newly-damaged-shingle photographs are carried into the report — priority to one delamination example and one creasing/cracking/fracture example. Damage rate, damage ratio, and the total score render with their derivations. The report cites this protocol by name and version, and cites STD-RPR-01 through its Source Record locators for the methodological propositions applied.

**Source record.** The two-photograph limit above is a presentation limit on the report only. It never limits what the field record retains. The assessment's source record retains, in full:

- the assessment-start conditions capture (§2), timestamped, with any recorded mid-assessment change;
- RAP1 and the complete RAP1-D per-shingle baseline detail set (§4.8–4.9);
- the exposed-underlayment observation and photograph taken while shingle X was removed (§5.5);
- a result photograph for **every** shingle identified with an assessment-induced condition — not only the shingles whose images are published;
- the photo note tying each result photograph to its numbered shingle and the recorded outcome;
- the marked pre-existing conditions from §4.7, retained as the exclusion basis for §7;
- the original, unedited image files with their capture timestamps and metadata.

Images are retained unaltered. Where an image is annotated for presentation, the annotated copy is additional to the original file, never a replacement for it.

## 11. Component-Adjacent Repair Attempt (separate record)

The standard assessment area is deliberately held clear of rakes, valleys, hips, and appurtenances (§3), so the standard protocol does not test what occurs when a repair must be made adjacent to a system component. Where a documented repair of event-related damage requires manipulation adjacent to a hip or ridge cap, starter course, valley, flashing, edge metal, or a penetration, that manipulation is recorded as a **separate component-adjacent repair attempt**. It is never performed within, folded into, or counted against the standard assessment area.

Before any manipulation, the record captures: the component and its location; the documented event-related damage being repaired and its position relative to the component; why the manipulation of the component is necessary to reach that damage; and a baseline photograph of the component together with the shingles to be manipulated, with pre-existing conditions marked distinguishably as in §4.7.

After the manipulation, the record captures: photographs of the resulting condition of the component and of each manipulated shingle, and a note identifying each by location and observed condition.

Results of a component-adjacent attempt are **excluded from the damage rate, the damage ratio, and the total repairability assessment score**, which remain measures of the standard field-shingle assessment area only. They render under DET-AS-RPR-08 and under the affected component's own detriment entry. Where no component-adjacent attempt was performed, that is the record — its absence is not a finding about how a component would respond.

---
*Version 1.2 — {{company_name}}. Changes to this protocol issue as new versions; reports always cite the version in effect at the assessment date.*
