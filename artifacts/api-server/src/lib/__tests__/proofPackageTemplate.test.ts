import { describe, expect, it } from 'vitest';

import { buildProofPackageHtml, type ProofPackageData } from '../proofPackageTemplate';

const baseData: ProofPackageData = {
  reportId: 'ABC12345',
  generatedAt: '2026-07-29T12:00:00Z',
  company: {
    legalName: 'NuHome Exteriors LLC',
    brand: 'NuHome',
    licenses: [{ state: 'VA', number: '2705-064938A', classification: 'VA Class A Contractor' }],
    qualificationsText: 'NuHome has documented over 1,000 storm-damage inspections.',
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

describe('buildProofPackageHtml', () => {
  it('renders all applicable exhibits with fixed letters and supplemental pages', () => {
    const html = buildProofPackageHtml(baseData);
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      expect(html).toContain(`Exhibit ${letter} —`);
    }
    // Token substitution.
    expect(html).toContain('Prepared by NuHome Exteriors LLC (VA Class A Contractor License #2705-064938A).');
    expect(html).not.toContain('{{contractor}}');
    // Supplemental sections and portal.
    expect(html).toContain('Repair Attempt Protocol');
    expect(html).toContain('Evidence Manifest');
    expect(html).toContain('ZK7-Q2M');
    // Money formatting and UPPA block.
    expect(html).toContain('$6,476.25');
    expect(html).toContain('Va. Code § 38.2-1845.1');
  });

  it('omits inapplicable exhibits without shifting letters', () => {
    const html = buildProofPackageHtml({
      ...baseData,
      storm: null, // no Exhibit D
      product: null, // no Exhibit G
      measurement: null, // no Exhibit H
      statePack: { ...baseData.statePack, codeCitations: [] }, // no Exhibit I
    });
    expect(html).not.toContain('Exhibit D —');
    expect(html).not.toContain('Exhibit G —');
    expect(html).not.toContain('Exhibit H —');
    expect(html).not.toContain('Exhibit I —');
    // J keeps its letter even with earlier exhibits omitted.
    expect(html).toContain('Exhibit J —');
    expect(html).toContain('Exhibit M —');
  });

  it('escapes untrusted text fields', () => {
    const html = buildProofPackageHtml({
      ...baseData,
      property: { ...baseData.property, insuredName: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
