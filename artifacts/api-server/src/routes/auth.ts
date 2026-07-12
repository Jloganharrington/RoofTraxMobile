import {
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  GetCurrentAuthUserResponse,
  LogoutMobileSessionResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import * as oidc from 'openid-client';

import {
  clearSession,
  createSession,
  deleteSession,
  getOidcConfig,
  getSessionId,
  ISSUER_URL,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from '../lib/auth';
import {
  CompanyNotFoundError,
  MissingCompanyError,
  upsertUserOnLogin,
  type Claims,
} from '../lib/onboarding';

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host =
    req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost';
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getAllowedMobileWebOrigins(): string[] {
  const origins = new Set<string>();
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  }
  return Array.from(origins);
}

function getSafeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return '/';
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorStatus(
  value: Record<string, unknown>,
): number | string | undefined {
  if (typeof value.status === 'number' || typeof value.status === 'string') {
    return value.status;
  }
  if (
    typeof value.statusCode === 'number' ||
    typeof value.statusCode === 'string'
  ) {
    return value.statusCode;
  }
  return undefined;
}

function getSafeErrorMetadata(error: unknown) {
  if (!isRecord(error)) {
    return { errorName: typeof error };
  }

  const errorStatus = getErrorStatus(error);
  const causeStatus = isRecord(error.cause)
    ? getErrorStatus(error.cause)
    : undefined;

  return {
    errorName: error instanceof Error ? error.name : 'Error',
    errorStatus: errorStatus ?? causeStatus,
  };
}

router.get('/auth/user', (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get('/login', async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: 'openid email profile offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login consent',
    state,
    nonce,
  });

  setOidcCookie(res, 'code_verifier', codeVerifier);
  setOidcCookie(res, 'nonce', nonce);
  setOidcCookie(res, 'state', state);
  setOidcCookie(res, 'return_to', returnTo);
  setOidcCookie(res, 'company_id', companyId);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get('/callback', async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect('/api/login');
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect('/api/login');
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);
  const companyId = req.cookies?.company_id as string | undefined;

  res.clearCookie('code_verifier', { path: '/' });
  res.clearCookie('nonce', { path: '/' });
  res.clearCookie('state', { path: '/' });
  res.clearCookie('return_to', { path: '/' });
  res.clearCookie('company_id', { path: '/' });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect('/api/login');
    return;
  }

  let dbUser;
  try {
    dbUser = await upsertUserOnLogin(claims as unknown as Claims, companyId);
  } catch (err) {
    if (err instanceof MissingCompanyError) {
      res.redirect('/?authError=missing_company');
      return;
    }
    if (err instanceof CompanyNotFoundError) {
      res.redirect('/?authError=company_not_found');
      return;
    }
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      companyId: dbUser.companyId,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get('/logout', async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);
  const returnTo = getSafeReturnTo(req.query.returnTo);
  const postLogoutRedirectUrl = new URL(returnTo, `${origin}/`).href;

  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: postLogoutRedirectUrl,
  });

  res.redirect(endSessionUrl.href);
});

// Web build of the Expo app runs on a preview domain
// ($REPLIT_EXPO_DEV_DOMAIN) that is not a trusted OIDC redirect target for
// this app's client. These two routes perform the OIDC code exchange
// server-side against this server's own trusted domain, then relay the
// resulting session token back to the Expo web page via postMessage.
router.get('/mobile-auth/web-login', async (req: Request, res: Response) => {
  const allowedOrigins = getAllowedMobileWebOrigins();
  const origin =
    typeof req.query.origin === 'string' ? req.query.origin : '';
  const companyId =
    typeof req.query.companyId === 'string' ? req.query.companyId : '';

  if (!allowedOrigins.includes(origin)) {
    res.status(400).send('Invalid origin');
    return;
  }

  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/mobile-auth/web-callback`;

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: 'openid email profile offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login consent',
    state,
    nonce,
  });

  setOidcCookie(res, 'mw_code_verifier', codeVerifier);
  setOidcCookie(res, 'mw_nonce', nonce);
  setOidcCookie(res, 'mw_state', state);
  setOidcCookie(res, 'mw_origin', origin);
  setOidcCookie(res, 'mw_company_id', companyId);

  res.redirect(redirectTo.href);
});

function renderMobileWebRelay(
  res: Response,
  origin: string,
  payload: Record<string, unknown>,
) {
  const json = JSON.stringify(payload);
  const safeOrigin = JSON.stringify(origin);
  res.set('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<body>
<script>
  (function () {
    var payload = ${json};
    var origin = ${safeOrigin};
    if (window.opener) {
      window.opener.postMessage(payload, origin);
    }
    window.close();
  })();
</script>
</body>
</html>`);
}

