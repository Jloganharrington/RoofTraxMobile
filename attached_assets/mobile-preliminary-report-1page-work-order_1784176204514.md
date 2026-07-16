# Work Order — Preliminary Homeowner Report: refined 1-page layout

**Target repo:** RoofTraxMobile
**Target file:** `artifacts/mobile/lib/homeownerReport.ts`
**Scope:** Replace **only** the report's HTML/CSS builder. No changes to photo
resolution, storm/damage data, sharing, the friendly-filename copy, the exports,
or the `inspection-report.tsx` screen. This is a presentation-only change.

---

## Goal

The current homeowner PDF (`generateHomeownerReport` → `Print.printToFileAsync`)
renders across **two pages** because the sections are stacked full-width with
generous spacing. Logan wants a **single US-Letter page** that keeps the four
Phase-1 photos prominent, matching the RoofTrax report design language (navy
header, findings cards, numbered next-steps, justified disclaimer, ≥10px type).

The fix is compaction, not clipping:
- Findings + weather become a **3-card horizontal row**.
- Homeowner-reported facts become a **compact one-line strip** (was a full table).
- Photos stay a **2×2 grid**, sized to ~1.55in tall.
- Next steps become a **5-column numbered strip** (was a vertical list).
- Disclaimer is a small justified footer.

**Do NOT introduce a fixed-height / `overflow:hidden` page wrapper.** The same
`html` string is reused by the in-app "View report" WebView (Android can't render
a local PDF), so any clipping container would truncate that view. One-page fit
comes from compact content + `@page { size: Letter }`.

---

## Exact change

In `artifacts/mobile/lib/homeownerReport.ts`, **replace the existing
`homeownerFactRows(...)` function and the existing `buildReportHtml(...)` function**
with the block below. Everything else in the file stays exactly as-is
(`resolvePreliminaryPhotos`, `imageToDataUri`, `esc`, `formatDate`, `damageLabel`,
`ROLE_LABEL`, `ROLE_ORDER`, `NEXT_STEPS`, `toFriendlyPdf`, `generateHomeownerReport`,
`shareHomeownerReport`, all exports).

> Note: `NEXT_STEPS` detail strings are shortened slightly below so they read
> cleanly at 10px in a 5-across strip. If you prefer to keep the existing longer
> `NEXT_STEPS` copy, that's fine — it will just wrap to another line; the page
> still fits. Your call.

