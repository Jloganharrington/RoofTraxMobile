# Detriment Entries — CRM Field Values
Copy-paste values for the /settings/library Detriment Library tab, all 42 entries (19 from v2, plus 23 added in library v3). Fields map to the modal: Statement / Applicability Conditions / Required Support / Limitation.

**Read Part 1 first — the current condition-code chip set cannot express most of the v2 Applicability gates.** Statements below are written in the v2 conditional forms, so they stay safe even under coarse gating, but the code-enforced gate (the whole point of the structured library) needs the finer codes added.

---

## PART 1 — Condition-Code Taxonomy Additions Required

The existing chips (hail_damage, wind_damage, hail_and_wind, deck_exposed, granule_loss, tab_fracture, bruising, metal_dents, siding_damage, fascia_damage, gutter_damage, interior_damage, discontinued_product, compatibility_issue, mismatched_repair) are damage-type tags. The v2 gates are condition-specific and often require a *documented confirmation method*. Add these codes to the field-record condition vocabulary and the chip set:

| New code | Gates entries | Meaning |
|---|---|---|
| exposed_asphalt | AS-01 | Granule displacement with exposed asphalt, close-up w/ scale |
| mat_fracture_confirmed | AS-02 | Mat fracture/bruise confirmed by documented method (palpation, back-light, visible fracture) |
| crease_documented | AS-03 | Crease line photographed with location |
| crease_fracture_confirmed | AS-03 (confirmed form) | Fracture at crease confirmed (visible break, back-light, flexure) |
| seal_bond_broken | AS-04 | Unbonded shingles documented by lift test/observation, locations+slopes recorded |
| shingle_displaced | AS-05 | Shingle documented out of designed position |
| fastener_displacement_documented | AS-05 (attachment consequence) | Displaced/pulled fasteners, enlarged holes, or failed re-seat |
| fastener_pull_through | AS-06 | Pull-through or withdrawal photographed at location |
| shingle_torn_missing | AS-07 | Material torn from or missing at the covering |
| accessory_removed_opening | AS-08 | Wind-removed accessory with documented opening/disturbance at mount |
| siding_fracture | VS-01 | Panel fracture photographed |
| siding_unlocked | VS-02 | Panel unseated from interlock |
| siding_lock_deformed | VS-02 (deformation consequence) | Lock deformation documented (photo or failed re-engagement) |
| siding_puncture | VS-03 | Puncture/penetration photographed |
| shake_split_fresh | CS-01 | Split with unweathered interior faces, fresh/aged distinction recorded |
| shake_crush_confirmed | CS-02 | Crush identified by defined recorded method |
| metal_indentation | SM-01 | Indentation photographed (technique recorded) — rename/alias of metal_dents |
| coating_breach_confirmed | SM-01 (corrosion consequence), SM-03 | Coating fracture / exposed substrate confirmed by inspection |
| seam_disengaged | SM-02 | Seam/clip disengagement photographed with location |
| insulation_wetted | IN-01 | Insulation wetted, type + moisture condition recorded |
| drywall_water_affected | IN-02 | Drywall water-affected with observations recorded |
| deck_deterioration_documented | IN-03 | Swelling, delamination, decay, repeated wetting, or measured deterioration documented (wetting alone ≠ this code) |

### v3 additions — component, exposure, and repair-attempt codes

