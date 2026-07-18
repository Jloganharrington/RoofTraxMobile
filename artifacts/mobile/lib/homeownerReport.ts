import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import type { Inspection, PreliminaryPhotoRole } from '@workspace/api-client-react';
import { getApiBaseUrl } from './api';
import { getToken } from './tokenStorage';
import { DAMAGE_TYPE_LABEL } from './preliminary';
import { listSyncableOutboxItems } from './outbox/queue';
import type { InspectionPhotoOutboxPayload } from './outbox/types';

// Homeowner report (P3): turns everything captured in Phase 1 — property,
// damage type, matched storm, homeowner-reported facts, and the four evidence
// photos — into a self-contained PDF. The PDF IS the shareable summary: it can
// be downloaded via the OS share sheet, or attached to a new email in the
// device's mail app for the inspector to send to the homeowner.
//
// No pricing and no coverage opinion appear anywhere — the report states facts
// and a fixed next-steps path, never a promise.

// expo-file-system@19's File class doesn't expose its instance methods on the
// exported type (they exist at runtime); this documents the subset we use.
interface UsableFile {
  readonly uri: string;
  exists: boolean;
  copy(destination: UsableFile): void;
  delete(): void;
}

const ROLE_LABEL: Record<PreliminaryPhotoRole, string> = {
  front_of_home: 'Front of home',
  roof_overview: 'Roof overview',
  damage_closeup: 'Damage close-up',
  damage_closeup_roof: 'Roof damage close-up',
  damage_closeup_siding: 'Siding damage close-up',
  damage_closeup_collateral: 'Collateral damage close-up',
};

// Fixed, presentation order for the Phase 1 slots.
const ROLE_ORDER: PreliminaryPhotoRole[] = [
  'front_of_home',
  'roof_overview',
  'damage_closeup',
  'damage_closeup_roof',
  'damage_closeup_siding',
  'damage_closeup_collateral',
];

const NEXT_STEPS: Array<{ title: string; detail: string }> = [
  { title: 'File a claim', detail: 'Open a claim with your carrier for the storm date noted.' },
  { title: 'Pay for a forensic inspection', detail: 'Authorize the detailed forensic roof inspection.' },
  { title: 'Forensic inspection', detail: 'Full evidence capture of every slope and component.' },
  { title: 'Proof package', detail: 'Findings compiled into a documented, photo-backed report.' },
  { title: 'Claim negotiation', detail: 'The proof package supports the conversation with your carrier.' },
];

type InspectionPhoto = NonNullable<Inspection['photos']>[number];

