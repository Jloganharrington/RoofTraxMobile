import { escHtml as esc, type ReportTheme, resolveReportTheme } from './reportTemplate';

export type SupplementSection = {
  sectionType: string;
  contentHtml: string;
};

export type SupplementDocumentData = {
  /** e.g. "SUPP-1" */
  supplementNumber: string;
  supplementReason: string;
  /** ISO string — when this supplement was compiled */
  compiledAt: string;
  /** ISO string — when the original package was compiled */
  originalPackageCompiledAt: string | null;
  /** Claim identity from the inspection */
  property: {
    address: string;
    claimNumber: string;
    policyNumber: string;
    insuredName: string;
    carrier: string;
    dateOfLoss: string;
  };
  company: {
    legalName: string;
    brand: string;
  };
  inspectorName: string;
  /** Locked supplement sections (ordered for inclusion). */
  sections: SupplementSection[];
  /** Attestation block HTML (sanitized). */
  attestationHtml: string;
  /** Inspector signature URL (signed, render-time only). */
  signatureUrl: string | null;
  theme?: ReportTheme;
  logoUrl?: string | null;
};

const SUPPLEMENT_REASON_LABELS: Record<string, string> = {
  concealed_conditions_exposed: 'Concealed Conditions Exposed',
  carrier_response:             'Carrier Response',
  scope_correction:             'Scope Correction',
};

const SECTION_LABELS: Record<string, string> = {
  findings:               'Supplement Findings',
  estimate_justifications: 'Revised Scope & Estimate Justification',
  closing_statement:      'Closing Statement',
};

/**
 * Builds a self-contained HTML document for a supplement package.
 * Consumes the same CSS as the primary proof package template (via shared
 * variables and classes). The supplement is clearly identified as a separate,
 * dated addendum to the original proof package.
 */
