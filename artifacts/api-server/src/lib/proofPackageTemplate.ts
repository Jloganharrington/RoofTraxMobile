import type {
  CodeCitation,
  ContractorLicense,
  HomeownerRightsContent,
} from '@workspace/db';

import { escHtml, type ReportTheme, resolveReportTheme } from './reportTemplate';

// ── Proof Package (Phase 2 forensic report) — A–M exhibit template ─────────
// Server-side renderer for the paged "sheet" Proof Package: cover, summary &
// contents, canonical exhibits A–M in fixed letters (an exhibit that doesn't
// apply is OMITTED — letters never re-shift), supplemental sections carried
// over from the prior design (RAP/VAP scorecards, evidence-to-scope index,
// evidence manifest, portal access), and the certification page.
//
// All content is rendered server-side; a tiny inline script only fills page
// numbers and the contents page references after layout (they depend on the
// final page count, which is unknowable server-side).

export type ProofPackagePhoto = {
  id: string;
  /** Fresh signed URL, resolved at render time. Null renders a placeholder. */
  url: string | null;
  stage: string | null;
  subject: string;
  caption: string;
  sha256: string | null;
  area: 'roof' | 'siding' | 'interior' | 'collateral' | 'general';
};

export type ProofPackageScopeLine = {
  description: string;
  qty: number;
  unit: string;
  /** Dollars. */
  rate: number;
  /** Dollars. */
  total: number;
  isAdder: boolean;
  trigger?: string | null;
  codeRefs?: string[];
};

export type ProofPackageData = {
  reportId: string;
  generatedAt: string;
  company: {
    legalName: string;
    brand: string;
    licenses: ContractorLicense[];
    qualificationsText: string;
    pricingBasisStatement: string | null;
  };
  statePack: {
    jurisdictionLabel: string;
    homeownerRights: HomeownerRightsContent | null;
    uppaDisclaimer: string | null;
    uppaStatute: string | null;
    codeCitations: CodeCitation[];
  };
  property: {
    address: string;
    addressShort: string;
    insuredName: string;
    carrier: string;
    policyNumber: string;
    claimNumber: string;
    dateOfLoss: string;
    phase1Date: string;
    phase2Date: string;
  };
  inspectorName: string;
  coverPhotoUrl: string | null;
  storm: {
    type: string;
    dateLocalTime: string;
    hailSize: string | null;
    windSpeed: string | null;
    distance: string | null;
    coordinates: string | null;
    source: string;
    narrative: string | null;
    note: string | null;
  } | null;
  methodology: {
    inspectedAt: string;
    conditions: string;
    equipment: string[];
    capture: {
      elevations: number;
      slopes: number;
      testSquares: number;
      totalHits: number;
      damageInstances: number;
      photos: number;
    };
  };
  areasImpacted: Array<{ key: ProofPackagePhoto['area']; name: string; impacted: boolean }>;
  components: Partial<
    Record<string, Array<{ component: string; condition: string; method: string; verdict: 'replace' | 'repair' | 'monitor' }>>
  >;
  /** AI narratives — already carrier-visibility-gated by the caller. */
  aiSections: { forensicSummary: string; repairabilityText: string };
  measurement: {
    slopes: Array<{ label: string; sqft: number }>;
    linear: Array<{ type: string; lf: number }>;
    totalSqft: number;
    squares: number;
  } | null;
  scope: {
    lineItems: ProofPackageScopeLine[];
    subtotal: number;
    basePricePerSquare: number | null;
    squares: number | null;
  } | null;
  product: {
    name: string;
    identification: string;
    discontinued: boolean;
    discontinuedNote: string | null;
  } | null;
  photos: ProofPackagePhoto[];
  /** Inspector attestation (AI-drafted, sanitized upstream) for certification. */
  attestationHtml: string;
  /** Supplemental pre-built inner-HTML sections (already sanitized/escaped). */
  extras: {
    propertyDetailsHtml?: string | null;
    rapSectionHtml?: string | null;
    vapSectionHtml?: string | null;
    evidenceScopeIndexHtml?: string | null;
    evidenceManifestHtml?: string | null;
    unlockLogHtml?: string | null;
  };
  portalAccess: { url: string; code: string } | null;
  theme?: ReportTheme;
  logoUrl?: string | null;
  signatureUrl?: string | null;
};

