import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

// expo-file-system@19's `File`/`Directory` classes extend a native-module
// property typed as `typeof File`/`typeof Directory` (see
// ExpoFileSystem.d.ts), which TypeScript does not treat as inheriting
// instance members — every documented instance method (bytes/copy/create/
// uri/etc.) is consequently missing from the exported class's own type,
// even though it exists at runtime. This local interface documents the
// subset this module relies on and casts around the upstream declaration
// gap rather than fighting it file-by-file.
interface UsableFile {
  readonly uri: string;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  copy(destination: UsableFile | UsableDirectory): void;
  exists: boolean;
  delete(): void;
}
interface UsableDirectory {
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
}
function asFile(file: File): UsableFile {
  return file as unknown as UsableFile;
}
function asDirectory(dir: Directory): UsableDirectory {
  return dir as unknown as UsableDirectory;
}

export type TriadRole = 'wide' | 'mid' | 'close';

/** A single free-form annotation dropped on top of the photo preview. Kept
 * as normalized (0-1) coordinates so it survives independent of the
 * original image's pixel dimensions, and stored as overlay metadata only —
 * never burned into the uploaded image bytes, so the original photo stays
 * forensically unmodified. */
export interface PhotoAnnotation {
  x: number;
  y: number;
  note: string;
}

export interface CapturedEvidencePhoto {
  localUri: string;
  triadRole: TriadRole;
  mimeType: string;
  /** Raw EXIF tags reported by the camera, if any (make/model/orientation/etc). */
  exif: Record<string, unknown> | null;
  /** Best-known UTC capture timestamp: EXIF DateTimeOriginal if present, else capture-moment device clock. */
  capturedAtUtc: string;
  /** Best-known capture location: EXIF GPS tags if present, else a live one-shot GPS fix. */
  latitude: number | null;
  longitude: number | null;
  annotations: PhotoAnnotation[];
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes the exact bytes of a local file with SHA-256, so the resulting
 * digest matches whatever bytes end up in object storage.
 */
export async function sha256OfFile(localUri: string): Promise<string> {
  const bytes = await asFile(new File(localUri)).bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return bytesToHex(digest);
}

function parseExifGps(exif: Record<string, unknown>): { latitude: number | null; longitude: number | null } {
  const lat = exif.GPSLatitude;
  const lon = exif.GPSLongitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { latitude: null, longitude: null };
  }
  const latRef = exif.GPSLatitudeRef;
  const lonRef = exif.GPSLongitudeRef;
  const signedLat = latRef === 'S' ? -lat : lat;
  const signedLon = lonRef === 'W' ? -lon : lon;
  return { latitude: signedLat, longitude: signedLon };
}

function parseExifDateTimeUtc(exif: Record<string, unknown>): string | null {
  // EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS" in local camera time with
  // no timezone offset recorded on most devices, so treat it as the best
  // available capture moment rather than claiming a precise UTC instant.
  const raw = exif.DateTimeOriginal ?? exif.DateTime;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Launches the camera for one triad role (wide / mid / close), then derives
 * capture metadata: EXIF (if the device/OS reports it), a best-effort
 * capture timestamp, and a best-effort GPS fix (EXIF GPS tags first, a live
 * one-shot location read as fallback). Returns null if the user cancels.
 */
export async function captureEvidencePhoto(triadRole: TriadRole): Promise<CapturedEvidencePhoto | null> {
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    mediaTypes: ['images'],
    exif: true,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const exif = (asset.exif as Record<string, unknown> | null | undefined) ?? null;

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (exif) {
    const gps = parseExifGps(exif);
    latitude = gps.latitude;
    longitude = gps.longitude;
  }
  if (latitude === null || longitude === null) {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const position = await Location.getCurrentPositionAsync({});
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      }
    } catch {
      // Best-effort only — a missing GPS fix does not block evidence capture.
    }
  }

  const capturedAtUtc = (exif && parseExifDateTimeUtc(exif)) ?? new Date().toISOString();

  return {
    localUri: asset.uri,
    triadRole,
    mimeType: asset.mimeType ?? 'image/jpeg',
    exif,
    capturedAtUtc,
    latitude,
    longitude,
    annotations: [],
  };
}

/**
 * Copies the captured photo out of the camera/picker's cache location into
 * this app's stable document storage, and hashes the exact bytes that get
 * copied. Both steps are local-only (no network), so they succeed offline
 * and the result is safe to hand to the outbox: the OS can reclaim
 * ImagePicker's cache at any time, but it will not touch our own document
 * directory, so the file is still there whenever connectivity returns —
 * including after the app restarts or the device sat in airplane mode.
 */
export async function persistCapturedPhotoForOutbox(photo: CapturedEvidencePhoto): Promise<{
  localFilePath: string;
  sha256: string;
  exifJson: Record<string, unknown> | null;
  overlayJson: Record<string, unknown> | null;
  capturedAtUtc: string;
  latitude: number | null;
  longitude: number | null;
}> {
  const outboxDir = new Directory(Paths.document, 'outbox-photos');
  asDirectory(outboxDir).create({ intermediates: true, idempotent: true });

  const extension = photo.localUri.split('.').pop() ?? 'jpg';
  const destination = new File(outboxDir, `${Crypto.randomUUID()}.${extension}`);
  asFile(new File(photo.localUri)).copy(asFile(destination));
  const localFilePath = asFile(destination).uri;

  const sha256 = await sha256OfFile(localFilePath);

  return {
    localFilePath,
    sha256,
    exifJson: photo.exif,
    overlayJson: photo.annotations.length > 0 ? { annotations: photo.annotations } : null,
    capturedAtUtc: photo.capturedAtUtc,
    latitude: photo.latitude,
    longitude: photo.longitude,
  };
}
