/**
 * FIPSA HTML template utilities.
 *
 * The HTML below is the verbatim self-contained FIPSA agreement template.
 * Legal text must NOT be paraphrased or reordered.
 *
 * Usage:
 *   buildPreviewHtml(data)  → mobile-scaled HTML for WebView reading
 *   buildFipsaHtml(data)    → print-ready HTML for expo-print PDF generation
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FipsaParty {
  signatureImage: string; // data: URI PNG, or "" for blank ruled line
  printName: string;
  signDate: string; // MM/DD/YYYY
}

export interface FipsaData {
  logoUrl?: string;
  ownerNames: string;
  agreementDate: string; // MM/DD/YYYY
  propertyAddress: string;
  owner: FipsaParty;
  contractorRep: FipsaParty;
  cancellation: {
    transactionDate: string;
    cancelDeadline: string;
    buyerDate: string;
    buyerSignatureImage: string;
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Format a Date as MM/DD/YYYY. */
export function formatMDY(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

/** Add N business days (Mon–Fri) to a date. */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// ── Template ──────────────────────────────────────────────────────────────────

/** Fill the FIPSA_DATA block and return the completed HTML. */
export function buildFipsaHtml(data: FipsaData): string {
  const block = JSON.stringify(
    {
      logoUrl: data.logoUrl ?? '',
      ownerNames: data.ownerNames,
      agreementDate: data.agreementDate,
      propertyAddress: data.propertyAddress,
      owner: data.owner,
      contractorRep: data.contractorRep,
      cancellation: data.cancellation,
    },
    null,
    2,
  );
  return FIPSA_TEMPLATE.replace(
    /\/\* FIPSA_DATA_START \*\/[\s\S]*?\/\* FIPSA_DATA_END \*\//,
    `/* FIPSA_DATA_START */\nconst FIPSA_DATA = ${block};\n/* FIPSA_DATA_END */`,
  );
}

/**
 * Same as buildPreviewHtml but uses a larger font so customers can read the
 * document comfortably on-screen before signing. No scroll-detection is
 * injected — this is review-only and has zero effect on the final PDF.
 */
export function buildReadableHtml(data: FipsaData): string {
  const base = buildFipsaHtml(data);
  const mobileCss = `
<style>
  .page { width: 100% !important; max-width: 100% !important;
          padding: 20px 22px !important; }
  body  { font-size: 13pt; line-height: 1.55; }
  h1.doc-title { font-size: 18pt; }
  h2, .section-title { font-size: 14pt; }
  .sig-line, .sig-name, .sig-date { font-size: 12pt; }
</style>`;
  return base.replace('</style>', `</style>${mobileCss}`);
}

/**
 * Same as buildFipsaHtml but injects a CSS override that removes the fixed
 * letter-width so the agreement fits on a mobile screen inside a WebView.
 * Also injects scroll-to-bottom detection that posts 'bottom' via
 * ReactNativeWebView.postMessage when the user reaches the end.
 */
export function buildPreviewHtml(data: FipsaData): string {
  const base = buildFipsaHtml(data);
  const mobileCss = `
<style>
  .page { width: 100% !important; max-width: 100% !important;
          padding: 16px 18px !important; }
  body  { font-size: 8pt; }
</style>`;
  const scrollScript = `
<script>
(function(){
  var done=false;
  function chk(){
    if(done)return;
    if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-60){
      done=true;
      if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('bottom');
    }
  }
  window.addEventListener('scroll',chk,{passive:true});
  setTimeout(chk,600);
})();
</script>`;
  return base
    .replace('</style>', `</style>${mobileCss}`)
    .replace('</body>', `${scrollScript}</body>`);
}

// ── Verbatim FIPSA HTML ───────────────────────────────────────────────────────
// Legal text is verbatim from FIPSA.pdf. Do NOT paraphrase, reorder, or edit.

const FIPSA_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Forensic Inspection &amp; Preconstruction Services Agreement</title>
<style>
  :root{
    --navy:#14263B;
    --orange:#E8792B;
    --ink:#1a1a1a;
    --rule:#333;
  }
  *{ box-sizing:border-box; }
  @page{ size: Letter; margin:0; }
  html,body{ margin:0; padding:0; }
  body{
    font-family: "Calibri", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color:var(--ink);
    font-size:8pt;
    line-height:1.33;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .page{
    width:8.5in;
    margin:0 auto;
    padding:0.55in 0.8in;
    background:#fff;
  }
  .page + .page{ page-break-before:always; }

  /* ---------- Letterhead ---------- */
  .letterhead{ text-align:center; }
  .letterhead .logo{ height:54px; margin:0 auto 4px; display:block; }
  .rule{ height:2px; background:var(--orange); margin:7px 0 12px; border:0; }

  h1.doc-title{
    color:var(--navy);
    font-size:14pt;
    text-align:center;
    text-transform:uppercase;
    letter-spacing:.3px;
    margin:0 0 10px;
  }

  /* ---------- Party / property header fields ---------- */
  .hdr-fields{ margin-bottom:10px; }
  .hdr-row{ display:flex; align-items:flex-end; gap:16px; margin-bottom:6px; }
  .hdr-label{ color:var(--navy); font-weight:700; white-space:nowrap; }
  .fill{
    display:inline-block;
    border-bottom:1px solid var(--rule);
    min-width:180px;
    padding:0 5px 1px;
    line-height:1.35;
  }
  .fill.grow{ flex:1 1 auto; min-width:220px; }
  .fill.short{ min-width:130px; }
  .fill.mid{ min-width:170px; }

  /* ---------- Clauses ---------- */
  ol.clauses{ margin:0; padding-left:22px; }
  ol.clauses > li{ margin-bottom:3px; text-align:justify; }
  ol.clauses > li .lead{ color:var(--navy); font-weight:700; }

  /* ---------- Signature blocks ---------- */
  .sig-grid{
    display:flex; gap:40px; margin-top:6px;
    break-inside:avoid; page-break-inside:avoid;
  }
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
  .sig-caption{ font-size:9.5pt; color:#555; margin-top:3px; }
  .sig-printrow{ margin-top:7px; font-size:10pt; white-space:nowrap; }
  .sig-printrow .fill{ min-width:150px; }
  .sig-printrow .fill.short{ min-width:90px; }

  /* ---------- Notice of Cancellation ---------- */
  h1.notice-title{ font-size:22pt; font-weight:700; margin:0 0 20px; color:#111; }
  .notice p{ text-align:justify; margin:0 0 14px; }
  .notice .field-line{ margin:0 0 14px; }
  .notice .fill{ min-width:200px; }
  .notice .fill.short{ min-width:150px; }
  .notice .hereby{ font-weight:700; margin:18px 0 20px; }

  @media print{
    .page{ margin:0; padding:0.55in 0.8in; }
  }
</style>
</head>
<body>

<!-- ================= PAGE 1 — AGREEMENT ================= -->
<section class="page">
  <div class="letterhead">
    <img class="logo" data-logo src="" style="display:none;" alt="Company logo" />
  </div>
  <hr class="rule" />

  <h1 class="doc-title">Forensic Inspection &amp; Preconstruction Services Agreement</h1>

  <div class="hdr-fields">
    <div class="hdr-row">
      <span class="hdr-label">Owner(s):</span>
      <span class="fill grow" data-field="ownerNames"></span>
      <span class="hdr-label">Date:</span>
      <span class="fill short" data-field="agreementDate"></span>
    </div>
    <div class="hdr-row">
      <span class="hdr-label">Property Address:</span>
      <span class="fill grow" data-field="propertyAddress"></span>
    </div>
  </div>

  <ol class="clauses">
    <li><span class="lead">Engagement &amp; Authorization.</span> Owner retains NuHome Exteriors, Inc. (&ldquo;Contractor&rdquo;) to perform a comprehensive Phase 2 forensic inspection of the systems identified above at the Property. Owner authorizes Contractor and its personnel to access the Property, both exterior and interior areas as reasonably required, and to take physical measurements; capture photographs and video; install test squares and perform surface-level examination where appropriate; research weather and storm event data for the Property; identify installed materials, including verification of discontinued or unavailable products; obtain supplier and manufacturer quotes; and develop a repair scope with a fixed-price estimate.</li>

    <li><span class="lead">Deliverable &mdash; Forensic Proof Package.</span> Contractor shall prepare and deliver to Owner a Forensic Proof Package consisting of: (a) a written forensic inspection report; (b) organized photographic documentation; (c) measurements and diagrams; (d) weather event research findings; (e) material identification and availability findings, with supplier quotes where applicable; and (f) a documented repair scope and fixed-price estimate for the restoration work.</li>

    <li><span class="lead">Fee.</span> The fee for the services and deliverables described above is $750.00 (the &ldquo;Documentation Fee&rdquo;), due upon delivery of the Forensic Proof Package.</li>

    <li><span class="lead">Credit Toward Construction.</span> If Owner executes a written construction agreement with Contractor for the restoration work documented in the Forensic Proof Package within three (3) days of its delivery (the &ldquo;Credit Period&rdquo;), the entire Documentation Fee will be credited in full against the construction contract price.</li>

    <li><span class="lead">Limited Exclusivity.</span> During the Credit Period, this engagement is exclusive: Owner agrees not to engage, authorize, or contract with any other contractor to inspect, document, scope, or perform the restoration work addressed by this Agreement. After the Credit Period expires, Owner is free to engage any contractor, and the Forensic Proof Package belongs to Owner for any lawful use.</li>

    <li><span class="lead">Cancellation; When the Fee Is Earned.</span> Owner may cancel this Agreement in writing at any time before the inspection is performed at no cost. Once the inspection has been performed, the Documentation Fee is fully earned upon Contractor&rsquo;s delivery of the Forensic Proof Package which shall occur within 24 hours of the termination of the FTC Cooling-Off Period, regardless of the outcome of any insurance claim or whether Owner proceeds with construction.</li>

    <li><span class="lead">Role of Contractor; Not a Public Adjuster.</span> Contractor is a licensed construction contractor engaged to document construction conditions, repair scope, and repair cost. Contractor is not a public adjuster and will not adjust, negotiate, or settle any insurance claim on Owner&rsquo;s behalf, advise Owner on insurance coverage, or act as Owner&rsquo;s representative with any insurer (Va. Code &sect; 38.2-1845.12). Any information Contractor provides to an insurer is limited to construction scope, conditions, and pricing, at Owner&rsquo;s direction.</li>

    <li><span class="lead">No Construction Work Awarded.</span> This Agreement authorizes inspection and preconstruction services only. No construction or restoration work is awarded, promised, or authorized under this Agreement unless expressly stated in a separate written construction agreement signed by both parties. If conditions warrant, homeowner authorizes the contractor to complete a Repairability Assessment using a simulated repair protocol.</li>

    <li><span class="lead">General.</span> This Agreement is governed by Virginia law and is the entire agreement between the parties regarding its subject matter. Any dispute arising under this Agreement shall be resolved by binding arbitration before a single arbitrator under the Commercial Rules of the American Arbitration Association.</li>
  </ol>

  <div class="sig-grid">
    <div class="sig-col">
      <div class="sig-party">OWNER</div>
      <span class="sigline"><img data-sig="owner" alt="" /></span>
      <div class="sig-caption">Signature</div>
      <div class="sig-printrow">
        Print: <span class="fill" data-field="owner.printName"></span>
        &nbsp;Date: <span class="fill short" data-field="owner.signDate"></span>
      </div>
    </div>
    <div class="sig-col">
      <div class="sig-party">NUHOME EXTERIORS, INC.</div>
      <span class="sigline"><img data-sig="contractorRep" alt="" /></span>
      <div class="sig-caption">Authorized Representative</div>
      <div class="sig-printrow">
        Print: <span class="fill" data-field="contractorRep.printName"></span>
        &nbsp;Date: <span class="fill short" data-field="contractorRep.signDate"></span>
      </div>
    </div>
  </div>
</section>

<!-- ================= PAGE 2 — NOTICE OF CANCELLATION ================= -->
<section class="page notice">
  <h1 class="notice-title">Notice of Cancellation</h1>

  <div class="field-line">Transaction Date: <span class="fill" data-field="cancellation.transactionDate"></span></div>

  <p>You may CANCEL this transaction, without any Penalty or Obligation, within THREE BUSINESS DAYS from the above date.</p>

  <p>If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within TEN BUSINESS DAYS following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be cancelled.</p>

  <p>If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller's expense and risk.</p>

  <p>If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your Notice of Cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to the seller, or if you agree to return the goods to the seller and fail to do so, then you remain liable for performance of all obligations under the contract.</p>

  <p>To cancel this transaction, mail or deliver a signed and dated copy of this Cancellation Notice or any other written notice, or send a telegram, to NUHOME EXTERIORS, INC, at 3615-A CHAIN BRIDGE RD, FAIRFAX, VA 20131, NOT LATER THAN MIDNIGHT OF <span class="fill short" data-field="cancellation.cancelDeadline"></span>.</p>

  <p class="hereby">I HEREBY CANCEL THIS TRANSACTION.</p>

  <div class="field-line">Date: <span class="fill short" data-field="cancellation.buyerDate"></span></div>

  <div class="field-line">Buyer's signature: <span class="sigline" style="display:inline-block; width:60%; vertical-align:middle;"><img data-sig="buyer" alt="" /></span></div>
</section>

<script>
/* FIPSA_DATA_START */
const FIPSA_DATA = {
  logoUrl: "",
  ownerNames: "",
  agreementDate: "",
  propertyAddress: "",
  owner: { signatureImage: "", printName: "", signDate: "" },
  contractorRep: { signatureImage: "", printName: "", signDate: "" },
  cancellation: { transactionDate: "", cancelDeadline: "", buyerDate: "", buyerSignatureImage: "" }
};
/* FIPSA_DATA_END */

(function renderFipsa(){
  const D = FIPSA_DATA || {};
  const get = (path) => path.split('.').reduce((o,k)=> (o==null?undefined:o[k]), D);

  document.querySelectorAll('[data-field]').forEach(el => {
    const v = get(el.getAttribute('data-field'));
    if (v != null && String(v).length) el.textContent = String(v);
  });

  const logo = document.querySelector('[data-logo]');
  if (D.logoUrl && logo){
    logo.src = D.logoUrl;
    logo.style.display = 'block';
    logo.addEventListener('error', function(){ logo.style.display = 'none'; });
  }

  const sigSrc = {
    owner: D.owner && D.owner.signatureImage,
    contractorRep: D.contractorRep && D.contractorRep.signatureImage,
    buyer: D.cancellation && D.cancellation.buyerSignatureImage
  };
  document.querySelectorAll('[data-sig]').forEach(img => {
    const src = sigSrc[img.getAttribute('data-sig')];
    if (src) img.src = src; else img.remove();
  });
})();
</script>

</body>
</html>`;
