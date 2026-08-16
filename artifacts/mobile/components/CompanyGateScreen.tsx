import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  const { login, loginPP, ppLoginError, isLoading, loginError } = useAuth();
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

  const message = formError ?? ppLoginError ?? errorMessage(loginError);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
});