| New code | Gates entries | Meaning |
|---|---|---|
| shingle_puncture_confirmed | AS-09 | Through-opening confirmed by documented method (mat opening visible, underlayment/deck visible at opening, back-light). Surface mark ≠ this code |
| laminate_delamination | AS-10 | Sheet separation documented in a shingle in place, on a laminate product |
| cap_shingle_damaged | AS-RDG-01 | Ridge/hip cap displaced, torn, creased, fractured, unbonded, or missing, with the line and location recorded |
| ridge_vent_present | AS-RDG-01 (vent-exposure clause) | Ridge ventilation product recorded present beneath the cap |
| starter_course_damaged | AS-STR-01 | Starter displaced, torn, missing, or unbonded, with observation means recorded |
| wall_flashing_displaced | AS-FLS-01 | Step / apron / headwall / sidewall / counterflashing displaced, separated, deformed, or disengaged at a recorded transition |
| valley_damage_documented | AS-FLS-02 | Valley metal/liner punctured, torn, deformed, displaced, lap-separated, or shingle-to-valley interface disturbed; valley type recorded |
| edge_metal_displaced | AS-FLS-03 | Drip/rake edge metal displaced, deformed, lap-separated, or fasteners withdrawn |
| pipe_flashing_damaged | AS-PEN-01 | Pipe jack split, torn, punctured, separated from pipe, or flange lifted/displaced/deformed. Weathering checks alone ≠ this code |
| vent_component_damaged | AS-PEN-02 | Vent/turbine/ridge-vent/powered vent fractured, punctured, geometry-deformed, or displaced at mount — component still in place |
| skylight_interface_damaged | AS-PEN-03 | Skylight glazing/dome fractured, or curb/perimeter flashing displaced, deformed, or separated |
| underlayment_damage_observed | AS-UND-01 | Underlayment torn/holed/displaced/lap-separated at a location where covering is absent, lifted, or removed; exposure means recorded |
| water_path_traced | AS-UND-02 | Continuous path traced from documented exterior breach to documented wetted location, observations recorded at each point. Coexistence of breach + wetting ≠ this code |
| attachment_substrate_observed | AS-ATT-01 | Enlarged/elongated holes, non-holding fasteners, deteriorated deck at fastener locations, or unsupported fastener locations, observed at exposure |
| **repairability_assessment_performed** | **SERIES GATE — all AS-RPR-\*** | Assessment performed and recorded under STD-RPR-INT-01 with the RAP1 post-markup/pre-manipulation baseline photo AND the RAP1-D per-shingle baseline detail set taken, and pre-existing damage marked before manipulation. **No AS-RPR entry may render without this code.** |
| rpr_baseline_detail_missing | flag on AS-RPR-01…06 | Set where a shingle carrying a recorded outcome has no RAP1-D baseline detail image; the entry renders only with that absence noted |
| rpr_component_adjacent_attempt | AS-RPR-08 (replaces rpr_collateral_component as the gate) | A component-adjacent repair attempt recorded as a SEPARATE record under STD-RPR-INT-01 §11 — never within the standard assessment area, and excluded from damage rate / ratio / total score |
| rpr_seal_release_damage | AS-RPR-01 | Puncture / tear / gouge sustained while releasing seals (protocol §7.4) |
| rpr_crease_crack_fracture | AS-RPR-02 | Creasing / cracking / fracturing sustained by a manipulated shingle (§7.2) |
| rpr_delamination | AS-RPR-03 | Delamination sustained by a manipulated shingle (§7.1) |
| rpr_mat_transfer | AS-RPR-04 | Mat transfer recorded on an underlying shingle (§5.4) — determined individually per shingle |
| rpr_nail_zone_damage | AS-RPR-05 | Nail pull-through or nail-zone damage sustained by a manipulated shingle (§7.3) |
| rpr_refastened_new_holes | AS-RPR-05 (refastening clause) | Fasteners reinstated at new hole locations recorded (§6.2) |
| rpr_reseat_failure | AS-RPR-06 | Re-seat / re-secure outcome of failure on the recorded hand-tap verification (§6.3, §7.5) — flatness and refastening only. A sealant-bond finding neither sets this code nor derives from it |
| rpr_underlayment_damage | AS-RPR-07 | Underlayment damage at the removal location, observed while X was out and attributed to the removal (§5.5) |
| rpr_collateral_component | AS-RPR-08 (condition detail) | Damage/displacement to the component recorded, with its pre-manipulation condition and the necessity of the manipulation recorded. Requires rpr_component_adjacent_attempt |
| rpr_concealed_condition_exposed | AS-RPR-09 | Underlayment/deck/attachment condition observable only because the covering was opened; exposure means, date, location recorded |
| rpr_conditions_recorded | AS-RPR-10 | Timestamped assessment-start conditions capture taken immediately before seal release (temp, wind/gusts, surface moisture, precipitation, sky), with any departure from the reference windows and any mid-assessment change recorded. **Stage 2 arrival conditions alone do NOT set this code** |

**Series-gate enforcement (AS-RPR-\*):** `repairability_assessment_performed` is a compound gate, not a chip an inspector taps at will — it is set by the Repairability module on a completed Stage 7 record, and each per-condition code above is set from the module's own scorecard, not entered free-hand. Conditions marked pre-existing at §4.7 baseline must be excluded from every AS-RPR code. Every rendered AS-RPR entry carries STD-RPR-INT-01 (version) + STD-RPR-01 (locator) in its citation set, and none of them may render as a substitute for the Stage 6 damage documentation.

**Two carve-outs the module must enforce separately:**
1. `rpr_component_adjacent_attempt` (AS-RPR-08) is set from the STD-RPR-INT-01 §11 record, which is a *separate* capture outside the standard assessment area — the §11 record's outcomes must not feed the damage rate, damage ratio, or total score, and the module must keep the two records distinct at the data layer, not only in the report.
2. `rpr_conditions_recorded` (AS-RPR-10) is set from the §2 assessment-start capture, a Stage 7 element, and must not fall back to the Stage 2 Arrival Record when the Stage 7 capture is absent. If the module can silently substitute arrival conditions, the AS-RPR-10 gate is not enforced.

Chips that should NOT gate detriment entries: discontinued_product, compatibility_issue, mismatched_repair (product/repair-path flags, not physical conditions); deck_exposed (an access state, not deterioration).

**Interim rule until the codes land:** enter each entry with the closest existing chips listed below. The conditional statement wording keeps rendered text safe, but confirmed-form rendering (rule 5 of the library) must NOT activate on coarse chips — treat every entry as conditional-form-only until its confirmation code exists.

---

## PART 2 — Entry Values

### DET-AS-01 — Granule displacement (impact)
Chips now: hail_damage, granule_loss • Add: exposed_asphalt
Statement:
Granules are the shingle's mineral wearing surface, shielding the asphalt beneath from ultraviolet exposure. Where impact has displaced granules and exposed asphalt, the affected area has lost part of that protective surfacing, and the exposed asphalt weathers without it for the remaining service of the shingle; displaced granules do not re-adhere. The significance of the exposure to the product's listed performance — including any fire-resistance or weathering listing — is evaluated against the identified product's specifications and applicable listings.
Required Support:
Product identification (or system reference) before any assertion regarding fire classification or listed performance; listing or product literature citation where such performance is discussed.
Limitation:
Granule displacement alone does not establish concealed mat damage, active leakage, or the extent of affected material beyond what is documented.

### DET-AS-02 — Mat fracture / bruising (impact)
Chips now: bruising • Add: mat_fracture_confirmed (hard gate — not applicable from a surface mark alone)
Statement:
The reinforcing mat is the shingle's structural core. A confirmed fracture or bruise of the mat reduces the shingle's structural continuity at that location, and the affected area may worsen under thermal cycling and wind flexure, as the fracture is subject to propagation under repeated load. A mat compromised at an impact point no longer performs as the intact product was designed to perform at that location, even where the surface appears superficially intact.
Required Support:
The identification method for the fracture/bruise stated in the record (what was felt, seen, or tested); technical reference where propagation or long-term consequence is asserted beyond the observed condition.
Limitation:
An impact mark without a confirmed mat effect does not establish fracture; this entry does not establish leakage or present water entry.

