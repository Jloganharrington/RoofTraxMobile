import * as SecureStore from 'expo-secure-store';
import { getApiBaseUrl } from './api';

interface RequestUploadUrlResult {
  uploadURL: string;
  objectPath: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await SecureStore.getItemAsync('auth_session_token');
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
    throw new Error(`Failed to request upload URL: ${requestRes.status}`);
  }

  const { uploadURL, objectPath }: RequestUploadUrlResult = await requestRes.json();

  const putRes = await fetch(uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });

  if (!putRes.ok) {
    throw new Error(`Failed to upload file: ${putRes.status}`);
  }

  const objectId = objectPath.replace(/^\/objects\//, '');
  return `${apiBase}/storage/objects/${objectId}`;
}
