---
name: Expo web login fails against Replit OIDC (invalid_grant)
description: Why Replit Auth login works on native/Expo Go but fails with invalid_grant on the Expo web preview, and how to fix it.
---

Replit's OIDC provider only trusts redirect URIs on the repl's standard domain(s) listed in `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN`. The Expo web preview runs on a different domain, `REPLIT_EXPO_DEV_DOMAIN` (the "expo." subdomain), which is NOT in that trusted list. A PKCE flow that uses `AuthSession.makeRedirectUri()` on web computes a redirect_uri on the expo domain — the authorize step succeeds, but the token exchange then fails with a 400 `invalid_grant` even though client and server agree on the same redirect_uri. Native (`exp://...`) is unaffected since it uses a custom scheme, not this domain.

**Why:** confirmed by comparing `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN` (trusted) vs `REPLIT_EXPO_DEV_DOMAIN` (not trusted) env values directly — no official doc covers this redirect_uri allowlisting behavior.

**How to apply:** for Expo apps that need web login against Replit Auth, don't send the browser's own (expo-domain) origin as the OIDC redirect_uri. Instead, do the code exchange server-side against the API server's own trusted domain: open a popup to a dedicated `.../web-login` endpoint that starts the OIDC flow with `redirect_uri = <api-server's own trusted domain>/.../web-callback`; that callback exchanges the code, creates a session, and relays the result back to the opener via `postMessage` (validate the target origin against an allowlist derived from `REPLIT_DEV_DOMAIN`/`REPLIT_EXPO_DEV_DOMAIN`) instead of relying on `expo-web-browser`'s built-in same-origin auto-complete relay, which assumes the redirect lands back on the same origin that opened it.