### DET-AS-03 — Crease (wind)
Chips now: wind_damage • Add: crease_documented; crease_fracture_confirmed (confirmed form only)
Statement:
A crease is a fold line formed where wind has displaced the shingle against its own plane, and it may indicate fracture or loss of material continuity along the fold. Where fracture at the crease is confirmed, the affected shingle no longer lies and loads as originally installed: the creased portion hinges at the fold under subsequent wind exposure, and the fracture does not re-fuse.
Required Support:
Confirmation method in the field record before rendering the confirmed-fracture form; otherwise render the conditional form.
Limitation:
A crease alone, without confirmation, does not establish mat fracture, permanent loss of wind resistance, or leakage.

### DET-AS-04 — Broken sealant bond (wind)
Chips now: wind_damage • Add: seal_bond_broken
Statement:
The factory sealant strip bonds each course to the one below and contributes materially to the covering's resistance to wind uplift and wind-driven rain; fasteners restrain the shingle, and the bond restrains its edges. Where the bond is broken, the unbonded edge can lift at lower wind exposure than the intact assembly and can admit wind-driven water beneath the covering at that edge.
Required Support:
For any assertion attributing the broken bonds to a directional wind event rather than adhesive aging: the documented distribution pattern (bond condition by slope and orientation, including slopes where bonds were intact) must support the distinction, and the pattern evidence must be cited with the assertion.
Limitation:
Broken bonds alone do not establish cause; aging, installation, and thermal history are among the mechanisms that can produce bond failure, and distribution evidence is required before cause is distinguished.

### DET-AS-05 — Lifted or displaced shingle
Chips now: wind_damage • Add: shingle_displaced; fastener_displacement_documented (attachment consequence only)
Statement:
A shingle lifted or displaced from its designed position does not shed water as installed: displacement interrupts the coverage relationship between courses and can expose fastener penetrations and underlayment that the covering is designed to protect. Where the record documents displaced or pulled fasteners, enlarged fastener holes, or a shingle that cannot be re-seated to its designed position, the attachment at that location is also compromised.
Required Support:
Fastener-related consequences rendered only where fastener displacement, enlarged holes, or failed re-seating is documented.
Limitation:
Displacement alone does not establish fastener damage or leakage; a displaced shingle's bond and fastening condition are as documented, not presumed.

### DET-AS-06 — Fastener pull-through / withdrawal (wind)
Chips now: wind_damage • Add: fastener_pull_through
Statement:
Where wind loading has pulled the shingle over the fastener head or withdrawn the fastener, the designed attachment at that point no longer exists, and the shingle's remaining fasteners carry load the attachment pattern did not allocate to them. Where the pull-through leaves an exposed opening in the shingle, or prevents normal refastening at the designed location, the condition is both an attachment failure and a breach of the water-shedding plane at that point.
Required Support:
The open-penetration consequence rendered only where the opening is documented.
Limitation:
A pull-through does not by itself establish leakage to the interior or deck damage at the penetration.

### DET-AS-07 — Torn or missing shingle / tab
Chips now: wind_damage, tab_fracture • Add: shingle_torn_missing
Statement:
Where covering material is torn away or missing, the underlayment or deck at that location is directly exposed to weather and the covering's water-shedding function is absent at the loss. Edges of adjacent shingles are exposed to wind at boundaries the intact assembly did not present, a condition relevant to the loss's tendency to extend under subsequent wind exposure.
Required Support:
None beyond the documented loss for the exposure statement; extension/propagation framed as tendency, not certainty.
Limitation:
The documented loss establishes exposure at the loss; interior wetting or deck deterioration must be separately documented.

### DET-AS-08 — Wind-removed roof accessory / created opening
Chips now: wind_damage • Add: accessory_removed_opening (note: aligns with created_opening trigger flag)
Statement:
Where wind has removed an accessory and the assembly at its mount is opened or disturbed, the roof system's continuity is breached at that location to the depth documented — covering, underlayment, and, where mount penetrations are involved, the deck. A documented breach of the envelope admits water to the assembly with each wetting event until it is closed, and interior conditions traced to the breach share its cause.
Required Support:
The opening documented photographically; interior attribution supported by the traced moisture path in the record.
Limitation:
The breach establishes the entry point; the extent of interior effect is as traced and documented, not presumed.

### DET-AS-09 — Puncture / perforation of the covering (impact or windborne debris)
Chips now: hail_and_wind • Add: shingle_puncture_confirmed (hard gate — not applicable from a surface mark, granule loss, or mat fracture without a through-opening)
Statement:
A puncture is a through-opening in the covering at the location documented: surfacing, asphalt, and mat are absent through the thickness of the shingle there, and the layer beneath the covering is directly exposed to water entering the opening. The covering does not shed water at a through-opening, and the opening remains available at each wetting event until it is closed. Where the record documents the striking object or debris and its point of contact, the mechanism at that location is as documented.
Required Support:
The confirmation observation establishing the opening passes through the shingle; identification of the impacting object or debris where a specific mechanism is asserted.
Limitation:
A surface mark, granule displacement, or confirmed mat fracture without a through-opening is not a puncture and is documented under DET-AS-01 or DET-AS-02. A puncture establishes the opening; underlayment, deck, and interior effects are separately documented.