```ts
// Compact one-line strip of homeowner-reported facts (replaces the old table).
// Returns '' when no facts were captured, so the section simply doesn't appear.
function homeownerFactsStrip(inspection: Inspection): string {
  const facts = inspection.homeownerFacts;
  if (!facts) return '';
  const awareness =
    facts.awareOfDateOfLoss === true ? 'Yes' : facts.awareOfDateOfLoss === false ? 'No' : 'Unsure';
  const parts: string[] = [`Aware of date of loss: <b>${esc(awareness)}</b>`];
  if (facts.priorRepairs) parts.push(`Prior repairs: <b>${esc(facts.priorRepairs)}</b>`);
  if (facts.priorClaims) parts.push(`Prior claims: <b>${esc(facts.priorClaims)}</b>`);
  return `<div class="hofacts"><span class="l">Homeowner reported</span>${parts.join(
    '<span class="sep">&middot;</span>',
  )}</div>`;
}

function buildReportHtml(inspection: Inspection, photos: ResolvedPhoto[]): string {
  const generatedOn = formatDate(new Date().toISOString());
  const storm = inspection.stormConfirmedRef;

  // Caption the two close-ups distinctly (both share the "Damage close-up" role
  // label): append an ordinal only when a role appears more than once.
  const roleTotals: Record<string, number> = {};
  for (const p of photos) roleTotals[p.role] = (roleTotals[p.role] ?? 0) + 1;
  const roleSeen: Record<string, number> = {};
  const photoCards = photos
    .map((p) => {
      roleSeen[p.role] = (roleSeen[p.role] ?? 0) + 1;
      const base = ROLE_LABEL[p.role];
      const caption = roleTotals[p.role] > 1 ? `${base} ${roleSeen[p.role]}` : base;
      return `<figure class="photo"><img src="${p.dataUri}" /><figcaption>${esc(caption)}</figcaption></figure>`;
    })
    .join('');

  const weatherValue = storm ? esc(storm.type) : 'Not yet matched';
  const weatherSub = storm
    ? esc(storm.date) + (storm.description ? ` &mdash; ${esc(storm.description)}` : '')
    : 'A severe-weather event has not been matched yet.';

  const steps = NEXT_STEPS.map(
    (s, i) =>
      `<div class="step"><div class="n">${i + 1}</div><div class="t">${esc(
        s.title,
      )}</div><div class="d">${esc(s.detail)}</div></div>`,
  ).join('');

  const photosBlock = photos.length
    ? `<div class="slabel">Photos (${photos.length})</div><div class="photos">${photoCards}</div>`
    : `<div class="slabel">Photos</div><p class="muted">No preliminary photos are attached to this report.</p>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  @page { size: Letter; margin: 0.4in; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    color: #191e24;
    font-size: 11px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .muted { color: #718096; }

  /* header */
  .head { background: #0f2942; color: #fff; border-radius: 8px; padding: 16px 18px;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .head .eyebrow { font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase;
    color: #9fb3c8; font-weight: 700; margin: 0 0 5px; }
  .head h1 { font-size: 19px; line-height: 1.15; font-weight: 800; margin: 0 0 4px; }
  .head .sub { font-size: 11px; color: #cbd5e0; margin: 0; }
  .head .meta { text-align: right; font-size: 10px; color: #9fb3c8; white-space: nowrap; }
  .head .meta b { color: #fff; }
  .head .stamp { display: inline-block; margin-top: 8px; font-size: 10px; letter-spacing: .08em;
    text-transform: uppercase; border: 1px solid rgba(255,255,255,.35); border-radius: 4px;
    padding: 3px 8px; color: #e2e8f0; font-weight: 700; }

  /* findings row */
  .facts3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 14px; }
  .fcard { border: 1px solid #e2e8f0; border-radius: 7px; padding: 10px 12px; background: #f7fafc; }
  .fcard.acc { border-left: 3px solid #a6431f; }
  .fcard .l { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #718096;
    font-weight: 700; margin: 0 0 5px; }
  .fcard .v { font-size: 14px; font-weight: 700; color: #1a202c; line-height: 1.2; margin: 0; }
  .fcard .s { font-size: 10px; color: #718096; line-height: 1.35; margin: 3px 0 0; }

  /* homeowner facts strip */
  .hofacts { margin-top: 10px; border: 1px solid #e2e8f0; border-radius: 7px; padding: 9px 12px;
    font-size: 10px; color: #4a5568; line-height: 1.5; }
  .hofacts .l { text-transform: uppercase; letter-spacing: .06em; color: #718096; font-weight: 700;
    margin-right: 8px; }
  .hofacts b { color: #1a202c; }
  .hofacts .sep { color: #cbd5e0; margin: 0 8px; }

  /* section label */
  .slabel { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #718096;
    font-weight: 700; margin: 16px 0 8px; }

  /* photos */
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
  figure.photo { margin: 0; border: 1px solid #e2e8f0; border-radius: 7px; overflow: hidden; }
  figure.photo img { width: 100%; height: 1.55in; object-fit: cover; display: block; }
  figure.photo figcaption { font-size: 10.5px; font-weight: 700; color: #4a5568;
    padding: 6px 10px; background: #f7fafc; border-top: 1px solid #e2e8f0; }

  /* next steps */
  .steps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .step .n { width: 19px; height: 19px; border-radius: 50%; background: #0f2942; color: #fff;
    font-size: 10px; font-weight: 700; text-align: center; line-height: 19px; margin-bottom: 5px; }
  .step .t { font-size: 10.5px; font-weight: 700; color: #1a202c; line-height: 1.2; }
  .step .d { font-size: 10px; color: #718096; line-height: 1.3; margin-top: 2px; }

  /* disclaimer */
  .disc { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 10px; color: #718096; line-height: 1.45; text-align: justify; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <p class="eyebrow">Preliminary Roof Inspection Summary</p>
      <h1>${esc(inspection.address ?? 'Your property')}</h1>
      <p class="sub">A summary of what was found and what comes next.</p>
    </div>
    <div class="meta">Prepared <b>${esc(generatedOn)}</b><br /><span class="stamp">Phase 1 of 2</span></div>
  </div>

  <div class="facts3">
    <div class="fcard acc">
      <p class="l">Damage found</p>
      <p class="v">${esc(damageLabel(inspection))}</p>
      <p class="s">Observed during the preliminary roof review.</p>
    </div>
    <div class="fcard">
      <p class="l">Weather event</p>
      <p class="v">${weatherValue}</p>
      <p class="s">${weatherSub}</p>
    </div>
    <div class="fcard">
      <p class="l">Review type</p>
      <p class="v">Preliminary</p>
      <p class="s">Initial, ground- or drone-level review.</p>
    </div>
  </div>

  ${homeownerFactsStrip(inspection)}

  ${photosBlock}

  <div class="slabel">Next steps</div>
  <div class="steps">${steps}</div>

  <div class="disc">
    This preliminary summary documents observations from an initial, ground-level review and the
    severe-weather event on record. It is not a quote, a repair estimate, or a determination of
    insurance coverage. A full forensic inspection is required to document the extent of any damage.
  </div>
</body>
</html>`;
}
```

### Optional (recommended) — shortened next-steps copy

If you want the tightest one-page fit, also shorten the `NEXT_STEPS` `detail`
strings (titles unchanged):

```ts
const NEXT_STEPS: Array<{ title: string; detail: string }> = [
  { title: 'File a claim', detail: 'Open a claim with your carrier for the storm date noted.' },
  { title: 'Pay for a forensic inspection', detail: 'Authorize the detailed forensic roof inspection.' },
  { title: 'Forensic inspection', detail: 'Full evidence capture of every slope and component.' },
  { title: 'Proof package', detail: 'Findings compiled into a documented, photo-backed report.' },
  { title: 'Claim negotiation', detail: 'The proof package supports the conversation with your carrier.' },
];
```

---

## Why this is safe

- **Same data contract.** `buildReportHtml(inspection, photos)` keeps its exact
  signature and reads the same fields (`address`, `damageType`, `stormConfirmedRef`,
  `homeownerFacts`, and the already-resolved `ResolvedPhoto[]`).
- **No new dependencies, no schema/API changes, no route changes.**
- **PDF + WebView parity preserved.** The returned `html` still flows naturally
  (no clipping), so the in-app "View report" screen shows the identical layout,
  scrollable.
- **UPPA discipline intact.** No pricing, no coverage language — unchanged
  disclaimer wording.

## Print/one-page notes

- `@page { size: Letter; margin: 0.4in }` + `print-color-adjust: exact` keep the
  navy header and cards in color and target a single Letter page.
- Content height budget at 1.55in photos fits one page **with** the homeowner-facts
  strip present. Extremely long free-text `priorRepairs` / `priorClaims` entries
  will grow the strip; if that ever pushes to a second page it's data-driven and
  acceptable, but worth a glance during QA.

## Verification checklist (please confirm in the push report)

1. Generate a report for a preliminary inspection **with all 4 photos** → confirm
   **single page**, 2×2 photo grid, captions "Front of home / Roof overview /
   Damage close-up 1 / Damage close-up 2".
2. Generate one **with a matched storm** and one **without** → weather card shows
   type + date, or "Not yet matched".
3. Generate one **with homeowner facts** and one **without** → strip appears only
   when facts exist; layout still one page.
4. Open the in-app **"View report"** screen → same layout renders (not truncated).
5. `pnpm -C artifacts/mobile typecheck` (or the workspace typecheck) is clean.
6. Share sheet still produces `RoofTrax-Preliminary-Report-<slug>.pdf`.

## Reference

A standalone visual proof of this layout (populated with the 2333 Old Trail Drive
fixture) lives at `preliminary-report-1page.html` on Logan's workstation — same
design, expressed as a static page for review.
