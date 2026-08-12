import { describe, expect, it } from 'vitest';

import { buildProofPackageHtml, type ProofPackageData, type ProofPackageComparisonExhibit } from '../proofPackageTemplate';

const baseData: ProofPackageData = {
  reportId: 'ABC12345',
  generatedAt: '2026-07-29T12:00:00Z',
  company: {
    legalName: 'Apex Restoration LLC',
    brand: 'Apex',
    licenses: [{ state: 'VA', number: '2705-064938A', classification: 'VA Class A Contractor' }],
    qualificationsText: 'Apex has documented over 1,000 storm-damage inspections.',
    pricingBasisStatement: 'Pricing reflects the contractor\u2019s fixed agreed price.',
  },
  statePack: {
    jurisdictionLabel: 'State of VA',
    homeownerRights: {
      title: 'Homeowner Information',
      subtitle: 'Your rights under Virginia law',
      preparedByNote: 'Prepared by {{contractor}} ({{license}}).',
      sections: [{ heading: 'Your Policy', paragraphs: ['You have the right to {{contractor}} docs.'] }],
      complaintBlock: ['Virginia Bureau of Insurance', '1-877-310-6560'],
      closingDisclaimer: '{{contractor}} is not a public adjuster.',
    },
    uppaDisclaimer: 'This report documents physical damage only.',
    uppaStatute: 'Va. Code § 38.2-1845.1',
    codeCitations: [
      { key: 'drip_edge', element: 'Drip edge', title: 'Drip edge required', cite: 'R905.2.8.5', body: 'A drip edge shall be provided.' },
    ],
  },
  property: {
    address: '4312 Chain Bridge Rd, Fairfax, VA 22030',
    addressShort: '4312 Chain Bridge Rd',
    insuredName: 'Maria Reyes',
    carrier: 'Sentinel Mutual',
    policyNumber: 'HO-99321',
    claimNumber: 'CLM-2026-0417',
    dateOfLoss: 'April 17, 2026',
    phase1Date: 'April 20, 2026',
    phase2Date: 'July 28, 2026',
  },
  inspectorName: 'Jordan Ellis',
  coverPhotoUrl: null,
  storm: {
    type: 'Hail',
    dateLocalTime: 'April 17, 2026',
    hailSize: '1.75" diameter',
    windSpeed: '58 mph',
    distance: '0.4 mi from property',
    coordinates: 'Fairfax, VA',
    source: 'Certified weather data',
    narrative: null,
    note: 'Quarter to golf-ball size hail reported.',
  },
  methodology: {
    inspectedAt: 'July 28, 2026',
    conditions: 'Sky: clear · Wind: calm',
    equipment: ['Ladder', 'Chalk'],
    capture: { elevations: 4, slopes: 6, testSquares: 4, totalHits: 62, damageInstances: 18, photos: 74 },
  },
  areasImpacted: [
    { key: 'roof', name: 'Roof System', impacted: true },
    { key: 'siding', name: 'Siding / Exterior', impacted: false },
    { key: 'collateral', name: 'Collateral', impacted: true },
    { key: 'interior', name: 'Interior / Attic', impacted: false },
  ],
  components: {
    roof: [{ component: 'Front Slope', condition: 'Hail bruising — 8 documented damage instances', method: 'Full replacement', verdict: 'replace' }],
  },
  aiSections: { forensicSummary: 'Widespread hail impact damage.\nMat fractures observed.', repairabilityText: 'Repair is not supported.' },
  measurement: {
    slopes: [{ label: 'Front Slope', sqft: 640 }, { label: 'Rear Slope', sqft: 655 }],
    linear: [{ type: 'ridge', lf: 42 }],
    totalSqft: 1295,
    squares: 12.95,
  },
  scope: {
    lineItems: [
      { description: 'Remove & replace laminated shingles', qty: 14.25, unit: 'SQ', rate: 425, total: 6056.25, isAdder: false },
      { description: 'Ice & water shield at eaves', qty: 120, unit: 'LF', rate: 3.5, total: 420, isAdder: true, trigger: 'Code-required at eaves', codeRefs: ['R905.1.2'] },
    ],
    subtotal: 6476.25,
    basePricePerSquare: 425,
    squares: 14.25,
  },
  product: { name: 'Legacy Shingle XT', identification: '13.25" width, 5.625" exposure', discontinued: true, discontinuedNote: 'Matched against discontinued catalog.' },
  photos: [
    { id: 'photo-aaaa-1111', url: null, stage: 'roof', subject: 'Front Slope', caption: 'Hail bruise with mat fracture', sha256: 'ab12cd34ef56ab12cd34', area: 'roof' },
    { id: 'photo-bbbb-2222', url: null, stage: 'collateral', subject: 'Downspout', caption: 'Fresh dent, soft metal', sha256: null, area: 'collateral' },
  ],
  attestationHtml: '<p>I, Jordan Ellis, personally conducted this inspection.</p>',
  extras: {
    propertyDetailsHtml: '<table class="detail-table"><tr><th>Type</th><td>Single family</td></tr></table>',
    rapSectionHtml: '<table class="detail-table"><tr><th>Scorecard</th><th>Count</th></tr><tr><td>Manipulated shingles</td><td>8</td></tr></table>',
    vapSectionHtml: null,
    evidenceScopeIndexHtml: '<p>Index</p>',
    evidenceManifestHtml: '<p>Manifest</p>',
    unlockLogHtml: null,
  },
  portalAccess: { url: 'https://portal.example.com', code: 'ZK7-Q2M' },
  theme: undefined,
  logoUrl: null,
  signatureUrl: null,
};