export function buildSupplementHtml(data: SupplementDocumentData): string {
  const theme = resolveReportTheme(data.theme);
  // Map theme fields to CSS variable values used in the supplement template.
  const primaryColor = theme.headerColor;
  const accentColor = theme.accentColor;
  const logoHtml = data.logoUrl
    ? `<img src="${esc(data.logoUrl)}" alt="${esc(data.company.brand)} logo">`
    : '<span>LOGO</span>';

  const reasonLabel = SUPPLEMENT_REASON_LABELS[data.supplementReason] ?? data.supplementReason;
  const originalDate = data.originalPackageCompiledAt
    ? new Date(data.originalPackageCompiledAt).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      })
    : null;
  const compiledDate = new Date(data.compiledAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  // Build section HTML blocks
  const sectionBlocks = data.sections
    .map((s, i) => {
      const n = String(i + 1).padStart(2, '0');
      const label = SECTION_LABELS[s.sectionType] ?? s.sectionType;
      return `
      <div class="sheet">
        <div class="sheet__runhead"><div id="logo-slot-sheet">${logoHtml}</div>
          <div class="rh-info">
            <span>${esc(data.property.address)}</span>
            <span class="sep">·</span>
            <span>${esc(data.supplementNumber)}</span>
          </div>
        </div>
        <div class="sheet__body">
          <div class="eyebrow" data-exhibit-anchor="sec-${esc(n)}">${n} — ${esc(label)}</div>
          <h2 class="section-title">${esc(label)}</h2>
          <div class="section-rule"></div>
          <div class="supplement-section-body">${s.contentHtml}</div>
        </div>
        <div class="sheet__footer">
          <span class="pg-label">${esc(data.company.brand)} · ${esc(data.supplementNumber)}</span>
          <span class="pg-num" data-pg-num></span>
        </div>
      </div>`;
    })
    .join('\n');

  const certificationBlock = `
    <div class="sheet">
      <div class="sheet__runhead"><div id="logo-slot-cert">${logoHtml}</div>
        <div class="rh-info">
          <span>${esc(data.property.address)}</span>
          <span class="sep">·</span>
          <span>Certification — ${esc(data.supplementNumber)}</span>
        </div>
      </div>
      <div class="sheet__body">
        <div class="eyebrow">99 — Certification</div>
        <h2 class="section-title">Supplement Certification</h2>
        <div class="section-rule"></div>
        <p>This supplement is a separate, attributable addendum to the original Proof Package for the property listed above${originalDate ? `, compiled on ${esc(originalDate)}` : ''}. All findings, scope items, and photographs contained herein are dated and attributed to this supplement document and do not modify or re-attest the original package.</p>
        <div class="attestation-body">${data.attestationHtml}</div>
        <div class="sig-block">
          <div>
            <div class="sig-slot">${data.signatureUrl ? `<img src="${esc(data.signatureUrl)}" alt="Inspector signature">` : '<span>SIGNATURE ON FILE</span>'}</div>
            <div class="sig-line">Signed — <span class="role">${esc(data.inspectorName)}</span></div>
          </div>
          <div>
            <div class="sig-slot" style="border-style:solid; background:transparent;"></div>
            <div class="sig-line">Date — ${esc(compiledDate)}</div>
          </div>
        </div>
      </div>
      <div class="sheet__footer">
        <span class="pg-label">${esc(data.company.brand)} · ${esc(data.supplementNumber)}</span>
        <span class="pg-num" data-pg-num></span>
      </div>
    </div>`;

  // Cover page
  const coverPage = `
<div class="sheet cover">
  <div class="cover__top"><div id="logo-slot-cover">${logoHtml}</div></div>
  <div class="cover__body">
    <div class="cover__badge">SUPPLEMENT</div>
    <div class="cover__number">${esc(data.supplementNumber)}</div>
    <div class="cover__reason">${esc(reasonLabel)}</div>
    <div class="cover__divider"></div>
    <div class="kv-grid cover__meta">
      <div class="kv-row"><span class="k">Property</span><span class="v sans">${esc(data.property.address)}</span></div>
      <div class="kv-row"><span class="k">Insured</span><span class="v sans">${esc(data.property.insuredName)}</span></div>
      <div class="kv-row"><span class="k">Carrier</span><span class="v sans">${esc(data.property.carrier)}</span></div>
      <div class="kv-row"><span class="k">Claim Number</span><span class="v">${esc(data.property.claimNumber)}</span></div>
      <div class="kv-row"><span class="k">Date of Loss</span><span class="v">${esc(data.property.dateOfLoss)}</span></div>
      ${originalDate ? `<div class="kv-row"><span class="k">Original Package</span><span class="v">${esc(originalDate)}</span></div>` : ''}
      <div class="kv-row"><span class="k">Supplement Compiled</span><span class="v">${esc(compiledDate)}</span></div>
    </div>
  </div>
  <div class="cover__bottom">${esc(data.company.legalName)}</div>
</div>`;

  // Opening statement sheet
  const openingSheet = `
<div class="sheet">
  <div class="sheet__runhead"><div id="logo-slot-open">${logoHtml}</div>
    <div class="rh-info">
      <span>${esc(data.property.address)}</span>
      <span class="sep">·</span>
      <span>${esc(data.supplementNumber)}</span>
    </div>
  </div>
  <div class="sheet__body">
    <div class="eyebrow">00 — Opening Statement</div>
    <h2 class="section-title">Supplement Opening Statement</h2>
    <div class="section-rule"></div>
    <p>${esc(data.company.legalName)} submits this supplement as a separate, dated addendum to the original Proof Package for the property at ${esc(data.property.address)} (Claim No.&nbsp;${esc(data.property.claimNumber)}).${originalDate ? ` The original package was compiled on ${esc(originalDate)}.` : ''}</p>
    <p style="margin-top:10px;"><strong>Basis for supplement:</strong> ${esc(reasonLabel)}.</p>
    <p style="margin-top:10px;">This supplement addresses newly identified or disclosed information that was not available or accessible at the time of the original inspection and is presented as a separate analysis to preserve the integrity of the original attested document. The original package is not modified, re-rendered, or re-attested by the issuance of this supplement.</p>
    <div class="note-box info" style="margin-top:14px;">
      <b>Concealed-conditions addendum:</b> this analysis supplements the original report as a dated, attributable addendum per Attestation Block B's concealed-conditions language. Exhibit badges from this supplement append within their class without renumbering the original package exhibits.
    </div>
  </div>
  <div class="sheet__footer">
    <span class="pg-label">${esc(data.company.brand)} · ${esc(data.supplementNumber)}</span>
    <span class="pg-num" data-pg-num></span>
  </div>
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(data.supplementNumber)} — Supplement Package — ${esc(data.property.address)}</title>
<style>
  :root {
    --primary: ${primaryColor};
    --accent:  ${accentColor};
    --slate:   #555e6c;
    --rule:    #dde0e6;
    --bg:      #f5f6f8;
    --body-font: 'Georgia', serif;
    --sans-font: 'Helvetica Neue', Arial, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--body-font); font-size: 13px; color: #1a1e27; background: #fff; }

  /* Sheet layout */
  .sheet { min-height: 11in; width: 8.5in; margin: 0 auto 24px; border: 1px solid var(--rule); display: flex; flex-direction: column; }
  .sheet__runhead { display: flex; align-items: center; justify-content: space-between; padding: 12px 28px; background: var(--primary); color: #fff; }
  .sheet__runhead img { height: 28px; object-fit: contain; }
  .rh-info { display: flex; gap: 6px; font-family: var(--sans-font); font-size: 11px; }
  .sep { opacity: .5; }
  .sheet__body { flex: 1; padding: 28px; }
  .sheet__footer { display: flex; justify-content: space-between; padding: 8px 28px; font-family: var(--sans-font); font-size: 10px; color: var(--slate); border-top: 1px solid var(--rule); }

  /* Cover */
  .cover { background: var(--primary); color: #fff; }
  .cover__top { padding: 24px 32px; }
  .cover__top img { height: 40px; object-fit: contain; filter: brightness(0) invert(1); }
  .cover__body { flex: 1; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 32px; }
  .cover__badge { font-family: var(--sans-font); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; opacity: .7; margin-bottom: 8px; }
  .cover__number { font-size: 48px; font-weight: 700; letter-spacing: -1px; color: var(--accent); }
  .cover__reason { font-family: var(--sans-font); font-size: 16px; opacity: .9; margin-top: 4px; }
  .cover__divider { width: 60px; height: 3px; background: var(--accent); margin: 20px 0; }
  .cover__meta { max-width: 420px; }
  .cover__meta .kv-row .k { color: rgba(255,255,255,.6); }
  .cover__meta .kv-row .v { color: #fff; }
  .cover__bottom { padding: 20px 32px; font-family: var(--sans-font); font-size: 12px; opacity: .6; border-top: 1px solid rgba(255,255,255,.15); }

  /* Typography */
  h2.section-title { font-family: var(--sans-font); font-size: 22px; font-weight: 600; margin-top: 4px; }
  .eyebrow { font-family: var(--sans-font); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--accent); }
  .section-rule { height: 2px; background: var(--primary); margin: 8px 0 16px; }
  p { line-height: 1.6; margin-top: 8px; }
  .micro { font-family: var(--sans-font); font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--slate); margin-top: 16px; }

  /* KV grid */
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-top: 8px; }
  .kv-row { display: contents; }
  .kv-row .k { font-family: var(--sans-font); font-size: 11px; color: var(--slate); padding: 3px 0; }
  .kv-row .v { font-size: 12px; padding: 3px 0; }
  .kv-row .v.sans { font-family: var(--sans-font); }

  /* Note boxes */
  .note-box { border-left: 4px solid var(--primary); background: var(--bg); padding: 10px 14px; font-size: 12px; line-height: 1.5; }
  .note-box.info { border-color: var(--accent); }

  /* Attestation & signature */
  .attestation-body { font-size: 12px; line-height: 1.7; margin-top: 14px; padding: 14px; border: 1px solid var(--rule); background: var(--bg); }
  .sig-block { display: flex; gap: 32px; margin-top: 20px; }
  .sig-slot { width: 200px; height: 60px; border-bottom: 2px solid var(--primary); background: var(--bg); display: flex; align-items: center; justify-content: center; }
  .sig-slot img { max-height: 56px; max-width: 196px; object-fit: contain; }
  .sig-line { font-family: var(--sans-font); font-size: 10px; color: var(--slate); margin-top: 4px; }
  .sig-line .role { color: #1a1e27; font-weight: 600; }

  /* Supplement section body — pass through sanitized HTML */
  .supplement-section-body { font-size: 13px; line-height: 1.6; }
  .supplement-section-body p { margin-top: 8px; }
  .supplement-section-body ul, .supplement-section-body ol { margin-top: 8px; padding-left: 18px; }
  .supplement-section-body li { margin-top: 4px; }

  @media print {
    body { margin: 0; }
    .sheet { border: none; page-break-after: always; min-height: auto; }
    @page { size: letter; margin: 0; }
  }
</style>
</head>
<body>
${coverPage}
${openingSheet}
${sectionBlocks}
${certificationBlock}
<script>
(function(){
  var pgs = document.querySelectorAll('[data-pg-num]');
  pgs.forEach(function(el, i){ el.textContent = 'p. ' + (i + 1); });
})();
</script>
</body>
</html>`;
}