### DET-AS-10 — Laminate delamination (in place)
Chips now: wind_damage • Add: laminate_delamination
Statement:
A laminate shingle's exposed and backing sheets are bonded at the factory to act as a single unit. Where the record documents separation of those sheets in an installed shingle, the shingle no longer acts as one unit at the separation: the separated portion moves independently under wind and thermal load, presents an edge to wind that the bonded shingle did not present, and the factory lamination is not reconstituted in the field.
Required Support:
Photograph at the separation; for any assertion attributing the separation to a wind event rather than a product, adhesive-aging, or heat-history condition, the documented distribution pattern (by slope and orientation, including slopes where no separation was found) must support the distinction and be cited with the assertion.
Limitation:
Delamination alone does not establish cause; product condition, adhesive aging, and thermal history are among the mechanisms that can produce sheet separation, and differentiating evidence is required before cause is distinguished. Sheet separation observed in a shingle manipulated during a repairability assessment is documented under DET-AS-RPR-03, not this entry.

### DET-AS-RDG-01 — Cap shingle displaced, torn, creased, or missing (ridge or hip)
Chips now: wind_damage • Add: cap_shingle_damaged; ridge_vent_present (vent-exposure clause only)
Statement:
Cap shingles close the covering along the ridge and hip lines, where two roof planes meet and the field courses terminate against one another. Where a cap is displaced, torn, fractured, or missing, that termination is open at the location documented: the cut or abutting ends of the field courses and the juncture beneath them are no longer covered as designed, and the ridge or hip line is exposed at the covering's most wind-loaded boundary. A cap is formed over an angle change and does not return to that formed geometry once creased or fractured. Where the record documents a ridge ventilation product beneath, the cap is the component that closes and weathers it, and the vent is exposed at the loss.
Required Support:
Photograph with the ridge or hip line and location; presence of a ridge ventilation product recorded where the vent-exposure statement is rendered; product identification before any assertion specific to a manufactured hip-and-ridge accessory as distinct from cut field shingle.
Limitation:
A cap condition establishes the open termination at the ridge or hip documented; it does not establish field-shingle damage on the adjoining slopes, damage to a ridge vent beneath it, or water entry — each is separately documented.

### DET-AS-STR-01 — Starter course displaced, torn, missing, or unbonded
Chips now: wind_damage • Add: starter_course_damaged
Statement:
The starter course supplies the sealant bond and the underlying layer that restrain the leading edge of the first course at the eave or rake — the covering's most wind-exposed boundary, and the boundary at which wind uplift on a shingle covering is initiated. Where the starter is displaced, torn, missing, or unbonded, the first course's edge is neither bonded nor backed as designed at that location, and the edge presents to wind a condition the intact assembly did not present.
Required Support:
The means of observation recorded (first course lifted, covering absent at the edge, area exposed at removal or tear-off); locations and the edge (eave or rake) recorded with the condition.
Limitation:
Starter condition at locations not exposed or observed is undetermined and is recorded as undetermined. This entry does not establish damage to the first course or water entry at the edge.

### DET-AS-FLS-01 — Flashing displaced, deformed, or separated at a wall or chimney transition
Chips now: wind_damage • Add: wall_flashing_displaced
Statement:
Flashing at a wall or chimney transition carries water across the juncture where the roof covering terminates against a vertical surface, and the assembly depends on the flashing's designed lap, its position within the shingle courses, and the counterflashing's cover over its vertical leg. Where a flashing is displaced, separated, deformed, or no longer engaged as installed, the lap or cover at that transition is open to the extent documented, and water reaching the juncture is not returned onto the covering as designed. Flashing set within the shingle courses is not repositioned or replaced without disturbing the courses that lap it.
Required Support:
The specific transition, the flashing type and configuration, and the observed condition recorded; where a corrective method or assembly requirement is stated, the trade-manual or manufacturer reference resolved and cited with its locator (STD-RFG-01 / STD-MFR-01, the latter gated to an identified product).
Limitation:
The displacement establishes the open condition at the transition documented. Wall-assembly wetting, interior effect, and the condition of adjacent flashings not observed are separately documented and traced.

### DET-AS-FLS-02 — Valley damage (metal, lined, or shingle-woven)
Chips now: wind_damage, hail_damage • Add: valley_damage_documented
Statement:
A valley carries the combined flow of two roof planes through the covering's narrowest drainage path, at the highest volume and velocity the roof develops. Deformation of valley metal alters the path that flow follows and can direct water beneath the covering at the deformation; a puncture, tear, or open lap is a breach at the point of the roof's greatest concentrated flow. Where the record documents a closed-cut or woven valley, the shingles crossing and terminating in the valley are themselves the drainage surface, and damage to those shingles is damage to the valley's water-carrying function at that location.
Required Support:
Valley type from the field record (open metal / closed-cut / woven / lined); the observed interface condition recorded wherever the shingle-to-valley relationship is asserted; photograph with location.
Limitation:
The documented condition establishes the breach or altered path at that location; water entry beneath the valley, underlayment condition, and deck condition beneath the valley are separately documented.

### DET-AS-FLS-03 — Edge metal displaced, deformed, or separated (drip edge / rake edge)
Chips now: wind_damage • Add: edge_metal_displaced
Statement:
Edge metal terminates the covering at the eave and rake, carries water off the deck edge to the gutter or beyond the fascia, and provides the backing to which the covering's most wind-exposed edge is fastened and bonded. Where edge metal is displaced, deformed, or separated, that line is not held at the location documented: water at the edge can return behind the metal to the deck edge or fascia, and the first course's edge and the underlayment termination are exposed at the displacement.
Required Support:
Photograph and location; the observed bond or fastening condition of the covering at the metal recorded wherever the covering's edge attachment is asserted.
Limitation:
Edge-metal condition does not establish fascia, deck-edge, or gutter damage, nor water entry behind the metal; each is separately documented.

