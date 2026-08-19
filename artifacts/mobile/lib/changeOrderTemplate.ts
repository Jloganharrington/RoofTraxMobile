/**
 * Change Order HTML template utilities.
 *
 * Mirrors the FIPSA template pattern exactly:
 *  - Deterministic HTML with a CO_DATA_START/END script block
 *  - No AI, no server round-trip — all data is baked in at signing time
 *  - Works in airplane mode; rendered to PDF on-device via expo-print
 *
 * Usage:
 *   buildChangeOrderHtml(data)         → print-ready HTML for expo-print
 *   buildReadableChangeOrderHtml(data) → mobile-scaled HTML for WebView review
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CoParty {
  signatureImage: string; // data:image/png;base64,… or "" for blank line
  printName: string;
  signDate: string; // MM/DD/YYYY
}

export interface CoLineItemData {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  unit?: string | null;
}

export interface ChangeOrderData {
  companyName?: string;
  propertyAddress: string;
  homeownerName: string;
  date: string; // MM/DD/YYYY
  lineItems: CoLineItemData[];
  totalCents: number;
  /** True = required to complete original scope; false = additional/out-of-scope work. */
  requiredToCompleteScope: boolean;
  homeowner: CoParty;
  rep: CoParty;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a Date as MM/DD/YYYY (re-export for convenience). */
