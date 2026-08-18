/**
 * Hard-coded library items loaded into the /trial Proof Package Data Wizard.
 * Call buildHardcodedLibraryItems(companyName) to get the full item list with
 * all {{company_name}} placeholders substituted.
 */

export interface PreloadedItem {
  destination: 'boilerplate' | 'standards' | 'detriment';
  label: string;
  confidence: number;
  reasoning: string;
  // boilerplate
  sectionKey?: string;
  content?: string;
  // standards
  entryKey?: string;
  sourceType?: string | null;
  citationText?: string;
  authorityLimit?: string | null;
  locatorTemplate?: string | null;
  humanEnteredProvisionsOnly?: boolean;
  // detriment
  applicabilityConditions?: string[];
  statement?: string;
  requiredSupport?: string | null;
  limitation?: string | null;
}

// ---------------------------------------------------------------------------
// Boilerplate template ({{company_name}} substituted at call time)
// ---------------------------------------------------------------------------

const REPAIRABILITY_PROTOCOL_TEMPLATE = `# Repairability Assessment Field Protocol — v1.2

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
*Version 1.2 — {{company_name}}. Changes to this protocol issue as new versions; reports always cite the version in effect at the assessment date.*`;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildHardcodedLibraryItems(companyName: string): PreloadedItem[] {
  const boilerplateContent = REPAIRABILITY_PROTOCOL_TEMPLATE.replace(
    /\{\{company_name\}\}/g,
    companyName,
  );

  const R = 'Pre-loaded from CRM library values';

  return [
    // ── Boilerplate ─────────────────────────────────────────────────────
    {
      destination: 'boilerplate',
      label: 'Repairability Assessment Field Protocol v1.2',
      sectionKey: 'repairability_field_protocol',
      content: boilerplateContent,
      confidence: 1,
      reasoning: R,
    },

    // ── Standards ────────────────────────────────────────────────────────
    {
      destination: 'standards',
      label: 'STD-RPR-01 — NAFE Repairability Assessment Method',
      entryKey: 'STD-RPR-01',
      sourceType: 'Peer-reviewed methodology (journal article)',
      citationText:
        'Williams, Chad T., P.E. (NAFE 937A). "Use of the Repairability Assessment Method for Evaluating Asphalt-Composition Shingle Roof Repairs." Journal of the National Academy of Forensic Engineers, Vol. 37, No. 1 (December 2020), pp. 179–192. ISSN 2379-3252. DOI: 10.51501/jotnafe.v37i1.94.',
      authorityLimit:
        'A peer-reviewed published repairability methodology. Not a universally adopted standard, not a building-code requirement, not a manufacturer requirement — never represented as any of these. Does not establish causation or repairability for a specific property; the documented field results do. Company assessments are cited as aligned with the method\'s mechanics, never as performed under the published method (the paper defines its evaluator as a licensed professional engineer).',
      locatorTemplate:
        'Williams, JNAFE 37(1) 2020, p. {page} — {proposition applied}. Key locators: damage rate/ratio pp. 187–188 & p. 192; scoring guide & thresholds pp. 191–192 (Fig. 22); nine-shingle assessment area & ten-step protocol pp. 184–187.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-RPR-02 — Hail Damage Assessment Protocol (Marshall & Herzog)',
      entryKey: 'STD-RPR-02',
      sourceType: 'Conference protocol (published proceedings)',
      citationText:
        'Marshall, T., and Herzog, R. "Protocol for Assessment of Hail-Damaged Roofing." Proceedings of the North American Conference on Roofing Technology, August 16–17, 1999, Toronto, Ontario, pp. 40–46.',
      authorityLimit:
        'Supports a documented hail-assessment method. Does not establish coverage, causation for a specific property, or a mandatory replacement threshold.',
      locatorTemplate:
        'Marshall & Herzog, NARC Proceedings 1999, p. {page} — {assessment-practice proposition applied}.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-WTR-01 — ANSI/IICRC S500 (2021, 5th Edition)',
      entryKey: 'STD-WTR-01',
      sourceType: 'ANSI standard',
      citationText:
        'ANSI/IICRC S500-2021, Standard for Professional Water Damage Restoration, Fifth Edition. Institute of Inspection, Cleaning and Restoration Certification (ANSI-accredited standards developer).',
      authorityLimit:
        'Establishes professional restoration procedure and evaluation criteria. Does not establish coverage, pricing, or that any particular material at the property required removal — the documented evaluation under the standard does. Provision citations are human-entered from the licensed copy; standard text never enters the AI pipeline.',
      locatorTemplate: 'ANSI/IICRC S500-2021, § {section} — {evaluation criterion or procedure applied}.',
      humanEnteredProvisionsOnly: true,
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-WTR-02 — ANSI/IICRC S520 (2024, 4th Edition)',
      entryKey: 'STD-WTR-02',
      sourceType: 'ANSI standard',
      citationText:
        'ANSI/IICRC S520-2024, Standard for Professional Mold Remediation, Fourth Edition. Institute of Inspection, Cleaning and Restoration Certification.',
      authorityLimit:
        'Establishes remediation procedure and evaluation criteria. Does not establish that microbial conditions exist at a property — only the documented field record or qualified assessment does. Cited only where microbial growth or a qualified microbial condition is documented; never because materials were wetted. Provision citations are human-entered from the licensed copy.',
      locatorTemplate: 'ANSI/IICRC S520-2024, § {section} — {criterion applied}.',
      humanEnteredProvisionsOnly: true,
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-RFG-01 — NRCA Roofing Manual',
      entryKey: 'STD-RFG-01',
      sourceType: 'Trade manual',
      citationText:
        'National Roofing Contractors Association, The NRCA Roofing Manual — {applicable volume, e.g., Steep-slope Roof Systems}, {edition year}.',
      authorityLimit:
        'Industry manual guidance. Not a code requirement unless separately adopted. Does not establish carrier obligations or property-specific conclusions. Cite the volume and section, never "the NRCA" generically.',
      locatorTemplate:
        'NRCA Roofing Manual — {volume}, {edition year}, § {section} — {guidance applied}.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-RFG-02 — ARMA Technical Guidance',
      entryKey: 'STD-RFG-02',
      sourceType: 'Trade manual / technical bulletin',
      citationText:
        'Asphalt Roofing Manufacturers Association, {specific manual or technical bulletin title}, {date}.',
      authorityLimit:
        'Association guidance. Not a code requirement, not a manufacturer instruction for a specific installed product, not property-specific proof. Never cited as a bare acronym.',
      locatorTemplate:
        'ARMA, {document title}, {date}, p./§ {locator} — {proposition applied}.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-MFR-01 — Manufacturer Installation Instructions (code-referenced)',
      entryKey: 'STD-MFR-01',
      sourceType: 'Manufacturer instruction',
      citationText:
        '{Manufacturer}, {product} Installation Instructions, {version/date}, together with the jurisdiction\'s adopted code provision requiring installation in accordance with manufacturer\'s instructions (cited from the applicable AHJ Pack).',
      authorityLimit:
        'Establishes installation requirements for the cited product under the cited code adoption. Does not establish requirements for products it does not cover. An installed-product instruction is not evidence of the existing installation\'s requirements unless the product ID classification is Identified; replacement-product instructions are permitted for proposed replacement materials and must be identified as replacement-system requirements. The code citation must be jurisdiction-specific from the AHJ Pack — no generic IRC citation renders.',
      locatorTemplate:
        '{Manufacturer}, {product} Installation Instructions, {version/date}, p./§ {locator} — {requirement applied}; enforceability: {AHJ Pack code citation}.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'standards',
      label: 'STD-PRD-01 — ASTM Product Standards (asphalt shingles)',
      entryKey: 'STD-PRD-01',
      sourceType: 'ASTM product standard',
      citationText:
        'ASTM {designation-year}, {title} (e.g., D3462 glass-mat shingles; D3161 / D7158 wind resistance; D3018 classifications).',
      authorityLimit:
        'Qualifies products against test criteria. Does not establish installation requirements, field damage, or property-specific conclusions. Cited sparingly, with designation-year confirmed at citation time.',
      locatorTemplate:
        'ASTM {designation-year}, § {section} — {qualification proposition applied}.',
      confidence: 1,
      reasoning: R,
    },

    // ── Detriment entries ─────────────────────────────────────────────────
    {
      destination: 'detriment',
      label: 'DET-AS-01 — Granule displacement (impact)',
      entryKey: 'DET-AS-01',
      applicabilityConditions: ['hail_damage', 'granule_loss', 'exposed_asphalt'],
      statement:
        'Granules are the shingle\'s mineral wearing surface, shielding the asphalt beneath from ultraviolet exposure. Where impact has displaced granules and exposed asphalt, the affected area has lost part of that protective surfacing, and the exposed asphalt weathers without it for the remaining service of the shingle; displaced granules do not re-adhere. The significance of the exposure to the product\'s listed performance — including any fire-resistance or weathering listing — is evaluated against the identified product\'s specifications and applicable listings.',
      requiredSupport:
        'Product identification (or system reference) before any assertion regarding fire classification or listed performance; listing or product literature citation where such performance is discussed.',
      limitation:
        'Granule displacement alone does not establish concealed mat damage, active leakage, or the extent of affected material beyond what is documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-02 — Mat fracture / bruising (impact)',
      entryKey: 'DET-AS-02',
      applicabilityConditions: ['bruising', 'mat_fracture_confirmed'],
      statement:
        'The reinforcing mat is the shingle\'s structural core. A confirmed fracture or bruise of the mat reduces the shingle\'s structural continuity at that location, and the affected area may worsen under thermal cycling and wind flexure, as the fracture is subject to propagation under repeated load. A mat compromised at an impact point no longer performs as the intact product was designed to perform at that location, even where the surface appears superficially intact.',
      requiredSupport:
        'The identification method for the fracture/bruise stated in the record (what was felt, seen, or tested); technical reference where propagation or long-term consequence is asserted beyond the observed condition.',
      limitation:
        'An impact mark without a confirmed mat effect does not establish fracture; this entry does not establish leakage or present water entry.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-03 — Crease (wind)',
      entryKey: 'DET-AS-03',
      applicabilityConditions: ['wind_damage', 'crease_documented', 'crease_fracture_confirmed'],
      statement:
        'A crease is a fold line formed where wind has displaced the shingle against its own plane, and it may indicate fracture or loss of material continuity along the fold. Where fracture at the crease is confirmed, the affected shingle no longer lies and loads as originally installed: the creased portion hinges at the fold under subsequent wind exposure, and the fracture does not re-fuse.',
      requiredSupport:
        'Confirmation method in the field record before rendering the confirmed-fracture form; otherwise render the conditional form.',
      limitation:
        'A crease alone, without confirmation, does not establish mat fracture, permanent loss of wind resistance, or leakage.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-04 — Broken sealant bond (wind)',
      entryKey: 'DET-AS-04',
      applicabilityConditions: ['wind_damage', 'seal_bond_broken'],
      statement:
        'The factory sealant strip bonds each course to the one below and contributes materially to the covering\'s resistance to wind uplift and wind-driven rain; fasteners restrain the shingle, and the bond restrains its edges. Where the bond is broken, the unbonded edge can lift at lower wind exposure than the intact assembly and can admit wind-driven water beneath the covering at that edge.',
      requiredSupport:
        'For any assertion attributing the broken bonds to a directional wind event rather than adhesive aging: the documented distribution pattern (bond condition by slope and orientation, including slopes where bonds were intact) must support the distinction, and the pattern evidence must be cited with the assertion.',
      limitation:
        'Broken bonds alone do not establish cause; aging, installation, and thermal history are among the mechanisms that can produce bond failure, and distribution evidence is required before cause is distinguished.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-05 — Lifted or displaced shingle',
      entryKey: 'DET-AS-05',
      applicabilityConditions: ['wind_damage', 'shingle_displaced', 'fastener_displacement_documented'],
      statement:
        'A shingle lifted or displaced from its designed position does not shed water as installed: displacement interrupts the coverage relationship between courses and can expose fastener penetrations and underlayment that the covering is designed to protect. Where the record documents displaced or pulled fasteners, enlarged fastener holes, or a shingle that cannot be re-seated to its designed position, the attachment at that location is also compromised.',
      requiredSupport:
        'Fastener-related consequences rendered only where fastener displacement, enlarged holes, or failed re-seating is documented.',
      limitation:
        'Displacement alone does not establish fastener damage or leakage; a displaced shingle\'s bond and fastening condition are as documented, not presumed.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-06 — Fastener pull-through / withdrawal (wind)',
      entryKey: 'DET-AS-06',
      applicabilityConditions: ['wind_damage', 'fastener_pull_through'],
      statement:
        'Where wind loading has pulled the shingle over the fastener head or withdrawn the fastener, the designed attachment at that point no longer exists, and the shingle\'s remaining fasteners carry load the attachment pattern did not allocate to them. Where the pull-through leaves an exposed opening in the shingle, or prevents normal refastening at the designed location, the condition is both an attachment failure and a breach of the water-shedding plane at that point.',
      requiredSupport:
        'The open-penetration consequence rendered only where the opening is documented.',
      limitation:
        'A pull-through does not by itself establish leakage to the interior or deck damage at the penetration.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-07 — Torn or missing shingle / tab',
      entryKey: 'DET-AS-07',
      applicabilityConditions: ['wind_damage', 'tab_fracture', 'shingle_torn_missing'],
      statement:
        'Where covering material is torn away or missing, the underlayment or deck at that location is directly exposed to weather and the covering\'s water-shedding function is absent at the loss. Edges of adjacent shingles are exposed to wind at boundaries the intact assembly did not present, a condition relevant to the loss\'s tendency to extend under subsequent wind exposure.',
      requiredSupport:
        'None beyond the documented loss for the exposure statement; extension/propagation framed as tendency, not certainty.',
      limitation:
        'The documented loss establishes exposure at the loss; interior wetting or deck deterioration must be separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-08 — Wind-removed roof accessory / created opening',
      entryKey: 'DET-AS-08',
      applicabilityConditions: ['wind_damage', 'accessory_removed_opening'],
      statement:
        'Where wind has removed an accessory and the assembly at its mount is opened or disturbed, the roof system\'s continuity is breached at that location to the depth documented — covering, underlayment, and, where mount penetrations are involved, the deck. A documented breach of the envelope admits water to the assembly with each wetting event until it is closed, and interior conditions traced to the breach share its cause.',
      requiredSupport:
        'The opening documented photographically; interior attribution supported by the traced moisture path in the record.',
      limitation:
        'The breach establishes the entry point; the extent of interior effect is as traced and documented, not presumed.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-09 — Puncture / perforation of the covering (impact or windborne debris)',
      entryKey: 'DET-AS-09',
      applicabilityConditions: ['hail_and_wind', 'shingle_puncture_confirmed'],
      statement:
        'A puncture is a through-opening in the covering at the location documented: surfacing, asphalt, and mat are absent through the thickness of the shingle there, and the layer beneath the covering is directly exposed to water entering the opening. The covering does not shed water at a through-opening, and the opening remains available at each wetting event until it is closed. Where the record documents the striking object or debris and its point of contact, the mechanism at that location is as documented.',
      requiredSupport:
        'The confirmation observation establishing the opening passes through the shingle; identification of the impacting object or debris where a specific mechanism is asserted.',
      limitation:
        'A surface mark, granule displacement, or confirmed mat fracture without a through-opening is not a puncture and is documented under DET-AS-01 or DET-AS-02. A puncture establishes the opening; underlayment, deck, and interior effects are separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-10 — Laminate delamination (in place)',
      entryKey: 'DET-AS-10',
      applicabilityConditions: ['wind_damage', 'laminate_delamination'],
      statement:
        'A laminate shingle\'s exposed and backing sheets are bonded at the factory to act as a single unit. Where the record documents separation of those sheets in an installed shingle, the shingle no longer acts as one unit at the separation: the separated portion moves independently under wind and thermal load, presents an edge to wind that the bonded shingle did not present, and the factory lamination is not reconstituted in the field.',
      requiredSupport:
        'Photograph at the separation; for any assertion attributing the separation to a wind event rather than a product, adhesive-aging, or heat-history condition, the documented distribution pattern (by slope and orientation, including slopes where no separation was found) must support the distinction and be cited with the assertion.',
      limitation:
        'Delamination alone does not establish cause; product condition, adhesive aging, and thermal history are among the mechanisms that can produce sheet separation, and differentiating evidence is required before cause is distinguished. Sheet separation observed in a shingle manipulated during a repairability assessment is documented under DET-AS-RPR-03, not this entry.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RDG-01 — Cap shingle displaced, torn, creased, or missing (ridge or hip)',
      entryKey: 'DET-AS-RDG-01',
      applicabilityConditions: ['wind_damage', 'cap_shingle_damaged', 'ridge_vent_present'],
      statement:
        'Cap shingles close the covering along the ridge and hip lines, where two roof planes meet and the field courses terminate against one another. Where a cap is displaced, torn, fractured, or missing, that termination is open at the location documented: the cut or abutting ends of the field courses and the juncture beneath them are no longer covered as designed, and the ridge or hip line is exposed at the covering\'s most wind-loaded boundary. A cap is formed over an angle change and does not return to that formed geometry once creased or fractured. Where the record documents a ridge ventilation product beneath, the cap is the component that closes and weathers it, and the vent is exposed at the loss.',
      requiredSupport:
        'Photograph with the ridge or hip line and location; presence of a ridge ventilation product recorded where the vent-exposure statement is rendered; product identification before any assertion specific to a manufactured hip-and-ridge accessory as distinct from cut field shingle.',
      limitation:
        'A cap condition establishes the open termination at the ridge or hip documented; it does not establish field-shingle damage on the adjoining slopes, damage to a ridge vent beneath it, or water entry — each is separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-STR-01 — Starter course displaced, torn, missing, or unbonded',
      entryKey: 'DET-AS-STR-01',
      applicabilityConditions: ['wind_damage', 'starter_course_damaged'],
      statement:
        'The starter course supplies the sealant bond and the underlying layer that restrain the leading edge of the first course at the eave or rake — the covering\'s most wind-exposed boundary, and the boundary at which wind uplift on a shingle covering is initiated. Where the starter is displaced, torn, missing, or unbonded, the first course\'s edge is neither bonded nor backed as designed at that location, and the edge presents to wind a condition the intact assembly did not present.',
      requiredSupport:
        'The means of observation recorded (first course lifted, covering absent at the edge, area exposed at removal or tear-off); locations and the edge (eave or rake) recorded with the condition.',
      limitation:
        'Starter condition at locations not exposed or observed is undetermined and is recorded as undetermined. This entry does not establish damage to the first course or water entry at the edge.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-FLS-01 — Flashing displaced, deformed, or separated at a wall or chimney transition',
      entryKey: 'DET-AS-FLS-01',
      applicabilityConditions: ['wind_damage', 'wall_flashing_displaced'],
      statement:
        'Flashing at a wall or chimney transition carries water across the juncture where the roof covering terminates against a vertical surface, and the assembly depends on the flashing\'s designed lap, its position within the shingle courses, and the counterflashing\'s cover over its vertical leg. Where a flashing is displaced, separated, deformed, or no longer engaged as installed, the lap or cover at that transition is open to the extent documented, and water reaching the juncture is not returned onto the covering as designed. Flashing set within the shingle courses is not repositioned or replaced without disturbing the courses that lap it.',
      requiredSupport:
        'The specific transition, the flashing type and configuration, and the observed condition recorded; where a corrective method or assembly requirement is stated, the trade-manual or manufacturer reference resolved and cited with its locator (STD-RFG-01 / STD-MFR-01, the latter gated to an identified product).',
      limitation:
        'The displacement establishes the open condition at the transition documented. Wall-assembly wetting, interior effect, and the condition of adjacent flashings not observed are separately documented and traced.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-FLS-02 — Valley damage (metal, lined, or shingle-woven)',
      entryKey: 'DET-AS-FLS-02',
      applicabilityConditions: ['wind_damage', 'hail_damage', 'valley_damage_documented'],
      statement:
        'A valley carries the combined flow of two roof planes through the covering\'s narrowest drainage path, at the highest volume and velocity the roof develops. Deformation of valley metal alters the path that flow follows and can direct water beneath the covering at the deformation; a puncture, tear, or open lap is a breach at the point of the roof\'s greatest concentrated flow. Where the record documents a closed-cut or woven valley, the shingles crossing and terminating in the valley are themselves the drainage surface, and damage to those shingles is damage to the valley\'s water-carrying function at that location.',
      requiredSupport:
        'Valley type from the field record (open metal / closed-cut / woven / lined); the observed interface condition recorded wherever the shingle-to-valley relationship is asserted; photograph with location.',
      limitation:
        'The documented condition establishes the breach or altered path at that location; water entry beneath the valley, underlayment condition, and deck condition beneath the valley are separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-FLS-03 — Edge metal displaced, deformed, or separated (drip edge / rake edge)',
      entryKey: 'DET-AS-FLS-03',
      applicabilityConditions: ['wind_damage', 'edge_metal_displaced'],
      statement:
        'Edge metal terminates the covering at the eave and rake, carries water off the deck edge to the gutter or beyond the fascia, and provides the backing to which the covering\'s most wind-exposed edge is fastened and bonded. Where edge metal is displaced, deformed, or separated, that line is not held at the location documented: water at the edge can return behind the metal to the deck edge or fascia, and the first course\'s edge and the underlayment termination are exposed at the displacement.',
      requiredSupport:
        'Photograph and location; the observed bond or fastening condition of the covering at the metal recorded wherever the covering\'s edge attachment is asserted.',
      limitation:
        'Edge-metal condition does not establish fascia, deck-edge, or gutter damage, nor water entry behind the metal; each is separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-PEN-01 — Pipe flashing / boot damage',
      entryKey: 'DET-AS-PEN-01',
      applicabilityConditions: ['wind_damage', 'pipe_flashing_damaged'],
      statement:
        'A pipe flashing closes the covering around a penetration by a base flange lapped into the shingle courses and a collar sealing against the pipe. Where the collar is split, torn, or separated from the pipe, or the flange is lifted, displaced, or deformed, the penetration is open at the location documented and water reaching it is not returned onto the covering. A base flange lapped beneath the upslope courses is not replaced or re-seated without disturbing those courses.',
      requiredSupport:
        'Whether the observed condition is a break, separation, or displacement — as against a weathering condition — recorded as observed; documented impact, displacement, or disturbance evidence wherever a storm mechanism is asserted.',
      limitation:
        'An open condition at the penetration is established by the observation; water entry is separately documented. Collar weathering alone does not establish an event mechanism, and cause is not established absent the documented impact or displacement evidence.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-PEN-02 — Damaged vent or roof-mounted component remaining in place',
      entryKey: 'DET-AS-PEN-02',
      applicabilityConditions: ['wind_damage', 'hail_damage', 'vent_component_damaged'],
      statement:
        'A roof-mounted ventilation or utility component closes the covering at its own opening through a flange lapped into the shingle courses, and it excludes weather at that opening through its formed geometry — louvers, baffles, hood, and throat — while admitting air. Where the record documents fracture, puncture, displacement at the mount, or deformation of that geometry, the component no longer excludes weather at the opening as it was formed to, and deformation of formed sheet metal or molded plastic components is permanent. A flange lapped into the courses is not replaced without disturbing the courses that lap it.',
      requiredSupport:
        'The component type and the specific altered feature recorded with photographs; product identification and the cited listing or specification before any assertion regarding a rated performance (net free area, wind-driven-rain or wind-uplift listing).',
      limitation:
        'Deformation establishes the altered geometry documented; it does not establish loss of a listed performance absent the product reference, nor water entry at the opening, which is separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-PEN-03 — Skylight or curb-mounted unit / flashing interface damage',
      entryKey: 'DET-AS-PEN-03',
      applicabilityConditions: ['wind_damage', 'hail_damage', 'skylight_interface_damaged'],
      statement:
        'A skylight interrupts the roof plane, and the assembly closes around it through the curb, the head, sill, and step flashing at its perimeter, and the glazing seal. Where the glazing or dome is fractured, or the curb or perimeter flashing is displaced, deformed, or separated, the roof plane is not closed at the unit\'s perimeter to the extent documented. Perimeter flashing is set within the shingle courses, and the interface is not corrected without disturbing the courses that lap it.',
      requiredSupport:
        'Photographs of the specific interface; product identification and the manufacturer\'s flashing-kit or installation instruction cited (STD-MFR-01, installed-product instructions gated to an identified product) wherever a corrective method or assembly requirement for the unit is stated.',
      limitation:
        'This entry establishes the documented condition at the unit and its perimeter. Interior wetting at the unit is separately documented and traced, and condensation or glazing-seal conditions are distinguished in the record from impact and displacement.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-UND-01 — Underlayment damage observed at exposure',
      entryKey: 'DET-AS-UND-01',
      applicabilityConditions: ['deck_exposed', 'underlayment_damage_observed'],
      statement:
        'The underlayment is the covering\'s secondary water-shedding layer and the layer relied upon wherever the covering is breached or opened. Where the record documents tears, holes, displacement, or separated laps at an exposed location, that secondary layer is not continuous there, and water passing the covering at that area reaches the deck.',
      requiredSupport:
        'The exposure means (covering absent, first course lifted, removal at repairability assessment, tear-off) and location recorded with the observation and photograph.',
      limitation:
        'The observation establishes the underlayment\'s condition at the exposed location only; condition beneath intact covering is undetermined and is recorded as undetermined pending exposure. This entry does not establish deck deterioration (DET-IN-03) or interior effect. Underlayment damage arising from a documented removal is recorded under DET-AS-RPR-07.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-UND-02 — Water pathway traced at exposure',
      entryKey: 'DET-AS-UND-02',
      applicabilityConditions: ['interior_damage', 'water_path_traced'],
      statement:
        'Where the record traces a continuous path from a documented breach in the covering, through the underlayment and deck, to a wetted location in the assembly, the wetting at the traced location shares the origin of that breach, and the traced pathway remains available at each subsequent wetting event until the breach is closed.',
      requiredSupport:
        'The tracing observations recorded — what was observed or measured at each point along the path — and the exterior breach documented under its own entry.',
      limitation:
        'An exterior breach and interior wetting, absent a traced path, are two separately documented conditions and establish no relationship between them. The traced path establishes the pathway documented, not the volume, duration, or full extent of wetting.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-ATT-01 — Attachment substrate condition observed at exposure',
      entryKey: 'DET-AS-ATT-01',
      applicabilityConditions: ['deck_exposed', 'attachment_substrate_observed'],
      statement:
        'Covering attachment depends on the deck\'s capacity to hold fasteners at the locations and spacing the product\'s installation requires. Where the record documents enlarged holes, fasteners not holding, deteriorated deck material at fastener locations, or gaps leaving fastener locations unsupported, the substrate at that area does not accept attachment at the designed pattern, and fasteners re-driven at those same locations do not restore the attachment the intact substrate provided.',
      requiredSupport:
        'The observation means, location, and condition recorded; where the required fastening pattern is stated as a product requirement, the identified product\'s installation instruction cited with its locator (STD-MFR-01, gated to product_id_class == identified).',
      limitation:
        'This entry addresses fastener-holding condition observed at the exposed location; wetting-related panel deterioration is documented under DET-IN-03. It does not establish substrate condition beyond the exposed area — which is recorded as undetermined pending exposure — nor a replacement extent.',
      confidence: 1,
      reasoning: R,
    },
    // RPR series
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-01 — Seal-release damage (puncture, tear, or gouge)',
      entryKey: 'DET-AS-RPR-01',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_seal_release_damage'],
      statement:
        'Reaching a shingle beneath sealed courses requires releasing the factory sealant bond above it. Where the record documents that the release punctured, tore, or gouged a shingle that was intact at the baseline, that shingle carries an opening or loss of material the covering did not have before the manipulation, and returning the assembly to position does not undo it. The condition arises from the access the covering\'s own bonded construction requires.',
      requiredSupport:
        'RAP1 and the affected shingle\'s RAP1-D baseline detail image, establishing its pre-manipulation condition individually; the per-shingle outcome record identifying the shingle and the condition; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'Establishes the condition of shingles manipulated within the documented assessment area only, and does not establish an outcome for shingles not manipulated. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-02 — Crease, crack, or fracture in a manipulated shingle',
      entryKey: 'DET-AS-RPR-02',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_crease_crack_fracture'],
      statement:
        'Removing one shingle requires lifting and flexing the shingles that lap it and the shingles beside it. Where the record documents that a shingle intact at the baseline sustained a crease, crack, or fracture during that manipulation, its material continuity is interrupted at the location recorded, the fracture does not re-fuse when the shingle is returned to position, and the shingle does not thereafter lie and load at that location as it did before the manipulation.',
      requiredSupport:
        'RAP1 and the affected shingle\'s RAP1-D baseline detail image; the per-shingle outcome record with the shingle number and condition; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-03 — Laminate delamination in a manipulated shingle',
      entryKey: 'DET-AS-RPR-03',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_delamination'],
      statement:
        'A laminate shingle is two sheets bonded at the factory to act as a single unit. Where the record documents that a shingle intact at the baseline separated at that lamination during the manipulation, the shingle is no longer the single bonded unit it was: the separated sheets move independently under wind and thermal load, and the factory lamination is not reconstituted in the field.',
      requiredSupport:
        'RAP1 and the affected shingle\'s RAP1-D baseline detail image; the per-shingle outcome record with the shingle number and condition; the covering identified or observed as a laminate product; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-04 — Mat transfer to the underlying course',
      entryKey: 'DET-AS-RPR-04',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_mat_transfer'],
      statement:
        'Where a shingle is pulled from a sealed course, the factory bond can hold to the shingle below more strongly than that shingle\'s own surface holds together, and its surfacing and mat separate and travel with the removed shingle. Where the record documents mat transfer on an underlying shingle, that shingle\'s surfacing and mat are absent at the transfer location, the transferred material does not return, and the asphalt exposed at the transfer weathers without its surfacing for the shingle\'s remaining service.',
      requiredSupport:
        'RAP1 and the RAP1-D baseline detail images for the underlying shingles; the individual per-shingle mat-transfer determinations from the assessment record; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'Mat transfer is determined individually; a determination on one underlying shingle does not establish the condition of another. Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-05 — Nail pull-through or nail-zone damage during removal or refastening',
      entryKey: 'DET-AS-RPR-05',
      applicabilityConditions: [
        'repairability_assessment_performed',
        'rpr_nail_zone_damage',
        'rpr_refastened_new_holes',
      ],
      statement:
        'The nail zone is the band the product\'s installation instructions designate for fastening, and it is where the shingle\'s attachment strength is developed. Where the record documents pull-through or damage within the nail zone of a shingle intact at the baseline, the attachment available at that location is not the attachment the intact shingle provided, and the damaged zone does not accept a fastener at the same location. Where the record documents that fasteners were reinstated at new hole locations, the original fastener penetrations remain in the manipulated shingle and the reinstated attachment is not the original attachment.',
      requiredSupport:
        'RAP1 and the affected shingle\'s RAP1-D baseline detail image; the per-shingle outcome record with the shingle number and condition; the record of refastening locations where that clause is rendered; the identified product\'s installation instruction with locator (STD-MFR-01, gated to product_id_class == identified) wherever the designated nail zone is stated as a product requirement; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'Does not establish water entry at any penetration. Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-06 — Failure to re-seat or re-secure',
      entryKey: 'DET-AS-RPR-06',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_reseat_failure'],
      statement:
        'A completed repair returns the manipulated shingles to their designed position, lying flat and secured. Where the recorded verification documents that a manipulated shingle does not lie flat or could not be properly re-secured, the covering at that location has not been returned by the repair to the configuration it held before the manipulation. A field-applied adhesive is not the factory sealant strip, and whether field sealing restores the identified product\'s listed wind-resistance configuration is determined by that product\'s installation instructions and listing, cited wherever the question bears on the corrective scope.',
      requiredSupport:
        'The re-seat verification method and result recorded; the per-shingle outcome record; the identified product\'s instructions and listing cited (STD-MFR-01 / STD-PRD-01, installed-product instructions gated to product_id_class == identified) wherever field-sealing adequacy or wind-resistance configuration is addressed; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'A shingle that re-seats flat is not thereby established to have regained its factory sealant bond; bond condition is separately documented. Field-sealing adequacy is not established absent the cited product position. Establishes the condition of shingles manipulated within the documented assessment area only. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-07 — Underlayment damage at the removal location',
      entryKey: 'DET-AS-RPR-07',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_underlayment_damage'],
      statement:
        'Removing a shingle exposes the underlayment beneath it, and the fasteners withdrawn pass through that layer. Where the record documents that the removal tore, holed, or displaced the underlayment at that location, the secondary water-shedding layer is interrupted at the point documented — and it is interrupted beneath the covering that is returned over it.',
      requiredSupport:
        'The removal-location observation and photograph taken while the shingle was out; the attribution to the removal process recorded; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator.',
      limitation:
        'Establishes the underlayment condition at the removal location only; underlayment conditions documented at other exposures are recorded under DET-AS-UND-01. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-08 — Collateral damage to an adjacent system component',
      entryKey: 'DET-AS-RPR-08',
      applicabilityConditions: [
        'repairability_assessment_performed',
        'rpr_component_adjacent_attempt',
        'rpr_collateral_component',
      ],
      statement:
        'Field shingles lap, and are lapped by, the roof system\'s other components, and reaching a field shingle adjacent to such a component requires disturbing it. Where the record documents that the manipulation damaged or displaced a component that was intact before it, that component\'s condition is a consequence of the access the repair required, and the affected area extends past the field covering to the component documented.',
      requiredSupport:
        'The component\'s condition recorded before manipulation; the necessity of the manipulation recorded; the resulting condition photographed and identified; the resulting condition also documented under the component\'s own entry (DET-AS-RDG-01, DET-AS-STR-01, DET-AS-FLS-01/02/03, DET-AS-PEN-01/02/03) where the corrective scope addresses it; STD-RPR-INT-01 cited by version and §11 identified as the procedure applied.',
      limitation:
        'Establishes the condition of the component documented; the pre-manipulation condition of components not recorded at baseline is undetermined, and no outcome is established for components not disturbed. A component-adjacent attempt is excluded from the damage rate, damage ratio, and total repairability assessment score, which measure the standard field-shingle assessment area only, and no rendered text may report it as part of those measures. Where no component-adjacent attempt was performed, that absence is not a finding about how a component would respond. The attempt supplements — never replaces — the damage documentation establishing the loss.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-09 — Concealed assembly condition exposed at manipulation',
      entryKey: 'DET-AS-RPR-09',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_concealed_condition_exposed'],
      statement:
        'Conditions beneath the covering are not observable until the covering is opened. Where a documented manipulation opened the covering and a condition of the underlayment, deck, or attachment was observed there, the record establishes that condition at the exposed location as of the exposure date; the assembly\'s condition elsewhere beneath intact covering remains undetermined pending exposure. The exposure records the condition; it does not produce it.',
      requiredSupport:
        'The exposure means, date, and location; the observed condition documented under its own entry (DET-AS-UND-01, DET-AS-ATT-01, or DET-IN-03); STD-RPR-INT-01 cited by version.',
      limitation:
        'This entry establishes the exposure and the scope of what was observable through it. It does not establish the cause, mechanism, or age of the condition exposed — each is separately documented — and it does not extend the observation beyond the opened area. The assessment supplements — never replaces — the damage documentation establishing the loss.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-AS-RPR-10 — Material response under controlled manipulation',
      entryKey: 'DET-AS-RPR-10',
      applicabilityConditions: ['repairability_assessment_performed', 'rpr_conditions_recorded'],
      statement:
        'The response of this covering to the manipulation a localized repair requires is observed and recorded under stated conditions rather than assumed. The assessment record documents, for each shingle manipulated, whether it sustained a condition it did not have at the baseline, and it documents the temperature, wind, and surface conditions under which that response was observed. The record is of the observed physical response of this covering, at this date, under these conditions.',
      requiredSupport:
        'The timestamped assessment-start conditions capture (taken immediately before seal release, not the Stage 2 arrival record), with any departure from the method\'s reference conditions (air temperature 40–90°F, wind gusts under 25 mph, dry surfaces, no imminent precipitation, in-season testing preferred) noted together with its bearing on the results, and any material mid-assessment change recorded with its timestamp; STD-RPR-INT-01 cited by version and STD-RPR-01 cited by locator for the environmental-conditions proposition.',
      limitation:
        'The observed response does not establish that age, weathering, or brittleness is itself a damage condition, and no rendered text may assert that it does. The record does not extend to a manipulation performed under materially different conditions, nor to shingles not manipulated. The assessment supplements — never replaces — the damage documentation establishing the loss, and is cited as aligned with STD-RPR-01\'s mechanics, not as performed under it.',
      confidence: 1,
      reasoning: R,
    },
    // Vinyl siding
    {
      destination: 'detriment',
      label: 'DET-VS-01 — Vinyl siding impact fracture',
      entryKey: 'DET-VS-01',
      applicabilityConditions: ['siding_damage', 'siding_fracture'],
      statement:
        'A fractured vinyl panel cannot be restored to an intact, continuous panel: vinyl does not rejoin, and patching does not reconstitute the panel\'s continuous surface. The fracture is an opening in the cladding at that panel, can admit wind-driven water behind the cladding plane at the break, and is subject to propagation from the crack tips under thermal movement. Where the fracture affects the panel\'s weather-shedding function, integrity, or appearance, correction is by replacement of the affected panel.',
      requiredSupport:
        'None for the statement as written; propagation asserted as susceptibility, not schedule.',
      limitation:
        'A panel fracture does not by itself establish wetting of the water-resistive barrier or sheathing; effects behind the cladding depend on the assembly and are as documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-VS-02 — Unlocked / displaced panel',
      entryKey: 'DET-VS-02',
      applicabilityConditions: ['siding_damage', 'siding_unlocked', 'siding_lock_deformed'],
      statement:
        'A panel unseated from its interlock is not restrained as designed: the open lock can admit wind and wind-driven water behind the cladding, and an unrestrained panel works under wind load, stressing its remaining engagement and fastening. Where the record documents deformation of the locking profile, re-seating does not restore the designed engagement, and correction is by replacement of the affected panel; where no lock deformation is documented, the panel\'s capacity to re-engage is as observed in the field record.',
      requiredSupport:
        'Deformation documented (photograph or noted failed re-engagement) before the deformation consequence is rendered.',
      limitation:
        'Simple unseating does not establish lock damage; the two conditions are documented and treated separately.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-VS-03 — Puncture / debris impact',
      entryKey: 'DET-VS-03',
      applicabilityConditions: ['siding_damage', 'siding_puncture'],
      statement:
        'A puncture is an opening in the cladding at the panel and can admit wind-driven water behind the siding at that point. The consequence of water behind the cladding depends on the assembly: where a water-resistive barrier is present and intact, the barrier is the next plane of protection; where the record documents no barrier, water entering at the puncture can reach the sheathing directly. The assembly condition behind the cladding is as documented in the inspection record, including the recorded presence or absence of a water-resistive barrier.',
      requiredSupport:
        'The WRB determination from the field record (present / absent / undetermined) accompanies any statement about what lies behind the cladding.',
      limitation:
        'A puncture does not by itself establish wetting or deterioration of the barrier or sheathing.',
      confidence: 1,
      reasoning: R,
    },
    // Cedar shake
    {
      destination: 'detriment',
      label: 'DET-CS-01 — Fresh split (impact or wind)',
      entryKey: 'DET-CS-01',
      applicabilityConditions: ['hail_and_wind', 'shake_split_fresh'],
      statement:
        'A split shake no longer sheds water as a single unit: the split is an opening in the shake\'s coverage, exposing the interlayment and fastening beneath it to water at that line, and the split halves move independently under wind and thermal load. Freshly exposed wood within the split — distinguishable from aged splits by its unweathered interior faces — absorbs water preferentially at the opening.',
      requiredSupport:
        'The fresh/aged distinction documented in the record where the split\'s recency is asserted.',
      limitation:
        'A split establishes the opening; decay, leakage, and service-life effect are not established by the split alone.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-CS-02 — Impact crush / fiber bruising',
      entryKey: 'DET-CS-02',
      applicabilityConditions: ['hail_damage', 'shake_crush_confirmed'],
      statement:
        'Where crushing of the wood surface is identified by a documented method, the compressed area\'s capacity to shed rather than absorb water is reduced at that location, and preferential water retention at a crushed area is a recognized contributor to localized deterioration in wood roofing materials.',
      requiredSupport:
        'The identification method stated in the record; a wood-material or industry technical reference where service-life consequence is asserted.',
      limitation:
        'Surface marks without a documented identification method do not establish fiber crushing; this entry does not establish decay or a quantified life reduction.',
      confidence: 1,
      reasoning: R,
    },
    // Sheet metal
    {
      destination: 'detriment',
      label: 'DET-SM-01 — Impact indentation (metal)',
      entryKey: 'DET-SM-01',
      applicabilityConditions: ['metal_dents', 'hail_damage', 'coating_breach_confirmed'],
      statement:
        'An impact indentation is a permanent deformation: the metal has yielded and does not recover its formed geometry. Where inspection confirms fracture of the finish or exposed substrate at the deformation, the panel\'s factory corrosion protection is breached at that point, and the breach is the location from which corrosion of the substrate can initiate. Where indentations alter panel geometry at seams, ribs, or drainage planes, the effect on the panel\'s designed drainage or engagement at those locations is evaluated and documented.',
      requiredSupport:
        'Coating fracture / substrate exposure confirmed and documented before any corrosion-related assertion; geometry effects at seams or drainage documented where asserted.',
      limitation:
        'An indentation alone does not establish coating fracture, corrosion initiation, or functional impairment; those conditions are confirmed, not inferred.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-SM-02 — Disengaged seam / clip (wind)',
      entryKey: 'DET-SM-02',
      applicabilityConditions: ['wind_damage', 'seam_disengaged'],
      statement:
        'In a standing seam system the seam is both the structural connection and the waterproofing joint. A documented disengaged seam or clip no longer restrains the panel as designed and no longer closes the joint at the disengagement: the panel can work under wind load at the open connection, and the open seam can admit wind-driven water. Panel systems are engineered as continuous assemblies, and a disengaged connection shifts uplift demand to adjacent connections beyond the design\'s allocation at that location.',
      requiredSupport:
        'None beyond the documented disengagement; system-level engineering statements kept to the design principle stated.',
      limitation:
        'A disengagement establishes the open connection; water entry and adjacent-connection damage are as separately documented.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-SM-03 — Finish fracture / coating breach',
      entryKey: 'DET-SM-03',
      applicabilityConditions: ['metal_dents', 'coating_breach_confirmed'],
      statement:
        'The factory-applied coating is the panel\'s corrosion protection, and a documented breach through to substrate is the point at which that protection is absent. Corrosion of exposed substrate initiates at such a breach and can undercut adjacent finish over time. Whether field-applied touch-up constitutes an accepted repair of the identified panel\'s coating system is determined by the panel manufacturer\'s published repair and finish-warranty position, which is cited where this determination bears on the corrective scope.',
      requiredSupport:
        'Manufacturer repair/warranty position for the identified panel and finish, cited wherever touch-up adequacy is addressed.',
      limitation:
        'A coating breach does not establish present corrosion beyond what is observed, nor the manufacturer\'s position absent the citation.',
      confidence: 1,
      reasoning: R,
    },
    // Interior / structural
    {
      destination: 'detriment',
      label: 'DET-IN-01 — Wetted insulation',
      entryKey: 'DET-IN-01',
      applicabilityConditions: ['interior_damage', 'insulation_wetted'],
      statement:
        'Insulation performs thermally by trapping air within its structure, and wetting displaces that function: wetted insulation may experience reduced thermal performance, and wetting can compress loose-fill and batt structure. Recoverability on drying depends on the material type, the water exposure, and the material\'s documented condition; retained moisture within insulation also holds adjacent framing and finishes wet, extending the assembly\'s drying. Evaluation and disposition of wetted insulation follow the applicable water-damage restoration standard for the material and water category documented.',
      requiredSupport:
        'Insulation type and observed/measured condition in the record; restoration-standard citation (S500 entry — human-entered locator) where disposition is stated.',
      limitation:
        'Wetting alone does not establish permanent performance loss for every material; the documented type, condition, and standard govern.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-IN-02 — Water-affected gypsum drywall',
      entryKey: 'DET-IN-02',
      applicabilityConditions: ['interior_damage', 'drywall_water_affected'],
      statement:
        'Gypsum board is degraded by wetting in proportion to the exposure: wetting can soften the core, delaminate the paper facing, and reduce fastener holding at the affected area. Wetted gypsum is evaluated for loss of integrity, delamination, contamination, and restorability under the applicable water-damage restoration standard, considering the water category, duration, and the material\'s documented condition; material that cannot be restored to its pre-loss condition under that standard is removed and replaced.',
      requiredSupport:
        'Documented condition observations; restoration-standard citation (S500 entry — human-entered locator) where the evaluation criteria or disposition are stated.',
      limitation:
        'Water contact alone does not establish that all affected board requires removal; the documented evaluation under the standard governs the disposition.',
      confidence: 1,
      reasoning: R,
    },
    {
      destination: 'detriment',
      label: 'DET-IN-03 — Wetted structural sheathing / decking',
      entryKey: 'DET-IN-03',
      applicabilityConditions: ['interior_damage', 'deck_deterioration_documented'],
      statement:
        'Wood structural panels are subject to edge swelling, glue-line delamination, and reduced fastener holding from water exposure. Where the record documents such deterioration — swelling, delamination, decay, or measured degradation — the affected panel no longer provides the solid, nailable substrate that covering attachment requires at that area, and the deteriorated area is corrected before new covering is installed. Deck condition concealed by the covering is confirmed at tear-off, and the record is supplemented with the exposed conditions.',
      requiredSupport:
        'The documented deterioration observation (or tear-off confirmation) before the substrate-consequence statement is rendered.',
      limitation:
        'A wetting event alone does not establish panel deterioration; undetermined deck condition is recorded as undetermined pending exposure.',
      confidence: 1,
      reasoning: R,
    },
  ];
}
