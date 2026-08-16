import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getToken, setToken, deleteToken } from './tokenStorage';
import { registerPushToken, deregisterPushToken } from './notifications';

WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = 'auth_session_token';
const ISSUER_URL =
  process.env.EXPO_PUBLIC_ISSUER_URL ?? 'https://replit.com/oidc';

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  companyId: string;
}

export type LoginError = 'missing_company' | 'company_not_found' | 'unknown';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  loginError: LoginError | null;
  // companyId is required the first time a person from a company signs in
  // (it founds/joins the company); returning users' companyId is fixed
  // server-side and this value is ignored for them.
  login: (companyId?: string) => Promise<void>;
  // PP email+password login — for companies with pp_tier === 'pp_only'.
  loginPP: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  ppLoginError: string | null;
  logout: () => Promise<void>;
  // Dev-only: store a pre-minted bearer token and hydrate the user. Used by
  // the __DEV__ role picker; never called in production builds.
  loginWithToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  loginError: null,
  login: async () => {},
  loginPP: async () => ({ ok: false }),
  ppLoginError: null,
  logout: async () => {},
  loginWithToken: async () => {},
});

function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return '';
}

function getClientId(): string {
  return process.env.EXPO_PUBLIC_REPL_ID || '';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const [ppLoginError, setPpLoginError] = useState<string | null>(null);
  const pendingCompanyId = useRef<string | undefined>(undefined);

  const discovery = AuthSession.useAutoDiscovery(ISSUER_URL);

  const redirectUri = AuthSession.makeRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: getClientId(),
      scopes: ['openid', 'email', 'profile', 'offline_access'],
      redirectUri,
      prompt: AuthSession.Prompt.Login,
    },
    discovery,
  );

  const fetchUser = useCallback(async () => {
    try {
      const token = await getToken(AUTH_TOKEN_KEY);
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.user) {
        setUser(data.user);
        // Fire-and-forget: only registers if permission is already granted.
        // Never blocks auth flow or throws.
        void registerPushToken();
      } else {
        await deleteToken(AUTH_TOKEN_KEY);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier) return;

    const { code, state } = response.params;

    (async () => {
      try {
        const apiBase = getApiBaseUrl();
        if (!apiBase) {
          console.error('API base URL is not configured.');
          return;
        }

        setLoginError(null);
        const exchangeRes = await fetch(
          `${apiBase}/api/mobile-auth/token-exchange`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              code_verifier: request.codeVerifier,
              redirect_uri: redirectUri,
              state,
              nonce: (request as unknown as { nonce?: string }).nonce,
              companyId: pendingCompanyId.current,
            }),
          },
        );

        if (!exchangeRes.ok) {
          const body = await exchangeRes.json().catch(() => null);
          console.error('Token exchange failed:', exchangeRes.status);
          setLoginError(
            body?.error === 'A companyId is required for new accounts'
              ? 'missing_company'
              : body?.error === 'Unknown companyId'
                ? 'company_not_found'
                : 'unknown',
          );
          setIsLoading(false);
          return;
        }

        const data = await exchangeRes.json();
        if (data.token) {
          await setToken(AUTH_TOKEN_KEY, data.token);
          setIsLoading(true);
          await fetchUser();
        }
      } catch (err) {
        console.error('Token exchange error:', err);
        setLoginError('unknown');
        setIsLoading(false);
      }
    })();
  }, [response, request, redirectUri, fetchUser]);

  const loginOnWeb = useCallback(async (companyId?: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || typeof window === 'undefined') {
      console.error('API base URL is not configured.');
      return;
    }

    const webOrigin = window.location.origin;
    const companyParam = companyId
      ? `&companyId=${encodeURIComponent(companyId)}`
      : '';
    const popup = window.open(
      `${apiBase}/api/mobile-auth/web-login?origin=${encodeURIComponent(webOrigin)}${companyParam}`,
      'roof-trax-login',
      'width=500,height=650',
    );

    if (!popup) {
      console.error('Login popup was blocked by the browser.');
      return;
    }

    await new Promise<void>((resolve) => {
      const apiOrigin = new URL(apiBase).origin;

      const cleanup = () => {
        window.removeEventListener('message', listener);
        clearInterval(interval);
      };

      const listener = async (event: MessageEvent) => {
        if (event.origin !== apiOrigin) return;
        const data = event.data as
          | { type?: string; token?: string; error?: string }
          | undefined;

        if (data?.type === 'mobile-auth-success' && data.token) {
          cleanup();
          setLoginError(null);
          await setToken(AUTH_TOKEN_KEY, data.token);
          setIsLoading(true);
          await fetchUser();
          resolve();
        } else if (data?.type === 'mobile-auth-error') {
          console.error('Login error:', data.error);
          setLoginError(
            data.error === 'missing_company'
              ? 'missing_company'
              : data.error === 'company_not_found'
                ? 'company_not_found'
                : 'unknown',
          );
          cleanup();
          resolve();
        }
      };

      const interval = setInterval(() => {
        if (popup.closed) {
          cleanup();
          resolve();
        }
      }, 500);

      window.addEventListener('message', listener);
    });
  }, [fetchUser]);

  const login = useCallback(
    async (companyId?: string) => {
      pendingCompanyId.current = companyId;
      try {
        if (Platform.OS === 'web') {
          await loginOnWeb(companyId);
          return;
        }
        await promptAsync();
      } catch (err) {
        console.error('Login error:', err);
        setLoginError('unknown');
      }
    },
    [promptAsync, loginOnWeb],
  );

  /**
   * PP email + password login for pp_only companies.
   * Calls POST /api/pp/login and stores the returned session token so it is
   * sent as Authorization: Bearer <token> on all subsequent API calls —
   * exactly the same mechanism used by the OIDC mobile flow.
   */
  const loginPP = useCallback(async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    setPpLoginError(null);
    setIsLoading(true);
    try {
      const apiBase = getApiBaseUrl();
      if (!apiBase) {
        const msg = 'API base URL is not configured.';
        setPpLoginError(msg);
        setIsLoading(false);
        return { ok: false, error: msg };
      }

      const res = await fetch(`${apiBase}/api/pp/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data?.error ?? 'Incorrect email or password.';
        setPpLoginError(msg);
        setIsLoading(false);
        return { ok: false, error: msg };
      }

      if (data?.token) {
        await setToken(AUTH_TOKEN_KEY, data.token);
        await fetchUser();
        return { ok: true };
      }

      const msg = 'Login failed. Please try again.';
      setPpLoginError(msg);
      setIsLoading(false);
      return { ok: false, error: msg };
    } catch (err) {
      console.error('PP login error:', err);
      const msg = 'Something went wrong. Please try again.';
      setPpLoginError(msg);
      setIsLoading(false);
      return { ok: false, error: msg };
    }
  }, [fetchUser]);

  const loginWithToken = useCallback(async (token: string) => {
    await setToken(AUTH_TOKEN_KEY, token);
    setIsLoading(true);
    await fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    try {
      const token = await getToken(AUTH_TOKEN_KEY);
      if (token) {
        const apiBase = getApiBaseUrl();
        // Fire push-token deregistration without awaiting — fetching the Expo
        // push token requires a network round-trip to Expo's servers which can
        // take several seconds. Best-effort cleanup: stale tokens simply fail to
        // deliver and are pruned on the next successful login.
        void deregisterPushToken();
        // Only await the fast session deletion (single DB row delete).
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    } catch {
    } finally {
      await deleteToken(AUTH_TOKEN_KEY);
      setUser(null);
      setPpLoginError(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        loginError,
        login,
        loginPP,
        ppLoginError,
        logout,
        loginWithToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