/** A cause_differentiation comparison pair for use in tests. */
const sampleCauseDiffExhibit: ProofPackageComparisonExhibit = {
  pairId: 'pair-cd-0001',
  pairType: 'cause_differentiation',
  setCaption:
    'Comparison — localized impact condition (top) and general surface weathering (bottom), south slope.',
  before: {
    id: 'photo-before-0001',
    url: null,
    stage: 'test_squares',
    subject: 'South slope — hail impact zone',
    caption: 'Photo — Exhibit C-1 — conditions documented as localized hail-impact bruising with granule displacement.',
    sha256: null,
    area: 'roof',
    perPhotoCaption:
      'Photo — Exhibit C-1 — conditions documented as localized hail-impact bruising with granule displacement.',
  },
  after: {
    id: 'photo-after-0001',
    url: null,
    stage: 'components',
    subject: 'South slope — field shingles',
    caption: 'Photo — Exhibit C-2 — conditions documented as uniform age-related surface wear across field shingles.',
    sha256: null,
    area: 'roof',
    perPhotoCaption:
      'Photo — Exhibit C-2 — conditions documented as uniform age-related surface wear across field shingles.',
  },
};

describe('buildProofPackageHtml', () => {
  it('renders all numbered sections and supplemental pages when all data is present', () => {
    const html = buildProofPackageHtml(baseData);
    // Template uses sequential numbers (01, 02, …) — not fixed A–M letters.
    // Verify all 13 sections appear by their section titles.
    const expectedSections = [
      'Homeowner Information',
      'Statement of Qualifications',
      'Inspection Methodology',
      'Storm Event Verification',
      'Damage Documentation',
      'Repairability Assessment',
      'Manufacturer Documentation',
      'Measurement Report',
      'Applicable Codes',        // "& Regulations" is HTML-escaped in the eyebrow
      'Scope of Work',           // "& Pricing Basis" is HTML-escaped
      'Conditions',              // "& Adders" is HTML-escaped
      'Contract Exhibit',
      'Repairability Conclusion',
    ];
    for (const title of expectedSections) {
      expect(html).toContain(title);
    }
    // Token substitution.
    expect(html).toContain('Prepared by Apex Restoration LLC (VA Class A Contractor License #2705-064938A).');
    expect(html).not.toContain('{{contractor}}');
    // Supplemental sections and portal.
    expect(html).toContain('Repair Attempt Protocol');
    expect(html).toContain('Evidence Manifest');
    expect(html).toContain('ZK7-Q2M');
    // Money formatting and UPPA block.
    expect(html).toContain('$6,476.25');
    expect(html).toContain('Va. Code § 38.2-1845.1');
  });

  it('omits inapplicable sections when optional data is absent', () => {
    const html = buildProofPackageHtml({
      ...baseData,
      storm: null,        // no Storm Event Verification
      product: null,      // no Manufacturer Documentation
      measurement: null,  // no Measurement Report
      statePack: { ...baseData.statePack, codeCitations: [] }, // no Applicable Codes
    });
    // Omitted sections leave no trace.
    expect(html).not.toContain('Storm Event Verification');
    expect(html).not.toContain('Manufacturer Documentation');
    expect(html).not.toContain('Measurement Report');
    expect(html).not.toContain('Applicable Codes');
    // Sections that remain are still rendered (numbers shift but titles are stable).
    expect(html).toContain('Scope of Work');
    expect(html).toContain('Repairability Conclusion');
  });

  it('escapes untrusted text fields', () => {
    const html = buildProofPackageHtml({
      ...baseData,
      property: { ...baseData.property, insuredName: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ── Comparison exhibit (Class C) ────────────────────────────────────────

  it('cause_differentiation pair renders exactly three caption strings in the correct structure', () => {
    const html = buildProofPackageHtml({
      ...baseData,
      comparisonExhibits: [sampleCauseDiffExhibit],
    });

    // 1. Set caption — the pair-level narrative
    expect(html).toContain(
      'Comparison — localized impact condition (top) and general surface weathering (bottom), south slope.',
    );

    // 2. Top (before) per-photo caption
    expect(html).toContain(
      'Photo — Exhibit C-1 — conditions documented as localized hail-impact bruising with granule displacement.',
    );

    // 3. Bottom (after) per-photo caption
    expect(html).toContain(
      'Photo — Exhibit C-2 — conditions documented as uniform age-related surface wear across field shingles.',
    );

    // Type label appears in the exhibit ribbon
    expect(html).toContain('COMPARISON EXHIBIT — Cause Differentiation');

    // Role tags for top/bottom orientation
    expect(html).toContain('Top');
    expect(html).toContain('Bottom');

    // The unbreakable block is present (page-break-inside guard)
    expect(html).toContain('page-break-inside:avoid');
  });

  it('comparison exhibit block is contained within the Damage Documentation section', () => {
    const html = buildProofPackageHtml({
      ...baseData,
      comparisonExhibits: [sampleCauseDiffExhibit],
    });

    // The comparison ribbon should appear after the section header
    const sectionIdx = html.indexOf('Damage Documentation');
    const ribbonIdx = html.indexOf('COMPARISON EXHIBIT');
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(ribbonIdx).toBeGreaterThan(sectionIdx);
  });

  it('renders without comparison exhibits when none provided', () => {
    const html = buildProofPackageHtml({ ...baseData, comparisonExhibits: [] });
    expect(html).not.toContain('COMPARISON EXHIBIT');
    expect(html).not.toContain('page-break-inside:avoid');
  });

  it('escapes untrusted content in comparison exhibit captions', () => {
    const injected: ProofPackageComparisonExhibit = {
      ...sampleCauseDiffExhibit,
      setCaption: '<script>evil()</script>',
      before: { ...sampleCauseDiffExhibit.before, perPhotoCaption: '<img onerror=x>' },
      after: { ...sampleCauseDiffExhibit.after, perPhotoCaption: 'safe' },
    };
    const html = buildProofPackageHtml({ ...baseData, comparisonExhibits: [injected] });
    expect(html).not.toContain('<script>evil()');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });
});
