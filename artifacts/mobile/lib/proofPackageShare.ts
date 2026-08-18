import * as MailComposer from 'expo-mail-composer';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { getApiBaseUrl } from './api';
import { getToken } from './tokenStorage';

// Compiled Proof Package sharing: the server renders the package as HTML with
// fresh short-lived signed photo URLs (GET /report/preview-url); the device
// turns that HTML into a PDF via expo-print, then shares it through the OS
// share sheet, the in-app mail composer, or the rep's server-side SMTP.
//
// The PDF must be generated at share time — the photo URLs inside the HTML
// expire in ~15 minutes, so a cached PDF (already rasterized) is fine, but
// cached HTML is not. We always fetch fresh HTML per action to keep it simple.

// expo-file-system v19: File instance methods aren't on the exported type.
interface UsableFile {
  readonly uri: string;
  exists: boolean;
  copy(destination: UsableFile): void;
  delete(): void;
}

export class ReportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportBlockedError';
  }
}

/** Fetch the rendered Proof Package HTML (throws ReportBlockedError on a lint block). */
export async function fetchProofPackageHtml(inspectionId: string): Promise<string> {
  const token = await getToken('auth_session_token');
  const res = await fetch(`${getApiBaseUrl()}/inspections/${inspectionId}/report/preview-url`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ReportBlockedError(
      body.error ?? 'Export is blocked until the report content is resolved.',
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server returned ${res.status}`);
  }
  const body = (await res.json()) as { html?: string };
  if (!body.html) throw new Error('The report came back empty. Try re-compiling.');
  return body.html;
}

/** Render the Proof Package HTML to a local PDF with a friendly filename. */
export async function generateProofPackagePdf(
  html: string,
  address: string | null | undefined,
): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html });
  try {
    const slug =
      (address ?? 'property')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'property';
    const dest = new File(Paths.cache, `AxiomRestore-Proof-Package-${slug}.pdf`) as unknown as UsableFile;
    if (dest.exists) dest.delete();
    (new File(uri) as unknown as UsableFile).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/** OS share sheet — Save to Files, AirDrop, Mail, Messages, etc. */
export async function shareProofPackagePdf(pdfUri: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(pdfUri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Proof Package',
  });
  return true;
}

/** Reads the generated PDF back as base64, for server-side (SMTP) emailing. */
export async function readProofPackagePdfBase64(pdfUri: string): Promise<string> {
  const file = new File(pdfUri) as unknown as { base64(): Promise<string> };
  return file.base64();
}

/**
 * In-app mail composer fallback (no SMTP configured). Returns false when no
 * mail account is set up on the device.
 */
export async function composeProofPackageEmail(
  pdfUri: string,
  address: string | null | undefined,
  recipient?: string,
): Promise<boolean> {
  if (!(await MailComposer.isAvailableAsync())) return false;
  await MailComposer.composeAsync({
    ...(recipient ? { recipients: [recipient] } : {}),
    subject: `Forensic Inspection Report & Proof Package — ${address ?? 'your property'}`,
    body: 'Attached is the Forensic Inspection Report & Proof Package for your property.',
    attachments: [pdfUri],
  });
  return true;
}