### DET-AS-PEN-01 — Pipe flashing / boot damage
Chips now: wind_damage • Add: pipe_flashing_damaged (weathering checks or ozone cracking without impact, displacement, or flange disturbance do NOT set this code)
Statement:
A pipe flashing closes the covering around a penetration by a base flange lapped into the shingle courses and a collar sealing against the pipe. Where the collar is split, torn, or separated from the pipe, or the flange is lifted, displaced, or deformed, the penetration is open at the location documented and water reaching it is not returned onto the covering. A base flange lapped beneath the upslope courses is not replaced or re-seated without disturbing those courses.
Required Support:
Whether the observed condition is a break, separation, or displacement — as against a weathering condition — recorded as observed; documented impact, displacement, or disturbance evidence wherever a storm mechanism is asserted.
Limitation:
An open condition at the penetration is established by the observation; water entry is separately documented. Collar weathering alone does not establish an event mechanism, and cause is not established absent the documented impact or displacement evidence.

### DET-AS-PEN-02 — Damaged vent or roof-mounted component remaining in place
Chips now: wind_damage, hail_damage • Add: vent_component_damaged (where the component was removed from the roof, DET-AS-08 applies instead)
Statement:
A roof-mounted ventilation or utility component closes the covering at its own opening through a flange lapped into the shingle courses, and it excludes weather at that opening through its formed geometry — louvers, baffles, hood, and throat — while admitting air. Where the record documents fracture, puncture, displacement at the mount, or deformation of that geometry, the component no longer excludes weather at the opening as it was formed to, and deformation of formed sheet metal or molded plastic components is permanent. A flange lapped into the courses is not replaced without disturbing the courses that lap it.
Required Support:
The component type and the specific altered feature recorded with photographs; product identification and the cited listing or specification before any assertion regarding a rated performance (net free area, wind-driven-rain or wind-uplift listing).
Limitation:
Deformation establishes the altered geometry documented; it does not establish loss of a listed performance absent the product reference, nor water entry at the opening, which is separately documented.

### DET-AS-PEN-03 — Skylight or curb-mounted unit / flashing interface damage
Chips now: wind_damage, hail_damage • Add: skylight_interface_damaged
Statement:
A skylight interrupts the roof plane, and the assembly closes around it through the curb, the head, sill, and step flashing at its perimeter, and the glazing seal. Where the glazing or dome is fractured, or the curb or perimeter flashing is displaced, deformed, or separated, the roof plane is not closed at the unit's perimeter to the extent documented. Perimeter flashing is set within the shingle courses, and the interface is not corrected without disturbing the courses that lap it.
Required Support:
Photographs of the specific interface; product identification and the manufacturer's flashing-kit or installation instruction cited (STD-MFR-01, installed-product instructions gated to an identified product) wherever a corrective method or assembly requirement for the unit is stated.
Limitation:
This entry establishes the documented condition at the unit and its perimeter. Interior wetting at the unit is separately documented and traced, and condensation or glazing-seal conditions are distinguished in the record from impact and displacement.

### DET-AS-UND-01 — Underlayment damage observed at exposure
Chips now: deck_exposed • Add: underlayment_damage_observed (deck_exposed is an access state — it does not by itself gate this entry)
Statement:
The underlayment is the covering's secondary water-shedding layer and the layer relied upon wherever the covering is breached or opened. Where the record documents tears, holes, displacement, or separated laps at an exposed location, that secondary layer is not continuous there, and water passing the covering at that area reaches the deck.
Required Support:
The exposure means (covering absent, first course lifted, removal at repairability assessment, tear-off) and location recorded with the observation and photograph.
Limitation:
The observation establishes the underlayment's condition at the exposed location only; condition beneath intact covering is undetermined and is recorded as undetermined pending exposure. This entry does not establish deck deterioration (DET-IN-03) or interior effect. Underlayment damage arising from a documented removal is recorded under DET-AS-RPR-07.

### DET-AS-UND-02 — Water pathway traced at exposure
Chips now: interior_damage • Add: water_path_traced (hard gate — coexistence of an exterior breach and interior wetting does NOT set this code)
Statement:
Where the record traces a continuous path from a documented breach in the covering, through the underlayment and deck, to a wetted location in the assembly, the wetting at the traced location shares the origin of that breach, and the traced pathway remains available at each subsequent wetting event until the breach is closed.
Required Support:
The tracing observations recorded — what was observed or measured at each point along the path — and the exterior breach documented under its own entry.
Limitation:
An exterior breach and interior wetting, absent a traced path, are two separately documented conditions and establish no relationship between them. The traced path establishes the pathway documented, not the volume, duration, or full extent of wetting.

### DET-AS-ATT-01 — Attachment substrate condition observed at exposure
Chips now: deck_exposed • Add: attachment_substrate_observed
Statement:
Covering attachment depends on the deck's capacity to hold fasteners at the locations and spacing the product's installation requires. Where the record documents enlarged holes, fasteners not holding, deteriorated deck material at fastener locations, or gaps leaving fastener locations unsupported, the substrate at that area does not accept attachment at the designed pattern, and fasteners re-driven at those same locations do not restore the attachment the intact substrate provided.
Required Support:
The observation means, location, and condition recorded; where the required fastening pattern is stated as a product requirement, the identified product's installation instruction cited with its locator (STD-MFR-01, gated to product_id_class == identified).
Limitation:
This entry addresses fastener-holding condition observed at the exposed location; wetting-related panel deterioration is documented under DET-IN-03. It does not establish substrate condition beyond the exposed area — which is recorded as undetermined pending exposure — nor a replacement extent.

