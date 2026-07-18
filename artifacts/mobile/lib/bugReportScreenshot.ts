import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

// expo-file-system v19: the new File/Directory instance methods are untyped
// (see expo-file-system-v19-api-split memory) — same local-interface cast the
// photo path uses.
interface UsableFile {
  uri: string;
  copy(destination: UsableFile | UsableDirectory): void;
}
interface UsableDirectory {
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
}
const asFile = (f: File) => f as unknown as UsableFile;
const asDirectory = (d: Directory) => d as unknown as UsableDirectory;

/**
 * Copies a picked screenshot out of the image-picker cache into stable app
 * document storage so it survives until the outbox drains (the OS may evict
 * the picker cache at any time). Local-only — works fully offline.
 */
export async function persistScreenshotForOutbox(
  localUri: string,
): Promise<{ localFilePath: string; mimeType: string }> {
  const dir = new Directory(Paths.document, 'outbox-bug-screenshots');
  asDirectory(dir).create({ intermediates: true, idempotent: true });

  const extension = (localUri.split('.').pop() ?? 'jpg').toLowerCase();
  const destination = new File(dir, `${Crypto.randomUUID()}.${extension}`);
  asFile(new File(localUri)).copy(asFile(destination));

  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
  return { localFilePath: asFile(destination).uri, mimeType };
}
