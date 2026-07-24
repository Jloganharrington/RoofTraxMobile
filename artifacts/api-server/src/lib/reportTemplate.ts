import type { inspectionsTable } from '@workspace/db';

// ── Forensic report HTML template ──────────────────────────────────────────
// Extracted from routes/inspections.ts so the template is independently
// maintainable and themeable. Rendering happens at PREVIEW TIME (not compile
// time) so every invocation gets fresh signed photo URLs and the company's
// CURRENT color palette — the persisted artifact never embeds either.

/** Escape a value for safe embedding in HTML without a dependency. */
export function escHtml(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Company-configurable report color palette. All values are strict #RRGGBB
 * hex strings — validated at write time (PATCH route) AND re-validated at
 * render time before being embedded into the style block.
 */
export type ReportTheme = {
  /** Cover background, section-title text, photo-group headings. */
  headerColor: string;
  /** Text on the cover header. */
  headerTextColor: string;
  /** Section-title accent bar and highlight tags. */
  accentColor: string;
};

export const DEFAULT_REPORT_THEME: ReportTheme = {
  headerColor: '#1a2744',
  headerTextColor: '#ffffff',
  accentColor: '#3b82f6',
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Strict #RRGGBB validator — these values are embedded into rendered HTML. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/**
 * Merge a stored (possibly partial/legacy/invalid) branding object into a
 * complete, render-safe theme. Any field that is not a strict hex color
 * falls back to the default — render-time defense in depth.
 */
export function resolveReportTheme(branding: unknown): ReportTheme {
  const b = (branding ?? {}) as Record<string, unknown>;
  return {
    headerColor: isHexColor(b.headerColor) ? b.headerColor : DEFAULT_REPORT_THEME.headerColor,
    headerTextColor: isHexColor(b.headerTextColor)
      ? b.headerTextColor
      : DEFAULT_REPORT_THEME.headerTextColor,
    accentColor: isHexColor(b.accentColor) ? b.accentColor : DEFAULT_REPORT_THEME.accentColor,
  };
}

/**
 * Assemble the final report HTML from structured parts.
 * `theme` colors are injected as CSS custom properties on :root; when no
 * theme is provided the report renders identically to the original design.
 */
export function buildReportHtml(params: {
  inspection: typeof inspectionsTable.$inferSelect;
  inspector: { name: string; email: string | null };
  aiSummary: { forensicSummary: string; repairabilityText: string };
  propertyDetailsHtml: string;
  photoSectionsHtml: string;
  attestationHtml: string;
  generatedAt: string;
  theme?: ReportTheme;
}): string {
  const { inspection, inspector, aiSummary } = params;
  const theme = resolveReportTheme(params.theme);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forensic Inspection &amp; Repairability Report</title>
<style>
  :root {
    --report-header-bg: ${theme.headerColor};
    --report-header-text: ${theme.headerTextColor};
    --report-accent: ${theme.accentColor};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 14px;
         line-height: 1.6; color: #1a1a1a; background: #fff; }
  .cover { background: var(--report-header-bg); color: var(--report-header-text); padding: 40px 32px 32px; }
  .cover h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
  .cover h2 { font-size: 15px; font-weight: 400; opacity: 0.8; margin-bottom: 24px; }
  .cover-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 13px; }
  .cover-meta dt { opacity: 0.65; font-weight: 600; text-transform: uppercase; font-size: 10px;
                    letter-spacing: 0.6px; }
  .cover-meta dd { font-weight: 600; margin-bottom: 8px; }
  .section { padding: 28px 32px; border-bottom: 1px solid #eee; }
  .section:last-child { border-bottom: none; }
  .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.7px;
                    color: var(--report-header-bg); border-left: 4px solid var(--report-accent); padding-left: 10px; margin-bottom: 16px; }
  .narrative { color: #333; line-height: 1.75; }
  .narrative p { margin-bottom: 12px; }
  .detail-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .detail-table th { text-align: left; background: #f5f7fa; padding: 8px 12px; font-weight: 700;
                      color: #555; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
  .detail-table td { padding: 8px 12px; border-top: 1px solid #eee; vertical-align: top; }
  .detail-table tr:hover td { background: #fafbfc; }
  .photo-group { margin-bottom: 28px; }
  .photo-group-title { font-size: 13px; font-weight: 700; color: var(--report-header-bg); margin-bottom: 12px;
                        padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .photo-card { border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb; }
  .photo-card img { width: 100%; height: 160px; object-fit: cover; display: block; background: #f0f0f0; }
  .photo-caption { padding: 8px 10px; font-size: 12px; color: #555; line-height: 1.4; }
  .attestation { font-size: 13px; color: #444; line-height: 1.7; }
  .footer { background: #f5f7fa; padding: 16px 32px; font-size: 11px; color: #888; text-align: center; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;
          background: #dbeafe; color: #1e40af; margin-right: 4px; }
</style>
</head>
<body>

<div class="cover">
  <h1>Forensic Inspection &amp; Repairability Report</h1>
  <h2>${escHtml(inspection.address ?? 'Address not recorded')}</h2>
  <dl class="cover-meta">
    <dt>Claim #</dt><dd>${escHtml(inspection.claimNumber ?? '—')}</dd>
    <dt>Policy #</dt><dd>${escHtml(inspection.policyNumber ?? '—')}</dd>
    <dt>Insured</dt><dd>${escHtml(inspection.insuredName ?? '—')}</dd>
    <dt>Carrier</dt><dd>${escHtml(inspection.carrierName ?? '—')}</dd>
    <dt>Date of Loss</dt><dd>${escHtml(inspection.dateOfLoss ?? '—')}</dd>
    <dt>Inspector</dt><dd>${escHtml(inspector.name)}</dd>
    <dt>Inspection ID</dt><dd style="font-size:11px;opacity:0.7">${escHtml(inspection.id)}</dd>
    <dt>Report Generated</dt><dd>${escHtml(new Date(params.generatedAt).toLocaleString())}</dd>
  </dl>
</div>

<!-- Section 1: Forensic Inspection Summary (from Claude AI Summary) -->
<div class="section">
  <div class="section-title">1 — Forensic Inspection Summary</div>
  <div class="narrative">
    ${aiSummary.forensicSummary.split('\n').map(p => p.trim() ? `<p>${escHtml(p)}</p>` : '').join('')}
  </div>
</div>

<!-- Section 2: Property Construction Details (Gemini-narrated) -->
<div class="section">
  <div class="section-title">2 — Property Construction Details</div>
  ${params.propertyDetailsHtml}
</div>

<!-- Section 3: Photo Evidence (Gemini-grouped) -->
<div class="section">
  <div class="section-title">3 — Photo Evidence</div>
  ${params.photoSectionsHtml}
</div>

<!-- Section 4: Repairability Summary (from Claude AI Summary) -->
${aiSummary.repairabilityText ? `
<div class="section">
  <div class="section-title">4 — Repairability Summary</div>
  <div class="narrative">
    ${aiSummary.repairabilityText.split('\n').map(p => p.trim() ? `<p>${escHtml(p)}</p>` : '').join('')}
  </div>
</div>` : ''}

<!-- Section 5: Inspector Attestation -->
<div class="section">
  <div class="section-title">${aiSummary.repairabilityText ? '5' : '4'} — Inspector Attestation</div>
  <div class="attestation">${params.attestationHtml}</div>
</div>

<div class="footer">
  Generated ${escHtml(new Date(params.generatedAt).toLocaleString())} · Inspection ${escHtml(inspection.id)} ·
  This report is produced by RoofTrax and is intended for insurance claim documentation purposes only.
</div>

</body>
</html>`;
}