### DET-AS-RPR-01 — Seal-release damage (puncture, tear, or gouge)
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_seal_release_damage
Statement:
Reaching a shingle beneath sealed courses requires releasing the factory sealant bond above it. Where the record documents that the release punctured, tore, or gouged a shingle that was intact at the baseline, that shingle carries an opening or loss of material the covering did not have before the manipulation, and returning the assembly to position does not undo it. The condition arises from the access the covering's own bonded construction requires.
Required Support:
RAP1 and the affected shingle's RAP1-D baseline detail image, establishing its pre-manipulation condition individually; the per-shingle outcome record identifying the shingle and the condition; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
Establishes the condition of shingles manipulated within the documented assessment area only, and does not establish an outcome for shingles not manipulated. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-02 — Crease, crack, or fracture in a manipulated shingle
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_crease_crack_fracture
Statement:
Removing one shingle requires lifting and flexing the shingles that lap it and the shingles beside it. Where the record documents that a shingle intact at the baseline sustained a crease, crack, or fracture during that manipulation, its material continuity is interrupted at the location recorded, the fracture does not re-fuse when the shingle is returned to position, and the shingle does not thereafter lie and load at that location as it did before the manipulation.
Required Support:
RAP1 and the affected shingle's RAP1-D baseline detail image; the per-shingle outcome record with the shingle number and condition; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-03 — Laminate delamination in a manipulated shingle
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_delamination
Statement:
A laminate shingle is two sheets bonded at the factory to act as a single unit. Where the record documents that a shingle intact at the baseline separated at that lamination during the manipulation, the shingle is no longer the single bonded unit it was: the separated sheets move independently under wind and thermal load, and the factory lamination is not reconstituted in the field.
Required Support:
RAP1 and the affected shingle's RAP1-D baseline detail image; the per-shingle outcome record with the shingle number and condition; the covering identified or observed as a laminate product; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-04 — Mat transfer to the underlying course
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_mat_transfer (determined individually per underlying shingle)
Statement:
Where a shingle is pulled from a sealed course, the factory bond can hold to the shingle below more strongly than that shingle's own surface holds together, and its surfacing and mat separate and travel with the removed shingle. Where the record documents mat transfer on an underlying shingle, that shingle's surfacing and mat are absent at the transfer location, the transferred material does not return, and the asphalt exposed at the transfer weathers without its surfacing for the shingle's remaining service.
Required Support:
RAP1 and the RAP1-D baseline detail images for the underlying shingles; the individual per-shingle mat-transfer determinations from the assessment record; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
Mat transfer is determined individually; a determination on one underlying shingle does not establish the condition of another. Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-05 — Nail pull-through or nail-zone damage during removal or refastening
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_nail_zone_damage; rpr_refastened_new_holes (refastening clause only)
Statement:
The nail zone is the band the product's installation instructions designate for fastening, and it is where the shingle's attachment strength is developed. Where the record documents pull-through or damage within the nail zone of a shingle intact at the baseline, the attachment available at that location is not the attachment the intact shingle provided, and the damaged zone does not accept a fastener at the same location. Where the record documents that fasteners were reinstated at new hole locations, the original fastener penetrations remain in the manipulated shingle and the reinstated attachment is not the original attachment.
Required Support:
RAP1 and the affected shingle's RAP1-D baseline detail image; the per-shingle outcome record with the shingle number and condition; the record of refastening locations where that clause is rendered; the identified product's installation instruction with locator (STD-MFR-01, gated to product_id_class == identified) wherever the designated nail zone is stated as a product requirement; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
Does not establish water entry at any penetration. Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-06 — Failure to re-seat or re-secure
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_reseat_failure (flatness/refastening outcome only — a sealant-bond finding neither sets this gate nor derives from it)
Statement:
A completed repair returns the manipulated shingles to their designed position, lying flat and secured. Where the recorded verification documents that a manipulated shingle does not lie flat or could not be properly re-secured, the covering at that location has not been returned by the repair to the configuration it held before the manipulation. A field-applied adhesive is not the factory sealant strip, and whether field sealing restores the identified product's listed wind-resistance configuration is determined by that product's installation instructions and listing, cited wherever the question bears on the corrective scope.
Required Support:
The re-seat verification method and result recorded; the per-shingle outcome record; the identified product's instructions and listing cited (STD-MFR-01 / STD-PRD-01, installed-product instructions gated to product_id_class == identified) wherever field-sealing adequacy or wind-resistance configuration is addressed; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
A shingle that re-seats flat is not thereby established to have regained its factory sealant bond; bond condition is separately documented. Field-sealing adequacy is not established absent the cited product position. Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-07 — Underlayment damage at the removal location
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_underlayment_damage
Statement:
Removing a shingle exposes the underlayment beneath it, and the fasteners withdrawn pass through that layer. Where the record documents that the removal tore, holed, or displaced the underlayment at that location, the secondary water-shedding layer is interrupted at the point documented — and it is interrupted beneath the covering that is returned over it.
Required Support:
The removal-location observation and photograph taken while the shingle was out; the attribution to the removal process recorded; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.
Limitation:
Establishes the underlayment condition at the removal location only; underlayment conditions documented at other exposures are recorded under DET-AS-UND-01. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-AS-RPR-08 — Collateral damage to an adjacent system component
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_component_adjacent_attempt + rpr_collateral_component (STD-RPR-INT-01 §11 separate record — never within the standard assessment area)
Statement:
Field shingles lap, and are lapped by, the roof system's other components, and reaching a field shingle adjacent to such a component requires disturbing it. Where the record documents that the manipulation damaged or displaced a component that was intact before it, that component's condition is a consequence of the access the repair required, and the affected area extends past the field covering to the component documented.
Required Support:
The component's condition recorded before manipulation; the necessity of the manipulation recorded; the resulting condition photographed and identified; the resulting condition also documented under the component's own entry (DET-AS-RDG-01, DET-AS-STR-01, DET-AS-FLS-01/02/03, DET-AS-PEN-01/02/03) where the corrective scope addresses it; STD-RPR-INT-01 cited by version and §11 identified as the procedure applied.
Limitation:
Establishes the condition of the component documented; the pre-manipulation condition of components not recorded at baseline is undetermined, and no outcome is established for components not disturbed. A component-adjacent attempt is excluded from the damage rate, damage ratio, and total repairability assessment score, which measure the standard field-shingle assessment area only, and no rendered text may report it as part of those measures. Where no component-adjacent attempt was performed, that absence is not a finding about how a component would respond. The attempt supplements — never replaces — the damage documentation establishing the loss.

