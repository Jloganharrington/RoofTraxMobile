import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getCompany } from '@workspace/api-client-react';
import { getApiBaseUrl } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useAuth, type LoginError } from '@/lib/auth';

type Mode = 'choose' | 'join' | 'confirm' | 'pp-login' | 'pp-forgot';

const DEV_PERSONAS = [
  { key: 'canvasser-retail',    label: 'Canvasser – Retail' },
  { key: 'canvasser-insurance', label: 'Canvasser – Insurance' },
  { key: 'canvasser-both',      label: 'Canvasser – Both' },
  { key: 'field-rep',           label: 'Field Rep' },
  { key: 'manager',             label: 'Manager' },
  { key: 'admin',               label: 'Admin' },
  { key: 'super-admin',         label: 'Super Admin' },
] as const;

function errorMessage(error: LoginError | null): string | null {
  switch (error) {
    case 'missing_company':
      return 'Please join a company before signing in.';
    case 'company_not_found':
      return "That company ID doesn't exist. Double-check it and try again.";
    case 'unknown':
      return 'Something went wrong signing in. Please try again.';
    default:
      return null;
  }
}

// Shown before login — a brand-new user must join an existing company (by
// its short ID). Returning users never see this: their companyId is fixed
// at signup and untouched here.
export function CompanyGateScreen() {
  const colors = useColors();
  const { login, loginPP, loginWithToken, ppLoginError, isLoading, loginError } = useAuth();
  const [mode, setMode] = useState<Mode>('choose');
  const [companyCode, setCompanyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resolvedCompany, setResolvedCompany] = useState<{
    id: string;
    name: string;
    ppTier?: string;
  } | null>(null);

  // PP login form state
  const [ppEmail, setPpEmail] = useState('');
  const [ppPassword, setPpPassword] = useState('');
  // PP password-reset state
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Dev panel state (only active when __DEV__)
  const [devBusy, setDevBusy] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  // Developer login gate — credentials must be entered before the panel appears
  const [devAuthenticated, setDevAuthenticated] = useState(false);
  const [devLoginOpen, setDevLoginOpen] = useState(false);
  const [devCredUser, setDevCredUser] = useState('');
  const [devCredPass, setDevCredPass] = useState('');
  const [devAuthError, setDevAuthError] = useState<string | null>(null);

  function handleDevAuth() {
    const expectedUser = process.env.EXPO_PUBLIC_DEV_TOOL_USERNAME ?? '';
    const expectedPass = process.env.EXPO_PUBLIC_DEV_TOOL_PASSWORD ?? '';
    if (devCredUser === expectedUser && devCredPass === expectedPass && expectedUser) {
      setDevAuthenticated(true);
      setDevLoginOpen(false);
      setDevCredUser('');
      setDevCredPass('');
      setDevAuthError(null);
    } else {
      setDevAuthError('Invalid credentials.');
    }
  }

  const handleLookup = async () => {
    const id = companyCode.trim().toUpperCase();
    if (!id) {
      setFormError('Enter your company ID.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { company } = await getCompany(id);
      setResolvedCompany({ id: company.id, name: company.name, ppTier: company.ppTier });
      // PP-only companies use email+password instead of OIDC
      if (company.ppTier === 'pp_only') {
        setMode('pp-login');
      } else {
        setMode('confirm');
      }
    } catch {
      setFormError("That company ID doesn't exist. Double-check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmJoin = async () => {
    if (!resolvedCompany) return;
    await login(resolvedCompany.id);
  };

  const handlePPLogin = async () => {
    const email = ppEmail.trim();
    const password = ppPassword;
    if (!email || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    setFormError(null);
    const result = await loginPP(email, password);
    if (!result.ok) {
      setFormError(result.error ?? 'Incorrect email or password.');
    }
  };

  const handlePPPasswordReset = async () => {
    const email = ppEmail.trim();
    if (!email) {
      setResetError('Enter your email address.');
      return;
    }
    setResetLoading(true);
    setResetError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/pp/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Treat 404 (email not found) as success to prevent email enumeration.
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      setResetSent(true);
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : 'Could not send reset email. Try again.',
      );
    } finally {
      setResetLoading(false);
    }
  };

  const handleDevLogin = async (persona: string) => {
    setDevBusy(persona);
    setDevError(null);
    try {
      // Credentials are stored as EXPO_PUBLIC_ vars so they are baked into
      // the dev bundle only — this panel is __DEV__-gated so they never ship.
      const devUser = process.env.EXPO_PUBLIC_DEV_TOOL_USERNAME ?? '';
      const devPass = process.env.EXPO_PUBLIC_DEV_TOOL_PASSWORD ?? '';
      const basicAuth = btoa(`${devUser}:${devPass}`);
      const res = await fetch(`${getApiBaseUrl()}/dev/login-as`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({ persona }),
      });
      const data = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !data?.token) {
        setDevError(data?.error ?? `No "${persona}" user found. Seed one first.`);
        return;
      }
      await loginWithToken(data.token);
    } catch {
      setDevError('Could not reach the dev endpoint. Is the API server running?');
    } finally {
      setDevBusy(null);
    }
  };

  const message = formError ?? ppLoginError ?? errorMessage(loginError);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Developer Login link — top left, __DEV__ only ─────────────────── */}
      {__DEV__ && (
        <Pressable
          style={styles.devLoginLink}
          onPress={() => {
            if (devAuthenticated) {
              // Already in — toggle the panel off (log out of dev mode)
              setDevAuthenticated(false);
            } else {
              setDevLoginOpen(true);
            }
          }}
        >
          <Text style={styles.devLoginLinkText}>
            {devAuthenticated ? '⚙ Dev' : 'Developer Login'}
          </Text>
        </Pressable>
      )}

      {/* ── Developer credentials modal ────────────────────────────────────── */}
      {__DEV__ && (
        <Modal
          visible={devLoginOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDevLoginOpen(false)}
        >
          <View style={styles.devModalOverlay}>
            <View style={[styles.devModalCard, { backgroundColor: colors.card, borderColor: '#f59e0b' }]}>
              <View style={styles.devModalHeader}>
                <Text style={styles.devLabel}>DEVELOPER LOGIN</Text>
                <Pressable onPress={() => { setDevLoginOpen(false); setDevAuthError(null); }}>
                  <Text style={[styles.devLoginLinkText, { fontSize: 18 }]}>✕</Text>
                </Pressable>
              </View>
              {devAuthError && (
                <Text style={styles.devError}>{devAuthError}</Text>
              )}
              <TextInput
                value={devCredUser}
                onChangeText={setDevCredUser}
                placeholder="Username"
                placeholderTextColor="#92400e"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.devCredInput, { borderColor: '#f59e0b', color: colors.foreground }]}
              />
              <TextInput
                value={devCredPass}
                onChangeText={setDevCredPass}
                placeholder="Password"
                placeholderTextColor="#92400e"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleDevAuth}
                style={[styles.devCredInput, { borderColor: '#f59e0b', color: colors.foreground }]}
              />
              <Pressable
                onPress={handleDevAuth}
                style={[styles.devButton, { width: '100%', minWidth: undefined }]}
              >
                <Text style={styles.devButtonText}>Authenticate</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      <Image
        source={require('@/assets/images/brand/full-logo-trimmed.png')}
        style={styles.logo}
        resizeMode="contain"
      />

      {mode === 'choose' && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Field pins, door knocks, and team tracking for storm restoration crews.
          </Text>
          {message && (
            <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text>
          )}
          <Pressable
            onPress={() => login()}
            disabled={isLoading}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Log in
              </Text>
            )}
          </Pressable>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, marginTop: 12 }]}>
            New here?
          </Text>
          <Pressable
            onPress={() => {
              setFormError(null);
              setMode('join');
            }}
            style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.buttonText, { color: colors.foreground }]}>
              Join a company
            </Text>
          </Pressable>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Need to create a company? Visit rooftrax.com to sign up.
          </Text>

          {/* ── Dev Tools — visible only after developer authentication ──── */}
          {__DEV__ && devAuthenticated && (
            <View style={styles.devPanel}>
              <View style={styles.devDivider}>
                <View style={[styles.devDividerLine, { backgroundColor: '#f59e0b' }]} />
                <Text style={styles.devLabel}>DEV TOOLS</Text>
                <View style={[styles.devDividerLine, { backgroundColor: '#f59e0b' }]} />
              </View>
              <Text style={styles.devHint}>Sign in instantly as any persona</Text>
              <View style={styles.devGrid}>
                {DEV_PERSONAS.map(({ key, label }) => (
                  <Pressable
                    key={key}
                    onPress={() => handleDevLogin(key)}
                    disabled={devBusy !== null}
                    style={styles.devButton}
                  >
                    {devBusy === key ? (
                      <ActivityIndicator size="small" color="#f59e0b" />
                    ) : (
                      <Text style={styles.devButtonText}>{label}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
              {devError && <Text style={styles.devError}>{devError}</Text>}
            </View>
          )}
        </>
      )}

      {mode === 'join' && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter the company ID your team lead shared with you.
          </Text>
          {message && (
            <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text>
          )}
          <TextInput
            value={companyCode}
            onChangeText={setCompanyCode}
            placeholder="e.g. R7K2QX"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <Pressable
            onPress={handleLookup}
            disabled={busy || isLoading}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {busy || isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Continue
              </Text>
            )}
          </Pressable>
          <Pressable onPress={() => setMode('choose')} style={styles.linkButton}>
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Back</Text>
          </Pressable>
        </>
      )}

      {mode === 'confirm' && resolvedCompany && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            You're about to join:
          </Text>
          <Text style={[styles.code, { color: colors.foreground }]}>
            {resolvedCompany.name}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Is this your company?
          </Text>
          {message && (
            <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text>
          )}
          <Pressable
            onPress={handleConfirmJoin}
            disabled={isLoading}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Yes, join {resolvedCompany.name}
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setResolvedCompany(null);
              setFormError(null);
              setMode('join');
            }}
            style={styles.linkButton}
          >
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
              Not right — re-enter code
            </Text>
          </Pressable>
        </>
      )}

      {/* PP-only login: email + password instead of OIDC */}
      {mode === 'pp-login' && resolvedCompany && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Sign in to{' '}
            <Text style={{ fontWeight: '700', color: colors.foreground }}>
              {resolvedCompany.name}
            </Text>
          </Text>
          {message && (
            <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text>
          )}
          <TextInput
            value={ppEmail}
            onChangeText={setPpEmail}
            placeholder="Email address"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <TextInput
            value={ppPassword}
            onChangeText={setPpPassword}
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            textContentType="password"
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <Pressable
            onPress={handlePPLogin}
            disabled={isLoading}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Sign in
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setFormError(null);
              setResetSent(false);
              setResetError(null);
              setMode('pp-forgot');
            }}
            style={styles.linkButton}
          >
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
              Forgot your password?
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setResolvedCompany(null);
              setFormError(null);
              setPpEmail('');
              setPpPassword('');
              setMode('join');
            }}
            style={styles.linkButton}
          >
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
              Back — re-enter company ID
            </Text>
          </Pressable>
        </>
      )}

      {/* PP password reset — email + send link, then success state */}
      {mode === 'pp-forgot' && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {resetSent ? 'Check your email' : 'Reset your Proof Package password'}
          </Text>
          {resetSent ? (
            <>
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.mutedForeground, marginTop: 0, fontSize: 14 },
                ]}
              >
                A password reset link was sent to {ppEmail.trim()}. Follow the link in
                the email to choose a new password, then sign in here.
              </Text>
              <Pressable
                onPress={() => {
                  setResetSent(false);
                  setMode('pp-login');
                }}
                style={[styles.button, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                  Back to sign in
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              {resetError && (
                <Text style={[styles.error, { color: colors.destructive }]}>{resetError}</Text>
              )}
              <TextInput
                value={ppEmail}
                onChangeText={setPpEmail}
                placeholder="Email address"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.foreground },
                ]}
              />
              <Pressable
                onPress={handlePPPasswordReset}
                disabled={resetLoading}
                style={[styles.button, { backgroundColor: colors.primary }]}
              >
                {resetLoading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                    Send reset link
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => {
                  setResetError(null);
                  setMode('pp-login');
                }}
                style={styles.linkButton}
              >
                <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                  Back to sign in
                </Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  logo: {
    width: '100%',
    maxWidth: 320,
    height: 140,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  error: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  code: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 4,
    marginBottom: 8,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 4,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
  },
  // ── Developer login link (top-left corner) ─────────────────────────────
  devLoginLink: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
    padding: 4,
  },
  devLoginLinkText: {
    fontSize: 11,
    color: '#f59e0b',
    opacity: 0.6,
  },
  // ── Developer credentials modal ─────────────────────────────────────────
  devModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  devModalCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  devModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  devCredInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  // ── Dev panel ──────────────────────────────────────────────────────────
  devPanel: {
    width: '100%',
    marginTop: 8,
    gap: 10,
  },
  devDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  devDividerLine: {
    flex: 1,
    height: 1,
    opacity: 0.5,
  },
  devLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#f59e0b',
  },
  devHint: {
    fontSize: 12,
    textAlign: 'center',
    color: '#92400e',
  },
  devGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  devButton: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#1c1917',
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  devButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f59e0b',
  },
  devError: {
    fontSize: 12,
    textAlign: 'center',
    color: '#ef4444',
  },
});