const esc = escHtml;

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** {{contractor}} / {{license}} token substitution for state-pack content. */
function fillTokens(s: string, company: ProofPackageData['company']): string {
  const l = company.licenses[0];
  const license = l ? `${l.classification} License #${l.number}` : '';
  return s.replace(/\{\{contractor\}\}/g, company.legalName).replace(/\{\{license\}\}/g, license);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

type Sheet = { runheadTitle: string; bodyHtml: string; anchor?: string };

export function buildProofPackageHtml(data: ProofPackageData): string {
  const theme = resolveReportTheme(data.theme);
  const logoHtml = data.logoUrl
    ? `<img src="${esc(data.logoUrl)}" alt="${esc(data.company.brand)} logo">`
    : '<span>LOGO</span>';

  const sheets: Sheet[] = [];
  const toc: Array<{ letter: string; title: string }> = [];
  const addExhibit = (letter: string, title: string, pages: Sheet[]) => {
    toc.push({ letter, title });
    sheets.push(...pages);
  };

  const impacted = data.areasImpacted.filter((a) => a.impacted);
  const num = (letter: string) =>
    String('ABCDEFGHIJKLM'.indexOf(letter) + 1).padStart(2, '0');

  const exHead = (letter: string, title: string, subtitle?: string) =>
    `<div class="eyebrow" data-exhibit-anchor="${esc(letter)}">${num(letter)} — Exhibit ${esc(letter)}</div>
     <h2 class="section-title">Exhibit ${esc(letter)} — ${esc(title)}</h2>
     <div class="section-rule"></div>
     ${subtitle ? `<p class="micro" style="margin-bottom:10px;">${esc(subtitle)}</p>` : ''}`;
  const contHead = (letter: string, title: string) =>
    `<div class="eyebrow">${num(letter)} — Exhibit ${esc(letter)} (cont'd)</div>
     <h2 class="section-title">${esc(title)} (cont'd)</h2><div class="section-rule"></div>`;

  // ── Exhibit A — Homeowner Information (state pack) ────────────────────
  const hr = data.statePack.homeownerRights;
  if (hr) {
    const pages = chunk(hr.sections, 2).map((sectionPair, ci, all): Sheet => {
      const isFirst = ci === 0;
      const isLast = ci === all.length - 1;
      const head = isFirst
        ? exHead('A', hr.title) +
          `<p style="font-style:italic; font-size:13px; margin-top:-4px;">${esc(hr.subtitle)}</p>
           <p style="font-size:12px; color:var(--slate);">${esc(fillTokens(hr.preparedByNote, data.company))}</p>`
        : contHead('A', 'Homeowner Information');
      const body = sectionPair
        .map(
          (section) =>
            `<p class="micro" style="margin-top:10px; font-size:13px;">${esc(section.heading)}</p>` +
            section.paragraphs
              .map((p) => `<p style="font-size:12px;">${esc(fillTokens(p, data.company))}</p>`)
              .join(''),
        )
        .join('');
      const tail = isLast
        ? `<div class="note-box info" style="margin-top:10px; font-size:13px;">${hr.complaintBlock.map((l) => esc(l)).join('<br>')}</div>
           <p style="margin-top:10px; font-style:italic; font-size:12px; color:var(--slate);">${esc(fillTokens(hr.closingDisclaimer, data.company))}</p>`
        : '';
      return { runheadTitle: 'Exhibit A', bodyHtml: head + body + tail };
    });
    if (pages.length) addExhibit('A', 'Homeowner Information', pages);
  }

  // ── Exhibit B — Statement of Qualifications ───────────────────────────
  addExhibit('B', 'Statement of Qualifications', [
    {
      runheadTitle: 'Exhibit B',
      bodyHtml:
        exHead('B', 'Statement of Qualifications', 'Licensure & professional basis for the findings.') +
        `<p>${esc(data.company.qualificationsText)}</p>
         <p class="micro" style="margin-top:12px;">Licensure</p>
         <table class="score-table"><thead><tr><th>State</th><th>License #</th><th>Classification</th></tr></thead><tbody>
         ${data.company.licenses.map((l) => `<tr><td>${esc(l.state)}</td><td>${esc(l.number)}</td><td>${esc(l.classification)}</td></tr>`).join('')}
         </tbody></table>`,
    },
  ]);

  // ── Exhibit C — Inspection Methodology ────────────────────────────────
  const m = data.methodology;
  addExhibit('C', 'Inspection Methodology', [
    {
      runheadTitle: 'Exhibit C',
      bodyHtml:
        exHead('C', 'Inspection Methodology', 'Conditions, protocol, and the auto-logged capture record.') +
        `<div class="kv-grid">
           <div class="kv-row"><span class="k">Inspected</span><span class="v">${esc(m.inspectedAt)}</span></div>
           <div class="kv-row"><span class="k">Inspector</span><span class="v sans">${esc(data.inspectorName)}</span></div>
           <div class="kv-row"><span class="k">Conditions</span><span class="v sans">${esc(m.conditions)}</span></div>
           ${m.equipment.length ? `<div class="kv-row"><span class="k">Equipment</span><span class="v sans">${esc(m.equipment.join(', '))}</span></div>` : ''}
         </div>
         <p style="margin-top:12px;">Damage is documented wide/mid/close with a scale reference in the close photo. Full-resolution originals are preserved unaltered with capture time (UTC), GPS, and a SHA-256 recorded at capture for chain of custody.</p>
         <p class="micro" style="margin-top:12px;">Auto-Logged Capture Record</p>
         <div class="stat-grid">
           <div class="stat"><div class="n">${m.capture.elevations}</div><div class="l">Elevations</div></div>
           <div class="stat"><div class="n">${m.capture.slopes}</div><div class="l">Slopes</div></div>
           <div class="stat"><div class="n">${m.capture.testSquares}</div><div class="l">Test squares</div></div>
           <div class="stat"><div class="n">${m.capture.totalHits}</div><div class="l">Impacts recorded</div></div>
           <div class="stat"><div class="n">${m.capture.damageInstances}</div><div class="l">Damage instances</div></div>
           <div class="stat"><div class="n">${m.capture.photos}</div><div class="l">Evidence photos</div></div>
         </div>`,
    },
  ]);

  // ── Exhibit D — Storm Event Verification ──────────────────────────────
  if (data.storm) {
    const s = data.storm;
    addExhibit('D', 'Storm Event Verification', [
      {
        runheadTitle: 'Exhibit D',
        bodyHtml:
          exHead('D', 'Storm Event Verification', 'Certified weather for the date of loss establishing the causal event.') +
          `<div class="kv-grid">
             <div class="kv-row"><span class="k">Confirmed event</span><span class="v sans">${esc(s.type)}</span></div>
             <div class="kv-row"><span class="k">Date &amp; local time</span><span class="v">${esc(s.dateLocalTime)}</span></div>
             ${s.hailSize ? `<div class="kv-row"><span class="k">Max hail size</span><span class="v">${esc(s.hailSize)}</span></div>` : ''}
             ${s.windSpeed ? `<div class="kv-row"><span class="k">Max wind speed</span><span class="v">${esc(s.windSpeed)}</span></div>` : ''}
             ${s.distance ? `<div class="kv-row"><span class="k">Distance from property</span><span class="v">${esc(s.distance)}</span></div>` : ''}
             ${s.coordinates ? `<div class="kv-row"><span class="k">Report location</span><span class="v">${esc(s.coordinates)}</span></div>` : ''}
             <div class="kv-row"><span class="k">Verification source</span><span class="v sans">${esc(s.source)}</span></div>
           </div>
           ${s.narrative ? `<p class="micro" style="margin-top:14px;">Event Summary</p><p>${esc(s.narrative)}</p>` : ''}
           ${s.note ? `<p class="micro" style="margin-top:14px;">Reporting Note (verbatim)</p><p><i>${esc(s.note)}</i></p>` : ''}`,
      },
    ]);
  }

  // ── Exhibit E — Damage Documentation & Photo Index ────────────────────
  if (data.photos.length > 0 || impacted.length > 0) {
    const pages: Sheet[] = [];
    const areaTables = impacted
      .map((area) => {
        const rows = data.components[area.key] ?? [];
        if (!rows.length) return '';
        return `<p class="micro" style="margin-top:12px;">${esc(area.name)}</p>
          <table class="score-table"><thead><tr><th>Component</th><th>Condition Observed</th><th>Repair Method</th><th>Verdict</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td style="font-weight:600;">${esc(r.component)}</td><td>${esc(r.condition)}</td><td>${esc(r.method)}</td><td><span class="verdict ${esc(r.verdict)}">${esc(r.verdict)}</span></td></tr>`).join('')}
          </tbody></table>`;
      })
      .join('');
    pages.push({
      runheadTitle: 'Exhibit E',
      bodyHtml:
        exHead('E', 'Damage Documentation & Photo Index', 'Documented damage by area, with a photo-to-subject index and content hashes.') +
        (areaTables ||
          '<p>Damage documentation for the impacted areas is presented in the photographic evidence that follows.</p>'),
    });

    // Photo index (chain of custody) — paginated.
    chunk(data.photos, 18).forEach((photoChunk, ci) => {
      const idxRows = photoChunk
        .map(
          (p) =>
            `<tr><td>${esc(p.id.slice(0, 8).toUpperCase())}</td><td>${esc(p.stage ?? '—')}</td><td>${esc(p.subject)}</td><td>${esc(p.caption)}</td><td class="num">${p.sha256 ? `${esc(p.sha256.slice(0, 12))}…` : '—'}</td></tr>`,
        )
        .join('');
      pages.push({
        runheadTitle: 'Exhibit E',
        bodyHtml: `<div class="eyebrow">${num('E')} — Exhibit E (cont'd)</div><h2 class="section-title">Photo Index — Chain of Custody${ci > 0 ? " (cont'd)" : ''}</h2><div class="section-rule"></div>
          ${ci === 0 ? '<p>Each photo is preserved full-resolution and unaltered; the SHA-256 was recorded at capture and verified against the stored bytes at package generation.</p>' : ''}
          <table class="score-table"><thead><tr><th>Photo</th><th>Stage</th><th>Documents</th><th>Caption</th><th class="num">SHA-256</th></tr></thead><tbody>${idxRows}</tbody></table>`,
      });
    });

    // Photo evidence pages, 2 per page, ordered by impacted area first.
    const areaOrder = [...impacted.map((a) => a.key), 'general' as const];
    const orderedPhotos = [
      ...areaOrder.flatMap((k) => data.photos.filter((p) => p.area === k)),
      ...data.photos.filter((p) => !areaOrder.includes(p.area)),
    ];
    const photoChunks = chunk(orderedPhotos, 2);
    photoChunks.forEach((pair, ci) => {
      const cells = pair
        .map(
          (p) => `<div class="photo-cell"><div class="photo-frame">
            ${p.url ? `<img src="${esc(p.url)}" alt="${esc(p.caption || 'Evidence photo')}" loading="lazy">` : '<div class="photo-missing">Photo unavailable</div>'}
            <div class="frame-corner tl"></div><div class="frame-corner tr"></div><div class="frame-corner bl"></div><div class="frame-corner br"></div></div>
            <div class="photo-caption"><span class="id">${esc(p.id.slice(0, 8).toUpperCase())}${p.stage ? ` · ${esc(p.stage)}` : ''}</span><span class="desc">${esc(p.caption || p.subject)}</span></div></div>`,
        )
        .join('');
      pages.push({
        runheadTitle: 'Exhibit E',
        bodyHtml: `<div class="eyebrow">${num('E')} — Exhibit E (cont'd)</div><h2 class="section-title">Photographic Evidence</h2><div class="section-rule"></div>
          <span class="exhibit-ribbon">EXHIBIT E${photoChunks.length > 1 ? ` · Page ${ci + 1} of ${photoChunks.length}` : ''}</span>
          <div class="photo-grid">${cells}</div>`,
      });
    });
    addExhibit('E', 'Damage Documentation & Photo Index', pages);
  }

  // ── Exhibit F — Repairability Assessment (AI narrative) ───────────────
  if (data.aiSections.forensicSummary || data.aiSections.repairabilityText) {
    const paras = (text: string) =>
      text
        .split('\n')
        .map((p) => (p.trim() ? `<p>${esc(p)}</p>` : ''))
        .join('');
    addExhibit('F', 'Repairability Assessment', [
      {
        runheadTitle: 'Exhibit F',
        bodyHtml:
          exHead('F', 'Repairability Assessment', 'Forensic summary and matching & uniformity analysis.') +
          (data.aiSections.forensicSummary
            ? `<p class="micro">Forensic Inspection Summary</p>${paras(data.aiSections.forensicSummary)}`
            : '') +
          (data.aiSections.repairabilityText
            ? `<p class="micro" style="margin-top:12px;">Repairability Analysis</p>${paras(data.aiSections.repairabilityText)}`
            : ''),
      },
    ]);
  }

  // ── Exhibit G — Manufacturer Documentation ────────────────────────────
  if (data.product) {
    addExhibit('G', 'Manufacturer Documentation', [
      {
        runheadTitle: 'Exhibit G',
        bodyHtml:
          exHead('G', 'Manufacturer Documentation', 'Product identification & discontinuation.') +
          `<div class="kv-grid">
             <div class="kv-row"><span class="k">Identified product</span><span class="v sans">${esc(data.product.name)}</span></div>
             <div class="kv-row"><span class="k">Identification</span><span class="v sans">${esc(data.product.identification)}</span></div>
             <div class="kv-row"><span class="k">Status</span><span class="v sans">${data.product.discontinued ? 'Discontinued' : 'Current'}</span></div>
           </div>
           ${data.product.discontinuedNote ? `<div class="note-box">${esc(data.product.discontinuedNote)}</div>` : ''}`,
      },
    ]);
  }

  // ── Exhibit H — Measurement Report ────────────────────────────────────
  if (data.measurement) {
    const mm = data.measurement;
    addExhibit('H', 'Measurement Report', [
      {
        runheadTitle: 'Exhibit H',
        bodyHtml:
          exHead('H', 'Measurement Report', 'Verifiable roof quantities from recorded field measurements.') +
          (mm.slopes.length
            ? `<p class="micro">Slope Areas</p>
               <table class="score-table"><thead><tr><th>Slope</th><th class="num">Area (sq ft)</th><th class="num">Squares</th></tr></thead><tbody>
               ${mm.slopes.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.sqft.toFixed(0)}</td><td class="num">${(s.sqft / 100).toFixed(2)}</td></tr>`).join('')}
               </tbody><tfoot><tr><td>Total</td><td class="num">${mm.totalSqft.toFixed(0)}</td><td class="num">${mm.squares.toFixed(2)}</td></tr></tfoot></table>`
            : '') +
          (mm.linear.length
            ? `<p class="micro" style="margin-top:14px;">Linear Measurements</p>
               <table class="score-table"><thead><tr><th>Type</th><th class="num">Length (lf)</th></tr></thead><tbody>
               ${mm.linear.map((l) => `<tr><td>${esc(l.type)}</td><td class="num">${l.lf.toFixed(0)}</td></tr>`).join('')}
               </tbody></table>`
            : '') +
          `<p style="margin-top:10px; font-style:italic;">Squares are measured area only; no waste factor is baked in. Waste, starter, and ridge are documented as separate scope line items where applicable.</p>`,
      },
    ]);
  }

  // ── Exhibit I — Applicable Codes & Regulations ────────────────────────
  if (data.statePack.codeCitations.length > 0) {
    const cites = data.statePack.codeCitations
      .map(
        (c) => `
        <div class="exhibit"><div class="exhibit__tab">§</div><div class="exhibit__body">
          <div class="exhibit__head"><span class="exhibit__title">${esc(c.title)}</span><span class="exhibit__code">${esc(c.cite)}</span></div>
          <p style="margin-bottom:4px;">${esc(c.body)}</p>
          <p class="micro" style="margin:0;">Governs scope element: ${esc(c.element)}</p>
        </div></div>`,
      )
      .join('');
    addExhibit('I', 'Applicable Codes & Regulations', [
      {
        runheadTitle: 'Exhibit I',
        bodyHtml:
          exHead('I', 'Applicable Codes & Regulations', 'Code provisions cross-referenced from the scope element each governs.') + cites,
      },
    ]);
  }

  // ── Exhibit J — Scope of Work & Pricing Basis ─────────────────────────
  if (data.scope && data.scope.lineItems.length > 0) {
    const sc = data.scope;
    addExhibit('J', 'Scope of Work & Pricing Basis', [
      {
        runheadTitle: 'Exhibit J',
        bodyHtml:
          exHead('J', 'Scope of Work & Pricing Basis', 'Fixed incurred cost + documented adders.') +
          `${
            sc.basePricePerSquare != null || sc.squares != null
              ? `<div class="kv-grid">
                 ${sc.basePricePerSquare != null ? `<div class="kv-row"><span class="k">Base rate</span><span class="v">${money(sc.basePricePerSquare)} / SQ</span></div>` : ''}
                 ${sc.squares != null ? `<div class="kv-row"><span class="k">Measured squares</span><span class="v">${sc.squares.toFixed(2)}</span></div>` : ''}
               </div>`
              : ''
          }
           <table class="score-table" style="margin-top:10px;"><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Total</th></tr></thead><tbody>
           ${sc.lineItems.map((li) => `<tr><td>${esc(li.description)}</td><td class="num">${li.qty.toFixed(2)}</td><td>${esc(li.unit)}</td><td class="num">${money(li.rate)}</td><td class="num">${money(li.total)}</td></tr>`).join('')}
           </tbody><tfoot><tr><td colspan="4">Fixed incurred cost (subtotal)</td><td class="num">${money(sc.subtotal)}</td></tr></tfoot></table>
           ${data.company.pricingBasisStatement ? `<div class="note-box uppa" style="margin-top:12px;">${esc(data.company.pricingBasisStatement)}</div>` : ''}`,
      },
    ]);

    // ── Exhibit K — Conditions & Adders ─────────────────────────────────
    const adders = sc.lineItems.filter((li) => li.isAdder);
    if (adders.length > 0) {
      const adderHtml = adders
        .map(
          (a) => `
          <div class="exhibit"><div class="exhibit__tab">+</div><div class="exhibit__body">
            <div class="exhibit__head"><span class="exhibit__title">${esc(a.description)}</span><span class="exhibit__code">${money(a.total)}</span></div>
            <div class="kv-grid" style="margin-top:4px;">
              <div class="kv-row"><span class="k">Triggering condition</span><span class="v sans">${esc(a.trigger || 'Documented during the inspection')}</span></div>
              <div class="kv-row"><span class="k">Quantity</span><span class="v">${a.qty.toFixed(2)} ${esc(a.unit)} @ ${money(a.rate)}</span></div>
              <div class="kv-row"><span class="k">Governing code</span><span class="v sans">${esc((a.codeRefs ?? []).join(', ') || '—')}</span></div>
            </div>
          </div></div>`,
        )
        .join('');
      addExhibit('K', 'Conditions & Adders', [
        {
          runheadTitle: 'Exhibit K',
          bodyHtml:
            exHead('K', 'Conditions & Adders', 'Each conditional item paired with its documented triggering condition.') +
            `<p>The items below are conditional adders. Each is included only because the noted condition was documented during the inspection; none is priced by default.</p>${adderHtml}`,
        },
      ]);
    }

    // ── Exhibit L — Contract Exhibit ────────────────────────────────────
    if (sc.subtotal > 0) {
      addExhibit('L', 'Contract Exhibit', [
        {
          runheadTitle: 'Exhibit L',
          bodyHtml:
            exHead('L', 'Contract Exhibit', 'Executed fixed-price agreement — evidence of actual incurred cost.') +
            `<p>The insured has entered a fixed-price agreement with the contractor to restore the property to its pre-loss, code-compliant condition. The agreed price below is the insured's actual incurred cost — the amount the insured is contractually obligated to pay — and is the basis for the documented loss.</p>
             <div class="kv-grid" style="margin-top:8px;">
               <div class="kv-row"><span class="k">Insured</span><span class="v sans">${esc(data.property.insuredName)}</span></div>
               <div class="kv-row"><span class="k">Contractor</span><span class="v sans">${esc(data.company.legalName)}</span></div>
               <div class="kv-row"><span class="k">Agreement type</span><span class="v sans">Fixed-price (incurred cost)</span></div>
               <div class="kv-row"><span class="k">Agreed price</span><span class="v">${money(sc.subtotal)}</span></div>
             </div>
             <div class="note-box info" style="margin-top:10px;">The executed, signed fixed-price agreement is on file and incorporated by reference. This exhibit evidences the contractor's and insured's own agreed cost — it is not a carrier estimate and does not state what any carrier owes.</div>`,
        },
      ]);
    }
  }

  // ── Exhibit M — Repairability Conclusion ──────────────────────────────
  addExhibit('M', 'Repairability Conclusion', [
    {
      runheadTitle: 'Exhibit M',
      bodyHtml:
        exHead('M', 'Repairability Conclusion', 'Signed, dated professional finding on contractor letterhead.') +
        `<div class="attestation-body">${data.attestationHtml}</div>
         <div class="sig-block">
           <div><div class="sig-slot">${data.signatureUrl ? `<img src="${esc(data.signatureUrl)}" alt="Inspector signature">` : '<span>SIGNATURE ON FILE</span>'}</div>
             <div class="sig-line">Signed — <span class="role">${esc(data.inspectorName)}</span></div></div>
           <div><div class="sig-slot" style="border-style:solid; background:transparent;"></div>
             <div class="sig-line">Date — ${esc(data.property.phase2Date)}</div></div>
         </div>`,
    },
  ]);

  // ── Supplemental sections (carried over from the prior design) ────────
  const supplemental: Array<{ title: string; inner: string }> = [];
  if (data.extras.propertyDetailsHtml) {
    supplemental.push({ title: 'Property Construction Details', inner: data.extras.propertyDetailsHtml });
  }
  if (data.extras.rapSectionHtml) {
    supplemental.push({ title: 'Repair Attempt Protocol', inner: data.extras.rapSectionHtml });
  }
  if (data.extras.vapSectionHtml) {
    supplemental.push({ title: 'Vinyl Siding Repairability Assessment', inner: data.extras.vapSectionHtml });
  }
  if (data.extras.evidenceScopeIndexHtml) {
    supplemental.push({ title: 'Evidence-to-Scope Index', inner: data.extras.evidenceScopeIndexHtml });
  }
  if (data.extras.evidenceManifestHtml) {
    supplemental.push({ title: 'Evidence Manifest', inner: data.extras.evidenceManifestHtml });
  }
  if (data.extras.unlockLogHtml) {
    supplemental.push({ title: 'Record Disclosure', inner: data.extras.unlockLogHtml });
  }
  if (data.portalAccess) {
    supplemental.push({
      title: 'Digital Evidence Portal',
      inner: `<p style="font-size:12px;">Full-resolution inspection photographs and every version of this Proof Package are available online. Visit the portal below and enter the access code — no account required.</p>
        <div class="note-box info" style="margin-top:8px;">
          <b>Portal:</b> <a href="${esc(data.portalAccess.url)}">${esc(data.portalAccess.url)}</a><br>
          <b>Access code:</b> <span style="font-weight:700; letter-spacing:1px;">${esc(data.portalAccess.code)}</span>
        </div>`,
    });
  }
  const supplementalSheets: Sheet[] = supplemental.map((s, i) => ({
    runheadTitle: s.title,
    anchor: `supp-${i}`,
    bodyHtml: `<div class="eyebrow" data-exhibit-anchor="supp-${i}">${String(i + 1).padStart(2, '0')} — Supporting Documentation</div>
      <h2 class="section-title">${esc(s.title)}</h2><div class="section-rule"></div>
      <div class="supplemental-body">${s.inner}</div>`,
  }));

  // ── Certification (final page) ────────────────────────────────────────
  const certificationSheet: Sheet = {
    runheadTitle: 'Certification',
    bodyHtml: `<div class="eyebrow">99 — Certification</div>
      <h2 class="section-title">Inspector Certification</h2><div class="section-rule"></div>
      <p>I certify that the observations, measurements, and photographic evidence in this report were made by me or under my direct supervision and accurately represent the condition of the property on the date of inspection.</p>
      <p style="margin-top:10px;">This report is a contractor scope submission documenting physical findings and the contractor's own fixed incurred cost. It does not negotiate, adjust, or advise on the settlement of the claim, and it does not represent a coverage determination or state what any carrier owes.</p>
      <div class="sig-block">
        <div><div class="sig-slot">${data.signatureUrl ? `<img src="${esc(data.signatureUrl)}" alt="Inspector signature">` : '<span>SIGNATURE ON FILE</span>'}</div>
          <div class="sig-line">Prepared by — <span class="role">${esc(data.inspectorName)}</span></div></div>
        <div><div class="sig-slot" style="border-style:solid; background:transparent;"></div>
          <div class="sig-line">Date — ${esc(data.property.phase2Date)}</div></div>
      </div>`,
  };

  // ── Summary & Contents page ───────────────────────────────────────────
  const tocRows =
    toc
      .map(
        (t) =>
          `<div class="toc-row" data-toc-for="${esc(t.letter)}"><span class="n">Exhibit ${esc(t.letter)}</span><span class="t">${esc(t.title)}</span><span class="p">p.—</span></div>`,
      )
      .join('') +
    supplemental
      .map(
        (s, i) =>
          `<div class="toc-row" data-toc-for="supp-${i}"><span class="n">Supp. ${i + 1}</span><span class="t">${esc(s.title)}</span><span class="p">p.—</span></div>`,
      )
      .join('');

  const summarySheet: Sheet = {
    runheadTitle: 'Summary & Contents',
    bodyHtml: `<div class="eyebrow">00 — Summary &amp; Contents</div>
      <h2 class="section-title">Proof Package Summary</h2><div class="section-rule"></div>
      <p>${esc(data.company.legalName)} documents the physical roof damage observed at the property below, the weather event believed to have caused it, the building-code requirements for a compliant repair, and the contractor's fixed incurred cost to restore the property to its pre-loss condition.</p>
      <div class="kv-grid" style="margin-top:6px;">
        <div class="kv-row"><span class="k">Insured</span><span class="v sans">${esc(data.property.insuredName)}</span></div>
        <div class="kv-row"><span class="k">Property</span><span class="v sans">${esc(data.property.address)}</span></div>
        <div class="kv-row"><span class="k">Carrier</span><span class="v sans">${esc(data.property.carrier)}</span></div>
        <div class="kv-row"><span class="k">Policy Number</span><span class="v">${esc(data.property.policyNumber)}</span></div>
        <div class="kv-row"><span class="k">Claim Number</span><span class="v">${esc(data.property.claimNumber)}</span></div>
        <div class="kv-row"><span class="k">Date of Loss</span><span class="v">${esc(data.property.dateOfLoss)}</span></div>
        <div class="kv-row"><span class="k">Phase 1 (Preliminary)</span><span class="v">${esc(data.property.phase1Date)}</span></div>
        <div class="kv-row"><span class="k">Phase 2 (Forensic)</span><span class="v">${esc(data.property.phase2Date)}</span></div>
        <div class="kv-row"><span class="k">Jurisdiction</span><span class="v sans">${esc(data.statePack.jurisdictionLabel)}</span></div>
        ${data.scope ? `<div class="kv-row"><span class="k">Fixed Incurred Cost</span><span class="v">${money(data.scope.subtotal)}</span></div>` : ''}
      </div>
      <p class="micro" style="margin-top:16px;">Contents</p>
      ${tocRows}
      ${
        data.statePack.uppaDisclaimer
          ? `<div class="note-box uppa" style="margin-top:16px;">
              <b>${esc(data.company.brand)}</b> is a licensed contractor, not a public adjuster.
              ${esc(data.statePack.uppaDisclaimer)}
              ${data.statePack.uppaStatute ? `<br><span class="micro" style="display:inline-block; margin-top:6px;">Governing statute: ${esc(data.statePack.uppaStatute)}</span>` : ''}
            </div>`
          : ''
      }`,
  };

  // ── Cover page (rendered separately — dark navy layout) ───────────────
  const coverHtml = `
<div class="sheet cover">
  <div class="cover__top"><div id="logo-slot-cover">${logoHtml}</div></div>
  <div class="cover__photo">
    ${data.coverPhotoUrl ? `<img class="cover__photo-img" src="${esc(data.coverPhotoUrl)}" alt="Property overview">` : '<div class="cover__photo-placeholder">Front-of-home photograph</div>'}
    <div class="frame-corner tl"></div><div class="frame-corner tr"></div><div class="frame-corner bl"></div><div class="frame-corner br"></div>
    <div class="cover__photo-tag">PROPERTY OVERVIEW</div>
  </div>
  <div class="cover__title-block">
    <div class="cover__doctype">Phase 2 of 2 — Forensic Inspection · Proof Package</div>
    <h1 class="cover__title">Forensic Inspection Report<br>and Proof Package</h1>
    <div class="cover__address">${esc(data.property.address)}</div>
  </div>
  <div class="cover__meta">
    <div><div class="label">Insured</div><div class="value">${esc(data.property.insuredName)}</div></div>
    <div><div class="label">Carrier</div><div class="value">${esc(data.property.carrier)}</div></div>
    <div><div class="label">Claim Number</div><div class="value mono">${esc(data.property.claimNumber)}</div></div>
    <div><div class="label">Date of Loss</div><div class="value mono">${esc(data.property.dateOfLoss)}</div></div>
  </div>
  <div class="cover__foot">
    <div class="prepared">Prepared by <b>${esc(data.company.legalName)}</b><br><span>${esc(data.inspectorName)}</span>, Field Inspector</div>
    <div class="cover__stamp">PROOF PACKAGE<br><b>${esc(data.reportId)}</b></div>
  </div>
</div>`;

  const allSheets = [summarySheet, ...sheets, ...supplementalSheets, certificationSheet];
  const sheetsHtml = allSheets
    .map(
      (s) => `
<div class="sheet">
  <div class="runhead"><div class="logo-slot">${logoHtml}</div><div class="rh-title">${esc(s.runheadTitle)}</div></div>
  <div class="sheet__body">${s.bodyHtml}</div>
  <div class="runfoot"><span>Forensic Inspection Report &amp; Proof Package · <b>${esc(data.property.addressShort)}</b></span><span>Page <span class="page-num"></span> of <span class="page-total"></span></span></div>
</div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forensic Inspection Report &amp; Proof Package</title>
<style>
  :root{
    --ink:#191E24; --ink-soft:#3A424C; --slate:#667080; --slate-soft:#99A1AC;
    --line:#D9DEE3; --line-soft:#E9ECEF; --paper:#FFFFFF; --paper-alt:#F5F4F1;
    --accent:${theme.accentColor}; --accent-soft:#F1E1D9; --good:#2F6E4E; --good-soft:#E4EEE8;
    --warn:#B4790A; --warn-soft:#F5EBD8; --navy:${theme.headerColor}; --cover-text:${theme.headerTextColor};
    --serif: Arial, Helvetica, "Liberation Sans", "Arimo", sans-serif;
    --sans:  Arial, Helvetica, "Liberation Sans", "Arimo", sans-serif;
    --mono:  Arial, Helvetica, "Liberation Sans", "Arimo", sans-serif;
    --page-w:8.5in; --page-h:11in; --margin:0.55in;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; background:#7B8290; font-family:var(--sans); color:var(--ink); }
  .sheet{
    width:var(--page-w); min-height:var(--page-h); margin:0.35in auto; background:var(--paper);
    box-shadow:0 0 0 1px rgba(0,0,0,.04), 0 12px 30px rgba(0,0,0,.28);
    display:flex; flex-direction:column; position:relative;
  }
  .sheet__body{ flex:1 1 auto; padding:0.42in var(--margin) 0.3in var(--margin); display:flex; flex-direction:column; }
  .runhead{ display:flex; align-items:center; padding:0.28in var(--margin) 0.16in var(--margin); border-bottom:1.5px solid var(--ink); }
  .logo-slot{ width:34px; height:34px; border-radius:4px; background:var(--paper-alt); border:1px solid var(--line);
    display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:11px; color:var(--slate-soft); overflow:hidden; flex:none; }
  .logo-slot img{ width:100%; height:100%; object-fit:contain; }
  .runhead .rh-title{ margin-left:12px; font-size:11px; color:var(--slate); font-weight:600; }
  .runfoot{ display:flex; align-items:center; justify-content:space-between; padding:0.14in var(--margin) 0.22in var(--margin);
    border-top:1px solid var(--line); font-family:var(--mono); font-size:11px; color:var(--slate-soft); letter-spacing:.03em; }
  .runfoot span b{ color:var(--ink-soft); font-weight:600; }
  h1,h2,h3{ font-family:var(--serif); font-weight:600; color:var(--ink); margin:0; }
  .eyebrow{ font-family:var(--mono); font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); font-weight:600; margin:0 0 6px 0; }
  .section-title{ font-size:15px; margin-bottom:2px; }
  .section-rule{ height:1px; background:var(--line); margin:8px 0 14px 0; }
  p{ margin:0 0 8px 0; font-size:11px; line-height:1.55; color:var(--ink-soft); text-align:justify; }
  .micro{ font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--slate); font-weight:600; }
  .cover{ padding:0; background:var(--navy); color:var(--cover-text); }
  .cover__top{ padding:0.5in var(--margin) 0.3in var(--margin); display:flex; align-items:center; }
  #logo-slot-cover{ width:44px; height:44px; border-radius:5px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.18);
    display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:11px; color:rgba(255,255,255,.5); overflow:hidden; }
  #logo-slot-cover img{ width:100%; height:100%; object-fit:contain; }
  .cover__photo{ margin:0 var(--margin); position:relative; height:3.15in; overflow:hidden;
    background:linear-gradient(180deg, rgba(10,13,17,0) 55%, rgba(10,13,17,.65) 100%), repeating-linear-gradient(135deg, #2C3644 0 18px, #263140 18px 36px);
    border:1px solid rgba(255,255,255,.15); }
  .cover__photo-img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .frame-corner{ position:absolute; width:20px; height:20px; }
  .frame-corner.tl{ top:10px; left:10px; border-top:2px solid #fff; border-left:2px solid #fff; }
  .frame-corner.tr{ top:10px; right:10px; border-top:2px solid #fff; border-right:2px solid #fff; }
  .frame-corner.bl{ bottom:10px; left:10px; border-bottom:2px solid #fff; border-left:2px solid #fff; }
  .frame-corner.br{ bottom:10px; right:10px; border-bottom:2px solid #fff; border-right:2px solid #fff; }
  .cover__photo-tag{ position:absolute; bottom:12px; left:14px; color:#fff; font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-shadow:0 1px 3px rgba(0,0,0,.5); }
  .cover__photo-placeholder{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:11px; color:rgba(255,255,255,.35); letter-spacing:.08em; text-transform:uppercase; }
  .cover__title-block{ padding:0.34in var(--margin) 0 var(--margin); }
  .cover__doctype{ font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); font-weight:600; margin-bottom:8px; filter:brightness(1.5); }
  .cover__title{ font-size:26px; line-height:1.18; margin-bottom:6px; color:var(--cover-text); }
  .cover__address{ font-size:13.5px; color:var(--cover-text); opacity:.75; font-weight:500; }
  .cover__meta{ margin:0.32in var(--margin) 0 var(--margin); border-top:1.5px solid rgba(255,255,255,.3); display:grid; grid-template-columns:repeat(2,1fr); gap:0; }
  .cover__meta div{ padding:12px 16px 12px 0; border-right:1px solid rgba(255,255,255,.15); }
  .cover__meta div:nth-child(2n){ border-right:none; }
  .cover__meta .label{ font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--cover-text); opacity:.45; margin-bottom:4px; }
  .cover__meta .value{ font-size:12px; font-weight:600; color:var(--cover-text); }
  .cover__foot{ margin-top:auto; padding:0.3in var(--margin) 0.45in var(--margin); display:flex; justify-content:space-between; align-items:flex-end; border-top:1px solid rgba(255,255,255,.15); }
  .cover__foot .prepared{ font-size:11px; color:var(--cover-text); opacity:.7; line-height:1.6; }
  .cover__foot .prepared b{ opacity:1; }
  .cover__stamp{ font-family:var(--mono); font-size:11px; color:var(--cover-text); opacity:.75; border:1px solid rgba(255,255,255,.25); border-radius:3px; padding:6px 10px; text-align:center; }
  .kv-grid{ display:grid; grid-template-columns:1fr 1fr; gap:0 24px; margin-bottom:6px; }
  .kv-row{ display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--line-soft); font-size:11px; gap:10px; }
  .kv-row .k{ color:var(--slate); flex:none; }
  .kv-row .v{ font-weight:600; color:var(--ink); font-family:var(--mono); font-size:11px; text-align:right; }
  .kv-row .v.sans{ font-family:var(--sans); }
  .score-table{ width:100%; border-collapse:collapse; margin-top:8px; font-size:11px; }
  .score-table th{ text-align:left; font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase;
    color:var(--slate); font-weight:600; border-bottom:1.5px solid var(--ink); padding:6px 8px; }
  .score-table td{ border-bottom:1px solid var(--line-soft); padding:8px; vertical-align:top; }
  .score-table tr:last-child td{ border-bottom:none; }
  .score-table td.num, .score-table th.num{ font-family:var(--mono); text-align:right; white-space:nowrap; }
  .score-table tfoot td{ border-top:1.5px solid var(--ink); border-bottom:none; font-weight:700; padding-top:9px; }
  .verdict{ display:inline-block; font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:.04em; padding:2px 8px; border-radius:20px; text-transform:uppercase; }
  .verdict.replace{ background:var(--accent-soft); color:var(--accent); }
  .verdict.repair{ background:var(--good-soft); color:var(--good); }
  .verdict.monitor{ background:var(--warn-soft); color:var(--warn); }
  .exhibit{ border:1px solid var(--line); border-radius:6px; margin:14px 0; overflow:hidden; display:flex; break-inside:avoid; }
  .exhibit__tab{ flex:none; width:46px; background:var(--ink); color:#fff; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:600; }
  .exhibit__body{ padding:12px 14px; flex:1; }
  .exhibit__head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; gap:10px; }
  .exhibit__title{ font-size:11px; font-weight:600; color:var(--ink); }
  .exhibit__code{ font-family:var(--mono); font-size:11px; color:var(--accent); font-weight:600; white-space:nowrap; }
  .exhibit__body p{ font-size:11px; margin:0; }
  .photo-grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:6px; }
  .photo-cell{ position:relative; }
  .photo-frame{ position:relative; height:2.6in; border:1px solid var(--line-soft); overflow:hidden;
    background:repeating-linear-gradient(135deg, #EDEAE4 0 14px, #E4E0D8 14px 28px); }
  .photo-frame img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .photo-missing{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#999; font-size:12px; }
  .photo-frame .frame-corner{ width:14px; height:14px; border-color:#fff; }
  .photo-frame .frame-corner.tl,.photo-frame .frame-corner.tr{ top:6px; }
  .photo-frame .frame-corner.bl,.photo-frame .frame-corner.br{ bottom:6px; }
  .photo-frame .frame-corner.tl,.photo-frame .frame-corner.bl{ left:6px; }
  .photo-frame .frame-corner.tr,.photo-frame .frame-corner.br{ right:6px; }
  .photo-caption{ font-size:11px; margin-top:5px; display:flex; justify-content:space-between; gap:8px; }
  .photo-caption .id{ font-family:var(--mono); color:var(--slate-soft); }
  .photo-caption .desc{ color:var(--ink-soft); font-weight:500; text-align:right; }
  .exhibit-ribbon{ display:inline-block; font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:.05em; background:var(--ink); color:#fff; padding:2px 7px; border-radius:3px; margin-bottom:8px; }
  .note-box{ border-left:3px solid var(--accent); background:var(--accent-soft); padding:10px 14px; margin-top:10px; font-size:11px; color:var(--ink-soft); line-height:1.55; text-align:justify; }
  .note-box b{ color:var(--ink); }
  .note-box.info{ border-left-color:var(--slate); background:var(--paper-alt); }
  .note-box.uppa{ border-left-color:var(--navy); background:#EEF1F4; }
  .stat-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:8px 0 4px 0; }
  .stat{ border:1px solid var(--line); border-radius:5px; padding:10px 12px; }
  .stat .n{ font-size:19px; font-weight:700; color:var(--ink); }
  .stat .l{ font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--slate); margin-top:2px; }
  .toc-row{ display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dotted var(--line); font-size:11px; gap:10px; }
  .toc-row .n{ font-family:var(--mono); color:var(--accent); font-weight:600; width:74px; flex:none; }
  .toc-row .t{ flex:1; color:var(--ink-soft); }
  .toc-row .p{ font-family:var(--mono); color:var(--slate-soft); }
  .sig-block{ display:grid; grid-template-columns:1.4fr 1fr; gap:26px; margin-top:20px; align-items:end; }
  .sig-slot{ height:64px; border:1px dashed var(--line); border-radius:5px; background:var(--paper-alt); display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:11px; color:var(--slate-soft); }
  .sig-slot img{ max-height:100%; max-width:100%; object-fit:contain; }
  .sig-line{ border-top:1px solid var(--ink-soft); margin-top:8px; padding-top:5px; font-size:11px; color:var(--slate); }
  .sig-line .role{ font-weight:600; color:var(--ink); }
  .attestation-body p{ font-size:11px; }
  /* Supplemental inner sections reuse the prior design's table/photo classes. */
  .supplemental-body{ font-size:11px; }
  .supplemental-body .detail-table{ width:100%; border-collapse:collapse; font-size:11px; margin-top:8px; }
  .supplemental-body .detail-table th{ text-align:left; font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase;
    color:var(--slate); font-weight:600; border-bottom:1.5px solid var(--ink); padding:6px 8px; }
  .supplemental-body .detail-table td{ border-bottom:1px solid var(--line-soft); padding:8px; vertical-align:top; }
  .supplemental-body .photo-grid{ grid-template-columns:1fr 1fr; }
  .supplemental-body .photo-card{ border:1px solid var(--line-soft); border-radius:6px; overflow:hidden; }
  .supplemental-body .photo-card img{ width:100%; height:2.2in; object-fit:cover; display:block; background:#f0f0f0; }
  .supplemental-body .photo-card .photo-caption{ padding:8px 10px; display:block; }
  @media print{
    html,body{ background:none; }
    .sheet{ margin:0; box-shadow:none; page-break-after:always; }
    .sheet:last-child{ page-break-after:auto; }
    @page{ size:8.5in 11in; margin:0; }
  }
</style>
</head>
<body>
${coverHtml}
${sheetsHtml}
<script>
(function(){
  var sheets = document.querySelectorAll('.sheet');
  sheets.forEach ? null : null;
  for (var i = 0; i < sheets.length; i++) {
    var nums = sheets[i].querySelectorAll('.page-num');
    for (var j = 0; j < nums.length; j++) nums[j].textContent = String(i + 1);
    var totals = sheets[i].querySelectorAll('.page-total');
    for (var j2 = 0; j2 < totals.length; j2++) totals[j2].textContent = String(sheets.length);
  }
  var sheetList = Array.prototype.slice.call(sheets);
  var tocRows = document.querySelectorAll('[data-toc-for]');
  for (var k = 0; k < tocRows.length; k++) {
    var key = tocRows[k].getAttribute('data-toc-for');
    var anchor = document.querySelector('[data-exhibit-anchor="' + key + '"]');
    if (!anchor) continue;
    var sheet = anchor.closest ? anchor.closest('.sheet') : null;
    var page = sheet ? sheetList.indexOf(sheet) + 1 : -1;
    if (page > 0) tocRows[k].querySelector('.p').textContent = 'p.' + page;
  }
})();
</script>
</body>
</html>`;
}

