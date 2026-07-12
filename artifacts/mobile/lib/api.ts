import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { getToken } from './tokenStorage';

// The generated client's request paths already include the `/api` prefix
// baked in from `servers: - url: /api` in lib/api-spec/openapi.yaml (e.g.
// getListPinsUrl() returns "/api/pins"), so the base URL here must be the
// bare domain — adding "/api" again would double it to "/api/api/...".
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

setAuthTokenGetter(() => getToken('auth_session_token'));

export function getApiBaseUrl(): string {
  return domain ? `https://${domain}/api` : '';
}