router.get(
  '/mobile-auth/web-callback',
  async (req: Request, res: Response) => {
    const allowedOrigins = getAllowedMobileWebOrigins();
    const origin = req.cookies?.mw_origin;
    const codeVerifier = req.cookies?.mw_code_verifier;
    const nonce = req.cookies?.mw_nonce;
    const expectedState = req.cookies?.mw_state;
    const companyId = req.cookies?.mw_company_id as string | undefined;

    res.clearCookie('mw_code_verifier', { path: '/' });
    res.clearCookie('mw_nonce', { path: '/' });
    res.clearCookie('mw_state', { path: '/' });
    res.clearCookie('mw_origin', { path: '/' });
    res.clearCookie('mw_company_id', { path: '/' });

    if (!allowedOrigins.includes(origin)) {
      res.status(400).send('Invalid origin');
      return;
    }

    if (!codeVerifier || !expectedState) {
      renderMobileWebRelay(res, origin, {
        type: 'mobile-auth-error',
        error: 'missing_session',
      });
      return;
    }

    const config = await getOidcConfig();
    const callbackUrl = new URL(
      `${getOrigin(req)}/api/mobile-auth/web-callback?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
    );

    try {
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedNonce: nonce,
        expectedState,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        renderMobileWebRelay(res, origin, {
          type: 'mobile-auth-error',
          error: 'no_claims',
        });
        return;
      }

      let dbUser;
      try {
        dbUser = await upsertUserOnLogin(claims as unknown as Claims, companyId);
      } catch (err) {
        if (err instanceof MissingCompanyError) {
          renderMobileWebRelay(res, origin, {
            type: 'mobile-auth-error',
            error: 'missing_company',
          });
          return;
        }
        if (err instanceof CompanyNotFoundError) {
          renderMobileWebRelay(res, origin, {
            type: 'mobile-auth-error',
            error: 'company_not_found',
          });
          return;
        }
        throw err;
      }

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          companyId: dbUser.companyId,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      renderMobileWebRelay(res, origin, {
        type: 'mobile-auth-success',
        token: sid,
      });
    } catch (err) {
      req.log.error(
        getSafeErrorMetadata(err),
        'Mobile web token exchange error',
      );
      renderMobileWebRelay(res, origin, {
        type: 'mobile-auth-error',
        error: 'exchange_failed',
      });
    }
  },
);

router.post(
  '/mobile-auth/token-exchange',
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required parameters' });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce, companyId } =
      parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      callbackUrl.searchParams.set('iss', ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: 'No claims in ID token' });
        return;
      }

      let dbUser;
      try {
        dbUser = await upsertUserOnLogin(claims as unknown as Claims, companyId);
      } catch (err) {
        if (err instanceof MissingCompanyError) {
          res.status(400).json({ error: 'A companyId is required for new accounts' });
          return;
        }
        if (err instanceof CompanyNotFoundError) {
          res.status(400).json({ error: 'Unknown companyId' });
          return;
        }
        throw err;
      }

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          companyId: dbUser.companyId,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error(getSafeErrorMetadata(err), 'Mobile token exchange error');
      res.status(500).json({ error: 'Token exchange failed' });
    }
  },
);

router.post('/mobile-auth/logout', async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

export default router;
