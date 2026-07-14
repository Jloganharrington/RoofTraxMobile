import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { sha256OfFile } from './inspectionPhoto';
import { uploadFile } from './upload';

// M-F (F0) — Signature-on-file. The inspector captures their signature once on
// their profile; it is uploaded to object storage (tenant-scoped by the same
// ownership record every other upload gets) and referenced by URL + SHA-256 on
// the profile. Individual inspection declarations then apply this on-file
// signature by reference instead of drawing a fresh one each time.

// expo-file-system@19's File type omits its own instance methods (see the note
// in inspectionPhoto.ts). Cast to the subset we use here.
interface WritableFile {
  readonly uri: string;
  create(options?: { intermediates?: boolean; overwrite?: boolean }): void;
  write(content: string | Uint8Array): void;
}
interface UsableDirectory {
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
}

function base64ToBytes(base64: string): Uint8Array {
  // Expo provides a global atob in the JS runtime.
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface SavedSignature {
  signatureUrl: string;
  signatureSha256: string;
}

/**
 * Persists a captured signature (a base64 PNG data URL from the signature pad)
 * to object storage and returns the servable URL plus a SHA-256 of the exact
 * bytes uploaded. The caller then PATCHes /profile/signature with these. Unlike
 * the offline-first capture writes, this requires connectivity (it uploads an
 * image), which is fine: signatures are captured at onboarding, not in the field.
 */
export async function saveSignatureFromDataUrl(dataUrl: string): Promise<SavedSignature> {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const bytes = base64ToBytes(base64);

  const dir = new Directory(Paths.document, 'signatures');
  (dir as unknown as UsableDirectory).create({ intermediates: true, idempotent: true });

  const file = new File(dir, `${Crypto.randomUUID()}.png`) as unknown as WritableFile;
  file.create({ intermediates: true, overwrite: true });
  file.write(bytes);

  const signatureSha256 = await sha256OfFile(file.uri);
  const signatureUrl = await uploadFile(file.uri, 'image/png');

  return { signatureUrl, signatureSha256 };
}
