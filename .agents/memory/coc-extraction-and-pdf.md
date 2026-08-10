---
name: Completion Certificate extraction and PDF generation
description: Lessons from implementing the COC extraction pipeline (Phase B/C) — prompt rules, PDFKit build quirk, and the sign endpoint pattern.
---

## PDFKit must be externalized in build.mjs

**Rule:** Add `"pdfkit"` to the `external` array in `artifacts/api-server/build.mjs`.

**Why:** PDFKit resolves AFM font data files via `path.join(__dirname, '../../data/')` relative to its own library source. When esbuild bundles pdfkit, `__dirname` resolves to `dist/` (thanks to the banner shim), so PDFKit looks for fonts at `dist/data/Helvetica.afm` — a path that never exists. Externalizing pdfkit lets Node load it from node_modules at runtime, where the font data is co-located with the package. This affects both `contractPdf.ts` (existing) and `completionCertificates.ts` (new).

**How to apply:** Any new route or lib file that imports `pdfkit` already benefits from this. If you ever add a second bundled service that uses pdfkit, externalize it in that service's build config too.

---

## COC extraction prompt must explicitly exclude subtotal rows

**Rule:** The Gemini extraction prompt for COC line items must include: "do NOT emit subtotal, total, grand total, or summary rows."

**Why:** PDFKit-generated carrier estimate PDFs include printed SUBTOTAL and GRAND TOTAL rows. Gemini treats them as line items (they are printed rows) and returns them, doubling every subtotal. Prompt version `1.0` in `src/lib/cocExtraction.ts` includes this rule — do not remove it.

**How to apply:** Any future prompt update to `COC_EXTRACTION_SYSTEM_PROMPT` must preserve this rule. If you change the prompt, verify against the representative estimate (Midwest Mutual fixture) that the extracted subtotals match $32,625 (base) + $8,577 (PWI) = $41,202.

---

## COC sign endpoint pattern

**Rule:** `POST /leads/:leadId/completion-certificate/:certId/sign` stamps the cert in this order:
1. Gate: `cert.status === 'draft'`
2. Gate: `canSignCompletionCertificate(callerRole, callerDepartment)` from `@workspace/authz`
3. Signer title: `body.signerTitle ?? userProfile.title ?? ''`
4. PDF generation with PDFKit (three sections: base contract, carrier COs, PWI)
5. `sha256` via `createHash('sha256').update(buffer).digest('hex')`
6. Upload: `objectStorageService.uploadObjectBuffer(buffer, 'application/pdf')`
7. Update cert row (status='signed', documentObjectPath, documentSha256, signedByUserId, signedAt, signerTitle)
8. `await emitPipelineEvent({ companyId, eventType: 'completion_package_generated', leadId })`

**Why `await` (not `void`):** work-order constraint — the event must be awaited so any autoAdvance stage transition completes before the response is sent.

---

## completion_certificates table shape

Migration 042. Schema:
- `status`: 'draft' | 'signed' | 'voided'
- `line_items` JSONB: `{ baseContract: LineItem[], pwi: LineItem[], dropped: DroppedItem[] }`
- `LineItem`: `{ description, quantity?, unit?, amountCents }`
- `DroppedItem`: `{ text, reason }`
- Signed certs are immutable — void + re-extract to correct

`change_orders.carrier_reimbursable` boolean (default false, migration 042): controls whether an approved CO appears on the COC between base and PWI sections.

`user_profiles.title` text (migration 043): signer title default fallback.
