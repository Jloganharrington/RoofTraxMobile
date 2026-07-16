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
};

// Fixed, presentation order for the four Phase 1 slots.
const ROLE_ORDER: PreliminaryPhotoRole[] = ['front_of_home', 'roof_overview', 'damage_closeup'];

const NEXT_STEPS: Array<{ title: string; detail: string }> = [
  { title: 'File a claim', detail: 'Open a claim with your insurance carrier for the storm date noted above.' },
  { title: 'Pay for a forensic inspection', detail: 'Authorize the detailed, documented forensic roof inspection.' },
  { title: 'Forensic inspection', detail: 'A full evidence capture of every slope, elevation, and damaged component.' },
  { title: 'Proof package', detail: 'The findings are compiled into a documented, photo-backed report.' },
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
    return await blobToDataUri(blob);
  } catch {
    return null;
  }
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

function damageLabel(inspection: Inspection): string {
  return inspection.damageType
    ? DAMAGE_TYPE_LABEL[inspection.damageType] ?? inspection.damageType
    : 'Storm-related damage';
}

function homeownerFactRows(inspection: Inspection): string {
  const facts = inspection.homeownerFacts;
  if (!facts) return '';
  const awareness =
    facts.awareOfDateOfLoss === true ? 'Yes' : facts.awareOfDateOfLoss === false ? 'No' : 'Unsure';
  const rows: string[] = [`<tr><td>Aware of the date of loss</td><td>${esc(awareness)}</td></tr>`];
  if (facts.priorRepairs) {
    rows.push(`<tr><td>Prior repairs reported</td><td>${esc(facts.priorRepairs)}</td></tr>`);
  }
  if (facts.priorClaims) {
    rows.push(`<tr><td>Prior claims reported</td><td>${esc(facts.priorClaims)}</td></tr>`);
  }
  return `
    <h2>Homeowner-reported facts</h2>
    <table class="facts">${rows.join('')}</table>`;
}

function buildReportHtml(inspection: Inspection, photos: ResolvedPhoto[]): string {
  const generatedOn = formatDate(new Date().toISOString());
  const storm = inspection.stormConfirmedRef;

  const photoCards = photos
    .map(
      (p) => `
        <figure class="photo">
          <img src="${p.dataUri}" />
          <figcaption>${esc(ROLE_LABEL[p.role])}</figcaption>
        </figure>`,
    )
    .join('');

  const stormBlock = storm
    ? `<p><strong>${esc(storm.type)}</strong> · ${esc(storm.date)}</p>${
        storm.description ? `<p class="muted">${esc(storm.description)}</p>` : ''
      }`
    : `<p class="muted">A severe-weather event has not been matched yet.</p>`;

  const nextSteps = NEXT_STEPS.map(
    (s, i) =>
      `<li><span class="step-n">${i + 1}</span><div><strong>${esc(s.title)}</strong><br/><span class="muted">${esc(
        s.detail,
      )}</span></div></li>`,
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a202c; margin: 0; padding: 0 32px 40px; }
  .header { background: #0f2942; color: #fff; margin: 0 -32px 24px; padding: 28px 32px; }
  .eyebrow { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #9fb3c8; margin: 0 0 6px; }
  .header h1 { font-size: 22px; margin: 0 0 6px; }
  .header .addr { font-size: 15px; color: #cbd5e0; margin: 0; }
  .header .gen { font-size: 12px; color: #7c93a8; margin: 10px 0 0; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; color: #4a5568; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 28px 0 12px; }
  .muted { color: #718096; }
  .lead { font-size: 15px; font-weight: 600; margin: 4px 0; }
  table.facts { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.facts td { padding: 8px 10px; border-bottom: 1px solid #edf2f7; vertical-align: top; }
  table.facts td:first-child { color: #718096; width: 42%; }
  .photos { display: flex; flex-wrap: wrap; gap: 14px; }
  figure.photo { width: calc(50% - 7px); margin: 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  figure.photo img { width: 100%; height: 200px; object-fit: cover; display: block; }
  figure.photo figcaption { font-size: 12px; font-weight: 600; color: #4a5568; padding: 8px 10px; background: #f7fafc; }
  ol.steps { list-style: none; padding: 0; margin: 0; }
  ol.steps li { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; font-size: 13px; }
  .step-n { flex: 0 0 24px; height: 24px; border-radius: 12px; background: #0f2942; color: #fff; font-weight: 700; text-align: center; line-height: 24px; font-size: 12px; }
  .disclaimer { margin-top: 30px; padding: 14px 16px; background: #f7fafc; border-radius: 8px; font-size: 11px; color: #718096; line-height: 1.5; }
</style>
</head>
<body>
  <div class="header">
    <p class="eyebrow">Preliminary Roof Inspection Summary</p>
    <h1>${esc(inspection.address ?? 'Your property')}</h1>
    <p class="addr">A summary of what was found and what comes next.</p>
    <p class="gen">Prepared ${esc(generatedOn)}</p>
  </div>

  <h2>Damage found</h2>
  <p class="lead">${esc(damageLabel(inspection))}</p>
  <p class="muted">Observed during the preliminary roof review.</p>

  <h2>Weather event</h2>
  ${stormBlock}

  ${homeownerFactRows(inspection)}

  ${
    photos.length
      ? `<h2>Photos (${photos.length})</h2><div class="photos">${photoCards}</div>`
      : `<h2>Photos</h2><p class="muted">No preliminary photos are attached to this report.</p>`
  }

  <h2>Next steps</h2>
  <ol class="steps">${nextSteps}</ol>

  <div class="disclaimer">
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

/** Builds the homeowner PDF and returns a local file:// URI to it. */
export async function generateHomeownerReportPdf(inspection: Inspection): Promise<string> {
  const photos = await resolvePreliminaryPhotos(inspection);
  const html = buildReportHtml(inspection, photos);
  const { uri } = await Print.printToFileAsync({ html });
  return toFriendlyPdf(uri, inspection);
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