interface ResolvedPhoto {
  role: PreliminaryPhotoRole;
  dataUri: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken('auth_session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Only ever attach the session Bearer token to URLs on our own API origin.
// Photo URLs come from inspection records (data-driven), so a poisoned absolute
// URL pointing at another host must NEVER receive the token — that would
// exfiltrate the credential. The trailing-slash boundary check prevents a
// look-alike host like "https://api.example.com.evil.com" from matching.
function isTrustedApiUrl(url: string, apiBase: string): boolean {
  const base = apiBase.replace(/\/+$/, '');
  return url === base || url.startsWith(`${base}/`);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// Reads any image URI — a local file:// (proven pattern from lib/upload.ts) or a
// server object URL (which requires the Bearer token) — into a base64 data URI
// so it can be embedded directly in the PDF HTML. Returns null on any failure so
// one unreachable photo never sinks the whole report.
async function imageToDataUri(uri: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(uri, headers ? { headers } : undefined);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await compressForReport(await blobToDataUri(blob));
  } catch {
    return null;
  }
}

// expo-file-system v19 File methods aren't on the exported type; see
// UsableFile above. NOTE: the native `write` accepts exactly ONE argument
// (string or bytes) — passing an options object throws InvalidArgsNumber,
// so binary payloads must be pre-decoded to a Uint8Array.
interface WritableFile extends UsableFile {
  write(content: string | Uint8Array): void;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Downscale + recompress a photo before it's embedded in the report. Evidence
// photos are full-resolution camera captures (8-12MB each); embedding them
// verbatim produces a PDF so large that the iOS Mail compose extension (which
// runs under a strict memory cap) is killed by the OS seconds after the user
// picks Email from the share sheet — the "share sheet keeps closing" bug.
// ~1280px JPEG is plenty for an emailed summary.
//
// The manipulator is fed a real temp FILE, not the base64 data URI — data-URI
// input silently fails on some platforms, which made the earlier version fall
// back to the uncompressed original (and Mail kept dying). Failures are now
// logged instead of swallowed silently, but still fall back to the original
// so one bad photo never sinks the report.
async function compressForReport(dataUri: string): Promise<string> {
  const comma = dataUri.indexOf(',');
  const srcBase64 = comma >= 0 ? dataUri.slice(comma + 1) : '';
  if (!srcBase64) return dataUri;
  let tmp: WritableFile | null = null;
  try {
    tmp = new File(
      Paths.cache,
      `report-src-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    ) as unknown as WritableFile;
    tmp.write(base64ToBytes(srcBase64));
    const result = await ImageManipulator.manipulateAsync(
      tmp.uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (result.base64) {
      console.log(
        `[report] photo compressed ${Math.round(srcBase64.length / 1024)}KB -> ${Math.round(result.base64.length / 1024)}KB`,
      );
      return `data:image/jpeg;base64,${result.base64}`;
    }
    console.warn('[report] compress returned no base64; using original');
  } catch (err) {
    console.warn('[report] compress failed; using original', err);
  } finally {
    try {
      if (tmp?.exists) tmp.delete();
    } catch {}
  }
  return dataUri;
}

// Resolves the Phase 1 evidence photos to embeddable data URIs. A photo still
// pending in the outbox is read from its durable local copy; a synced photo is
// fetched from object storage with auth. Local-first means the report works
// offline for freshly-captured photos, before they have uploaded.
async function resolvePreliminaryPhotos(inspection: Inspection): Promise<ResolvedPhoto[]> {
  const photos = (inspection.photos ?? []).filter(
    (p): p is InspectionPhoto & { preliminaryRole: PreliminaryPhotoRole } => !!p.preliminaryRole,
  );

  // Map still-unsynced photo ids -> their durable local file path. `done` items
  // are excluded (listSyncableOutboxItems), because the local copy is deleted
  // once a photo uploads — for those we fall back to the server URL.
  const pendingLocalPaths = new Map<string, string>();
  try {
    for (const item of await listSyncableOutboxItems()) {
      if (item.kind !== 'inspection.photo') continue;
      try {
        const payload = JSON.parse(item.payload) as InspectionPhotoOutboxPayload;
        if (payload.inspectionId === inspection.id && payload.localFilePath) {
          pendingLocalPaths.set(payload.id, payload.localFilePath);
        }
      } catch {
        // Ignore an unparseable outbox row — it just won't contribute a local path.
      }
    }
  } catch {
    // No outbox access — synced photos still resolve via their URL below.
  }

  const apiBase = getApiBaseUrl();
  const headers = await authHeaders();
  const resolved: ResolvedPhoto[] = [];
  // Preserve slot order (front, roof, then close-ups) for a predictable layout.
  const ordered = [...photos].sort(
    (a, b) => ROLE_ORDER.indexOf(a.preliminaryRole) - ROLE_ORDER.indexOf(b.preliminaryRole),
  );
  for (const photo of ordered) {
    const localPath = pendingLocalPaths.get(photo.id);
    let dataUri: string | null = null;
    if (localPath) dataUri = await imageToDataUri(localPath);
    if (!dataUri && photo.url) {
      // Attach the Bearer token only for our own API origin; never for an
      // untrusted host that a poisoned record URL might point at.
      const useAuth = isTrustedApiUrl(photo.url, apiBase);
      dataUri = await imageToDataUri(photo.url, useAuth ? headers : undefined);
    }
    if (dataUri) resolved.push({ role: photo.preliminaryRole, dataUri });
  }
  return resolved;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Title-case each word ("hail" -> "Hail", "wind and hail" -> "Wind and Hail"),
// leaving connector words like "and"/"&" lowercase.
function titleCaseType(value: string): string {
  return value
    .split(' ')
    .map((w) => (w === 'and' || w === '&' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// Formats "HH:MM" (24h) as a friendly "11:47 PM"-style time.
function formatTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  if (h > 23) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

function damageLabel(inspection: Inspection): string {
  return inspection.damageType
    ? DAMAGE_TYPE_LABEL[inspection.damageType] ??
        titleCaseType(inspection.damageType.replace(/_/g, ' '))
    : 'Storm-related damage';
}

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

  const weatherValue = storm ? esc(titleCaseType(storm.type)) : 'Not yet matched';
  const stormWhen = storm
    ? esc(storm.date) + (storm.time ? ` at ${esc(formatTime(storm.time))}` : '')
    : '';
  const weatherSub = storm
    ? stormWhen + (storm.description ? ` &mdash; ${esc(storm.description)}` : '')
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

  // Size the photo frames to fill the remaining space of a single Letter page.
  // Non-photo content (header, findings, facts, labels, next steps, disclaimer)
  // occupies roughly 4.6in of the 10in printable height (0.5in margins); split
  // the rest across the photo rows, minus caption + gap overhead per row.
  const photoRows = Math.max(1, Math.ceil(photos.length / 2));
  const photoImgHeightIn = Math.min(
    3.4,
    Math.max(1.55, (10 - 4.6) / photoRows - 0.35),
  ).toFixed(2);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  @page { size: Letter; margin: 0.5in; }
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
  /* contain, not cover: evidence photos must never be cropped — letterbox
     within a fixed frame so the grid stays aligned but the full frame shows.
     Frame height is computed per-report so the photos fill the page. */
  figure.photo img { width: 100%; height: ${photoImgHeightIn}in; object-fit: contain; background: #f7fafc; display: block; }
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

// Copies the print output to a stable, human-readable filename so the shared
// attachment and downloaded file read as "RoofTrax-Preliminary-Report-...pdf".
// Falls back to the raw print URI if the copy fails for any reason.
function toFriendlyPdf(printUri: string, inspection: Inspection): string {
  try {
    const slug =
      (inspection.address ?? 'property')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'property';
    const dest = new File(Paths.cache, `RoofTrax-Preliminary-Report-${slug}.pdf`) as unknown as UsableFile;
    if (dest.exists) dest.delete();
    (new File(printUri) as unknown as UsableFile).copy(dest);
    return dest.uri;
  } catch {
    return printUri;
  }
}

export interface HomeownerReport {
  /** Local file:// URI of the generated PDF (what gets shared). */
  pdfUri: string;
  /** The exact HTML the PDF was rendered from (photos embedded as data URIs) —
   * used for the in-app "View report" screen, since Android WebViews can't
   * render a local PDF directly. Content is identical to the PDF. */
  html: string;
}

/** Builds the homeowner PDF and returns its file URI plus the source HTML. */
export async function generateHomeownerReport(inspection: Inspection): Promise<HomeownerReport> {
  const photos = await resolvePreliminaryPhotos(inspection);
  const html = buildReportHtml(inspection, photos);
  const { uri } = await Print.printToFileAsync({ html });
  return { pdfUri: toFriendlyPdf(uri, inspection), html };
}

/**
 * Opens the OS share sheet for the generated report — Mail/email, Messages,
 * AirDrop, or Save to Files. This is how the report leaves the device.
 */
export async function shareHomeownerReport(pdfUri: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Homeowner report',
    });
  }
}