export function formatMDY(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

/** Format cents as a dollar string, e.g. 150000 → "$1,500.00" */
export function centsToDollar(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return neg ? `(${str})` : `$${str}`;
}

// ── Template fill ─────────────────────────────────────────────────────────────

/** Fill the CO_DATA block and return the completed HTML string. */
export function buildChangeOrderHtml(data: ChangeOrderData): string {
  const block = JSON.stringify(
    {
      companyName: data.companyName ?? '',
      propertyAddress: data.propertyAddress,
      homeownerName: data.homeownerName,
      date: data.date,
      lineItems: data.lineItems,
      totalCents: data.totalCents,
      requiredToCompleteScope: data.requiredToCompleteScope,
      homeowner: data.homeowner,
      rep: data.rep,
    },
    null,
    2,
  );
  return CO_TEMPLATE.replace(
    /\/\* CO_DATA_START \*\/[\s\S]*?\/\* CO_DATA_END \*\//,
    `/* CO_DATA_START */\nconst CO_DATA = ${block};\n/* CO_DATA_END */`,
  );
}

/** Mobile-scaled readable version (wider text, larger font) for pre-sign review. */
export function buildReadableChangeOrderHtml(data: ChangeOrderData): string {
  const base = buildChangeOrderHtml(data);
  const css = `<style>
  .page { width:100% !important; max-width:100% !important; padding:20px 22px !important; }
  body  { font-size:13pt; line-height:1.55; }
</style>`;
  return base.replace('</style>', `</style>${css}`);
}

// ── Verbatim HTML template ────────────────────────────────────────────────────

const CO_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Change Order</title>
<style>
  :root{ --navy:#14263B; --orange:#D75308; --ink:#1a1a1a; --rule:#333; }
  *{ box-sizing:border-box; }
  @page{ size:Letter; margin:0; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:"Calibri","Segoe UI","Helvetica Neue",Arial,sans-serif;
    color:var(--ink); font-size:8pt; line-height:1.35;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .page{ width:8.5in; margin:0 auto; padding:0.55in 0.8in; background:#fff; }

  /* Letterhead */
  .doc-title{ color:var(--navy); font-size:16pt; text-align:center;
              text-transform:uppercase; letter-spacing:.5px; margin:0 0 2px; }
  .company-name{ text-align:center; font-size:10pt; color:#555; margin:0 0 8px; }
  .rule{ height:2px; background:var(--orange); margin:8px 0 14px; border:0; }

  /* Header fields */
  .hdr{ display:flex; gap:16px; margin-bottom:10px; align-items:flex-end; }
  .hdr-label{ color:var(--navy); font-weight:700; white-space:nowrap; }
  .fill{
    display:inline-block; border-bottom:1px solid var(--rule);
    min-width:180px; padding:0 4px 1px; line-height:1.35;
  }
  .fill.grow{ flex:1 1 auto; min-width:220px; }
  .fill.short{ min-width:100px; }

  /* Line items table */
  table.items{
    width:100%; border-collapse:collapse; margin:12px 0 8px;
    font-size:8pt;
  }
  table.items th{
    background:var(--navy); color:#fff; text-align:left;
    padding:5px 7px; font-weight:600;
  }
  table.items th.r, table.items td.r{ text-align:right; }
  table.items td{ padding:5px 7px; border-bottom:1px solid #e0e0e0; }
  table.items tr:nth-child(even) td{ background:#f7f8fa; }
  .total-row td{
    border-top:2px solid var(--navy); font-weight:700;
    font-size:9pt; padding-top:7px;
  }

  /* Scope clause */
  .scope-box{
    border:1px solid var(--navy); border-radius:3px;
    padding:8px 10px; margin:12px 0 10px; font-size:8pt;
  }
  .scope-box .scope-label{
    color:var(--navy); font-weight:700; margin-bottom:3px;
  }

  /* Signature grid */
  .sig-grid{ display:flex; gap:40px; margin-top:14px; break-inside:avoid; }
  .sig-col{ flex:1 1 0; }
  .sig-party{ color:var(--navy); font-weight:700; margin-bottom:6px; }
  .sigline{
    display:block; border-bottom:1px solid var(--rule);
    height:22px; position:relative;
  }
  .sigline img{
    position:absolute; bottom:1px; left:4px;
    max-height:21px; max-width:96%; object-fit:contain;
  }
  .sig-caption{ font-size:7.5pt; color:#555; margin-top:3px; }
  .sig-printrow{ margin-top:7px; font-size:9pt; white-space:nowrap; }
  .sig-printrow .fill{ min-width:130px; }
  .sig-printrow .fill.short{ min-width:80px; }

  @media print{
    .page{ margin:0; padding:0.55in 0.8in; }
  }
</style>
</head>
<body>
<section class="page">

  <h1 class="doc-title">Change Order</h1>
  <div class="company-name" data-field="companyName"></div>
  <hr class="rule" />

  <div class="hdr">
    <span class="hdr-label">Property:</span>
    <span class="fill grow" data-field="propertyAddress"></span>
    <span class="hdr-label">Owner:</span>
    <span class="fill" data-field="homeownerName"></span>
    <span class="hdr-label">Date:</span>
    <span class="fill short" data-field="date"></span>
  </div>

  <p style="margin:0 0 4px; font-size:8pt; color:#444;">
    This Change Order authorizes the additional or amended scope of work described
    below. It becomes part of the construction agreement upon signature by both parties.
  </p>

  <table class="items">
    <thead>
      <tr>
        <th style="width:50%">Description</th>
        <th class="r" style="width:10%">Qty</th>
        <th class="r" style="width:12%">Unit</th>
        <th class="r" style="width:14%">Unit Price</th>
        <th class="r" style="width:14%">Total</th>
      </tr>
    </thead>
    <tbody id="items-body"><!-- filled by script --></tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4" class="r" style="padding-right:12px;">TOTAL</td>
        <td class="r" id="grand-total"></td>
      </tr>
    </tfoot>
  </table>

  <div class="scope-box">
    <div class="scope-label" id="scope-label"></div>
    <div id="scope-text"></div>
  </div>

  <div class="sig-grid">
    <div class="sig-col">
      <div class="sig-party">OWNER / HOMEOWNER</div>
      <span class="sigline"><img data-sig="homeowner" alt="" /></span>
      <div class="sig-caption">Signature</div>
      <div class="sig-printrow">
        Print: <span class="fill" data-field="homeowner.printName"></span>
        &nbsp;Date: <span class="fill short" data-field="homeowner.signDate"></span>
      </div>
    </div>
    <div class="sig-col">
      <div class="sig-party" data-field="companyName">CONTRACTOR REPRESENTATIVE</div>
      <span class="sigline"><img data-sig="rep" alt="" /></span>
      <div class="sig-caption">Authorized Representative</div>
      <div class="sig-printrow">
        Print: <span class="fill" data-field="rep.printName"></span>
        &nbsp;Date: <span class="fill short" data-field="rep.signDate"></span>
      </div>
    </div>
  </div>

</section>

<script>
/* CO_DATA_START */
const CO_DATA = {
  "companyName": "",
  "propertyAddress": "",
  "homeownerName": "",
  "date": "",
  "lineItems": [],
  "totalCents": 0,
  "requiredToCompleteScope": false,
  "homeowner": { "signatureImage": "", "printName": "", "signDate": "" },
  "rep": { "signatureImage": "", "printName": "", "signDate": "" }
};
/* CO_DATA_END */

(function render(){
  const D = CO_DATA || {};
  const get = (path) => path.split('.').reduce((o,k)=> (o==null ? undefined : o[k]), D);

  // Text fields
  document.querySelectorAll('[data-field]').forEach(el => {
    const v = get(el.getAttribute('data-field'));
    if (v != null && String(v).length) el.textContent = String(v);
  });

  // Signatures
  const sigSrc = {
    homeowner: D.homeowner && D.homeowner.signatureImage,
    rep:       D.rep       && D.rep.signatureImage,
  };
  document.querySelectorAll('[data-sig]').forEach(img => {
    const src = sigSrc[img.getAttribute('data-sig')];
    if (src) img.src = src; else img.remove();
  });

  // Line items
  const fmt = (cents) => {
    const neg = cents < 0;
    const abs = Math.abs(cents) / 100;
    const s = abs.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return neg ? '(' + s + ')' : '$' + s;
  };
  const tbody = document.getElementById('items-body');
  (D.lineItems || []).forEach(li => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + li.description + '</td>' +
      '<td class="r">' + (li.quantity % 1 === 0 ? li.quantity : li.quantity.toFixed(2)) + '</td>' +
      '<td class="r">' + (li.unit || '') + '</td>' +
      '<td class="r">' + fmt(li.unitPriceCents) + '</td>' +
      '<td class="r">' + fmt(li.totalCents) + '</td>';
    tbody.appendChild(tr);
  });
  document.getElementById('grand-total').textContent = fmt(D.totalCents || 0);

  // Scope clause
  const label = document.getElementById('scope-label');
  const text  = document.getElementById('scope-text');
  if (D.requiredToCompleteScope) {
    label.textContent = 'Required to Complete Original Scope';
    text.textContent  = 'The work described in this Change Order is necessary to complete the original contracted scope of work. Completion of the project is contingent on the approval and execution of this Change Order.';
  } else {
    label.textContent = 'Additional / Out-of-Scope Work';
    text.textContent  = 'The work described in this Change Order is outside the original contracted scope of work and represents an additional authorization. This Change Order does not affect the original contract obligations.';
  }
})();
</script>
</body>
</html>`;