### DET-AS-RPR-09 — Concealed assembly condition exposed at manipulation
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_concealed_condition_exposed
Statement:
Conditions beneath the covering are not observable until the covering is opened. Where a documented manipulation opened the covering and a condition of the underlayment, deck, or attachment was observed there, the record establishes that condition at the exposed location as of the exposure date; the assembly's condition elsewhere beneath intact covering remains undetermined pending exposure. The exposure records the condition; it does not produce it.
Required Support:
The exposure means, date, and location; the observed condition documented under its own entry (DET-AS-UND-01, DET-AS-ATT-01, or DET-IN-03); STD-RPR-INT-01 cited by version.
Limitation:
This entry establishes the exposure and the scope of what was observable through it. It does not establish the cause, mechanism, or age of the condition exposed — each is separately documented — and it does not extend the observation beyond the opened area. The assessment supplements — never replaces — the damage documentation establishing the loss.

### DET-AS-RPR-10 — Material response under controlled manipulation
Chips now: (none — series requires new codes) • Add: repairability_assessment_performed + rpr_conditions_recorded (never rendered as a statement about the covering's age, brittleness, or general condition)
Statement:
The response of this covering to the manipulation a localized repair requires is observed and recorded under stated conditions rather than assumed. The assessment record documents, for each shingle manipulated, whether it sustained a condition it did not have at the baseline, and it documents the temperature, wind, and surface conditions under which that response was observed. The record is of the observed physical response of this covering, at this date, under these conditions.
Required Support:
The timestamped assessment-start conditions capture (taken immediately before seal release, not the Stage 2 arrival record), with any departure from the method's reference conditions (air temperature 40–90°F, wind gusts under 25 mph, dry surfaces, no imminent precipitation, in-season testing preferred) noted together with its bearing on the results, and any material mid-assessment change recorded with its timestamp; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator for the environmental-conditions proposition.
Limitation:
The observed response does not establish that age, weathering, or brittleness is itself a damage condition, and no rendered text may assert that it does. The record does not extend to a manipulation performed under materially different conditions, nor to shingles not manipulated. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01's mechanics, not as performed under it.

### DET-VS-01 — Vinyl siding impact fracture
Chips now: siding_damage • Add: siding_fracture
Statement:
A fractured vinyl panel cannot be restored to an intact, continuous panel: vinyl does not rejoin, and patching does not reconstitute the panel's continuous surface. The fracture is an opening in the cladding at that panel, can admit wind-driven water behind the cladding plane at the break, and is subject to propagation from the crack tips under thermal movement. Where the fracture affects the panel's weather-shedding function, integrity, or appearance, correction is by replacement of the affected panel.
Required Support:
None for the statement as written; propagation asserted as susceptibility, not schedule.
Limitation:
A panel fracture does not by itself establish wetting of the water-resistive barrier or sheathing; effects behind the cladding depend on the assembly and are as documented.

### DET-VS-02 — Unlocked / displaced panel
Chips now: siding_damage • Add: siding_unlocked; siding_lock_deformed (deformation consequence only)
Statement:
A panel unseated from its interlock is not restrained as designed: the open lock can admit wind and wind-driven water behind the cladding, and an unrestrained panel works under wind load, stressing its remaining engagement and fastening. Where the record documents deformation of the locking profile, re-seating does not restore the designed engagement, and correction is by replacement of the affected panel; where no lock deformation is documented, the panel's capacity to re-engage is as observed in the field record.
Required Support:
Deformation documented (photograph or noted failed re-engagement) before the deformation consequence is rendered.
Limitation:
Simple unseating does not establish lock damage; the two conditions are documented and treated separately.

### DET-VS-03 — Puncture / debris impact
Chips now: siding_damage • Add: siding_puncture
Statement:
A puncture is an opening in the cladding at the panel and can admit wind-driven water behind the siding at that point. The consequence of water behind the cladding depends on the assembly: where a water-resistive barrier is present and intact, the barrier is the next plane of protection; where the record documents no barrier, water entering at the puncture can reach the sheathing directly. The assembly condition behind the cladding is as documented in the inspection record, including the recorded presence or absence of a water-resistive barrier.
Required Support:
The WRB determination from the field record (present / absent / undetermined) accompanies any statement about what lies behind the cladding.
Limitation:
A puncture does not by itself establish wetting or deterioration of the barrier or sheathing.

### DET-CS-01 — Fresh split (impact or wind)
Chips now: hail_and_wind • Add: shake_split_fresh
Statement:
A split shake no longer sheds water as a single unit: the split is an opening in the shake's coverage, exposing the interlayment and fastening beneath it to water at that line, and the split halves move independently under wind and thermal load. Freshly exposed wood within the split — distinguishable from aged splits by its unweathered interior faces — absorbs water preferentially at the opening.
Required Support:
The fresh/aged distinction documented in the record where the split's recency is asserted.
Limitation:
A split establishes the opening; decay, leakage, and service-life effect are not established by the split alone.

### DET-CS-02 — Impact crush / fiber bruising
Chips now: hail_damage • Add: shake_crush_confirmed (hard gate — not applicable from surface appearance alone)
Statement:
Where crushing of the wood surface is identified by a documented method, the compressed area's capacity to shed rather than absorb water is reduced at that location, and preferential water retention at a crushed area is a recognized contributor to localized deterioration in wood roofing materials.
Required Support:
The identification method stated in the record; a wood-material or industry technical reference where service-life consequence is asserted.
Limitation:
Surface marks without a documented identification method do not establish fiber crushing; this entry does not establish decay or a quantified life reduction.

### DET-SM-01 — Impact indentation (metal)
Chips now: metal_dents, hail_damage • Add: coating_breach_confirmed (corrosion consequence only)
Statement:
An impact indentation is a permanent deformation: the metal has yielded and does not recover its formed geometry. Where inspection confirms fracture of the finish or exposed substrate at the deformation, the panel's factory corrosion protection is breached at that point, and the breach is the location from which corrosion of the substrate can initiate. Where indentations alter panel geometry at seams, ribs, or drainage planes, the effect on the panel's designed drainage or engagement at those locations is evaluated and documented.
Required Support:
Coating fracture / substrate exposure confirmed and documented before any corrosion-related assertion; geometry effects at seams or drainage documented where asserted.
Limitation:
An indentation alone does not establish coating fracture, corrosion initiation, or functional impairment; those conditions are confirmed, not inferred.

### DET-SM-02 — Disengaged seam / clip (wind)
Chips now: wind_damage • Add: seam_disengaged
Statement:
In a standing seam system the seam is both the structural connection and the waterproofing joint. A documented disengaged seam or clip no longer restrains the panel as designed and no longer closes the joint at the disengagement: the panel can work under wind load at the open connection, and the open seam can admit wind-driven water. Panel systems are engineered as continuous assemblies, and a disengaged connection shifts uplift demand to adjacent connections beyond the design's allocation at that location.
Required Support:
None beyond the documented disengagement; system-level engineering statements kept to the design principle stated.
Limitation:
A disengagement establishes the open connection; water entry and adjacent-connection damage are as separately documented.

### DET-SM-03 — Finish fracture / coating breach
Chips now: metal_dents • Add: coating_breach_confirmed
Statement:
The factory-applied coating is the panel's corrosion protection, and a documented breach through to substrate is the point at which that protection is absent. Corrosion of exposed substrate initiates at such a breach and can undercut adjacent finish over time. Whether field-applied touch-up constitutes an accepted repair of the identified panel's coating system is determined by the panel manufacturer's published repair and finish-warranty position, which is cited where this determination bears on the corrective scope.
Required Support:
Manufacturer repair/warranty position for the identified panel and finish, cited wherever touch-up adequacy is addressed.
Limitation:
A coating breach does not establish present corrosion beyond what is observed, nor the manufacturer's position absent the citation.

### DET-IN-01 — Wetted insulation
Chips now: interior_damage • Add: insulation_wetted
Statement:
Insulation performs thermally by trapping air within its structure, and wetting displaces that function: wetted insulation may experience reduced thermal performance, and wetting can compress loose-fill and batt structure. Recoverability on drying depends on the material type, the water exposure, and the material's documented condition; retained moisture within insulation also holds adjacent framing and finishes wet, extending the assembly's drying. Evaluation and disposition of wetted insulation follow the applicable water-damage restoration standard for the material and water category documented.
Required Support:
Insulation type and observed/measured condition in the record; restoration-standard citation (S500 entry — human-entered locator) where disposition is stated.
Limitation:
Wetting alone does not establish permanent performance loss for every material; the documented type, condition, and standard govern.

### DET-IN-02 — Water-affected gypsum drywall
Chips now: interior_damage • Add: drywall_water_affected
Statement:
Gypsum board is degraded by wetting in proportion to the exposure: wetting can soften the core, delaminate the paper facing, and reduce fastener holding at the affected area. Wetted gypsum is evaluated for loss of integrity, delamination, contamination, and restorability under the applicable water-damage restoration standard, considering the water category, duration, and the material's documented condition; material that cannot be restored to its pre-loss condition under that standard is removed and replaced.
Required Support:
Documented condition observations; restoration-standard citation (S500 entry — human-entered locator) where the evaluation criteria or disposition are stated.
Limitation:
Water contact alone does not establish that all affected board requires removal; the documented evaluation under the standard governs the disposition.

### DET-IN-03 — Wetted structural sheathing / decking
Chips now: interior_damage • Add: deck_deterioration_documented (hard gate — wetting alone triggers evaluation, not this entry)
Statement:
Wood structural panels are subject to edge swelling, glue-line delamination, and reduced fastener holding from water exposure. Where the record documents such deterioration — swelling, delamination, decay, or measured degradation — the affected panel no longer provides the solid, nailable substrate that covering attachment requires at that area, and the deteriorated area is corrected before new covering is installed. Deck condition concealed by the covering is confirmed at tear-off, and the record is supplemented with the exposed conditions.
Required Support:
The documented deterioration observation (or tear-off confirmation) before the substrate-consequence statement is rendered.
Limitation:
A wetting event alone does not establish panel deterioration; undetermined deck condition is recorded as undetermined pending exposure.