/**
 * Render a sample Proof Package with placeholder data, styled with the given
 * theme and (optionally) a freshly-signed company logo URL. Used by the
 * branding-preview endpoint so a super admin can see their palette + logo on
 * the real A–M template without compiling a real inspection.
 *
 * Reuses buildProofPackageHtml so the preview can never drift from the real
 * package's markup or styling.
 */
export function buildSampleProofPackageHtml(params: {
  theme?: ReportTheme;
  logoUrl?: string | null;
  companyName?: string | null;
}): string {
  const company = params.companyName?.trim() || 'Your Company';
  const data: ProofPackageData = {
    reportId: 'SAMPLE01',
    generatedAt: new Date().toISOString(),
    company: {
      legalName: company,
      brand: company,
      licenses: [{ state: 'IL', number: '000000-SAMPLE', classification: 'Licensed Contractor' }],
      qualificationsText:
        'This is a sample Statement of Qualifications. On real Proof Packages this section shows the qualifications text entered under Proof Package Settings.',
      pricingBasisStatement:
        'Sample pricing basis statement. Real packages show the statement entered under Proof Package Settings.',
    },
    statePack: {
      jurisdictionLabel: 'State of IL',
      homeownerRights: {
        title: 'Homeowner Information & Rights',
        subtitle: 'Sample state legal pack',
        preparedByNote: 'Prepared by {{contractor}} ({{license}}).',
        sections: [
          {
            heading: 'About this page',
            paragraphs: [
              'This is sample homeowner-rights content. On real Proof Packages this page shows the state legal pack entered under Proof Package Settings for the property\u2019s state.',
            ],
          },
        ],
        complaintBlock: ['Sample State Department of Insurance', '1-800-000-0000'],
        closingDisclaimer: '{{contractor}} is a roofing contractor, not a public adjuster.',
      },
      uppaDisclaimer:
        'Sample disclaimer: this report documents physical damage only and does not adjust or negotiate any insurance claim.',
      uppaStatute: 'Sample Statute § 0.0-000',
      codeCitations: [
        {
          key: 'sample_drip_edge',
          element: 'Drip edge',
          title: 'Drip edge required at eaves and rakes',
          cite: 'IRC R905.2.8.5 (sample)',
          body: 'Sample code citation body. Real packages show the code citations entered in the state legal pack.',
        },
      ],
    },
    property: {
      address: '1234 Maple Street, Springfield, IL 62704',
      addressShort: '1234 Maple Street',
      insuredName: 'Jordan Example',
      carrier: 'Acme Mutual Insurance',
      policyNumber: 'HO-88213467',
      claimNumber: 'CLM-2026-004821',
      dateOfLoss: 'June 14, 2026',
      phase1Date: 'June 18, 2026',
      phase2Date: 'July 10, 2026',
    },
    inspectorName: 'Sam Inspector',
    coverPhotoUrl: null,
    storm: {
      type: 'Hail',
      dateLocalTime: 'June 14, 2026',
      hailSize: '1.50" diameter (sample)',
      windSpeed: '55 mph (sample)',
      distance: '0.6 mi from property',
      coordinates: 'Springfield, IL',
      source: 'Certified weather data (sample)',
      narrative: null,
      note: 'Sample storm verification data.',
    },
    methodology: {
      inspectedAt: 'July 10, 2026',
      conditions: 'Sky: clear \u00b7 Wind: calm (sample)',
      equipment: [],
      capture: { elevations: 4, slopes: 6, testSquares: 4, totalHits: 48, damageInstances: 12, photos: 36 },
    },
    areasImpacted: [
      { key: 'roof', name: 'Roof System', impacted: true },
      { key: 'siding', name: 'Siding / Exterior', impacted: false },
      { key: 'collateral', name: 'Collateral', impacted: true },
      { key: 'interior', name: 'Interior / Attic', impacted: false },
    ],
    components: {
      roof: [
        {
          component: 'Front Slope (sample)',
          condition: 'Hail impact damage \u2014 sample condition summary',
          method: 'Full replacement',
          verdict: 'replace',
        },
      ],
    },
    aiSections: {
      forensicSummary:
        'This is a sample Proof Package generated to preview your company branding. The colors and logo shown here are exactly how they will appear on compiled Proof Packages for ' +
        company +
        '.\nActual packages include the full AI-generated forensic inspection summary in this section.',
      repairabilityText:
        'Sample repairability summary. Actual packages include the AI-generated repairability narrative here.',
    },
    measurement: {
      slopes: [
        { label: 'Front Slope', sqft: 620 },
        { label: 'Rear Slope', sqft: 640 },
      ],
      linear: [{ type: 'ridge', lf: 40 }],
      totalSqft: 1260,
      squares: 12.6,
    },
    scope: {
      lineItems: [
        {
          description: 'Remove & replace laminated shingles (sample)',
          qty: 14,
          unit: 'SQ',
          rate: 425,
          total: 5950,
          isAdder: false,
        },
        {
          description: 'Ice & water shield at eaves (sample)',
          qty: 120,
          unit: 'LF',
          rate: 3.5,
          total: 420,
          isAdder: true,
          trigger: 'Code-required at eaves (sample)',
          codeRefs: ['IRC R905.2.8.5'],
        },
      ],
      subtotal: 6370,
      basePricePerSquare: 425,
      squares: 14,
    },
    product: {
      name: 'Sample Shingle Product',
      identification: 'Sample product identification details',
      discontinued: false,
      discontinuedNote: null,
    },
    photos: [
      {
        id: 'sample-photo-1',
        url: null,
        stage: 'roof',
        subject: 'Front Slope',
        caption: 'Sample photo \u2014 evidence photos from the inspection appear here on real packages.',
        sha256: null,
        area: 'roof',
      },
      {
        id: 'sample-photo-2',
        url: null,
        stage: 'collateral',
        subject: 'Downspout',
        caption: 'Sample collateral photo.',
        sha256: null,
        area: 'collateral',
      },
    ],
    attestationHtml:
      '<p>Sample inspector attestation text. On real packages this section contains the signed inspector attestation.</p>',
    extras: {
      propertyDetailsHtml:
        '<table class="detail-table"><tr><th>Attribute</th><th>Value</th></tr>' +
        '<tr><td>Roof type</td><td>Asphalt shingle (sample)</td></tr>' +
        '<tr><td>Stories</td><td>2</td></tr></table>',
    },
    portalAccess: null,
    theme: params.theme,
    logoUrl: params.logoUrl,
    signatureUrl: null,
  };
  return buildProofPackageHtml(data);
}
