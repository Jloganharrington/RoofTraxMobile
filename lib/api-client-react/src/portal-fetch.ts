/**
 * Portal fetch mutator — identical to customFetch but strips the /api prefix
 * from the URL so portal endpoints (which live at /portal/..., not /api/portal/...)
 * are called at the correct path.
 */
import { customFetch } from './custom-fetch';

export const portalFetch = <T>(url: string, options?: RequestInit): Promise<T> => {
  // orval constructs the URL as "/api/portal/..." (because baseUrl is /api in the spec).
  // Strip the /api prefix so the request goes to the correct /portal/... path.
  const fixedUrl = url.startsWith('/api/portal/') ? url.slice('/api'.length) : url;
  return customFetch<T>(fixedUrl, options);
};
