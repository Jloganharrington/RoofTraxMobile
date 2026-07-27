import { getApiBaseUrl } from './api';
import { getToken } from './tokenStorage';

export class UploadError extends Error {
  status: number;
  /** 'api' = our API rejected the request; 'storage' = the presigned PUT failed. */
  source: 'api' | 'storage';
  constructor(message: string, status: number, source: 'api' | 'storage') {
    super(message);
    this.status = status;
    this.source = source;
  }
}

interface RequestUploadUrlResult {
  uploadURL: string;
  objectPath: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken('auth_session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Uploads a local file (by URI) to object storage:
 * 1. Requests a presigned URL from the server.
 * 2. PUTs the file bytes directly to that URL.
 * 3. Returns a servable URL under `/storage/objects/*` for use as `photoUrl`.
 */
export async function uploadFile(
  localUri: string,
  contentType: string,
): Promise<string> {
  const apiBase = getApiBaseUrl();

  const fileResponse = await fetch(localUri);
  const blob = await fileResponse.blob();

  const requestRes = await fetch(`${apiBase}/storage/uploads/request-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ name: localUri.split('/').pop(), size: blob.size, contentType }),
  });

  if (!requestRes.ok) {
    throw new UploadError(
      `Failed to request upload URL: ${requestRes.status}`,
      requestRes.status,
      'api',
    );
  }

  const { uploadURL, objectPath }: RequestUploadUrlResult = await requestRes.json();

  const putRes = await fetch(uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });

  if (!putRes.ok) {
    throw new UploadError(
      `Failed to upload file: ${putRes.status}`,
      putRes.status,
      'storage',
    );
  }

  // objectPath is already in /objects/{id} format — return it directly so the
  // DB stores the canonical path the photo proxy can resolve. Do NOT rebuild
  // a full HTTPS URL here; getObjectEntityFile expects /objects/... and the
  // proxy would throw ObjectNotFoundError on every photo if given a full URL.
  return objectPath;
}
