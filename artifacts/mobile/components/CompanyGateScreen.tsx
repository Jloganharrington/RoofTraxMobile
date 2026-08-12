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
import { createCompany, getCompany } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth, type LoginError } from '@/lib/auth';

type Mode = 'choose' | 'join' | 'confirm' | 'pp-login' | 'create';

function errorMessage(error: LoginError | null): string | null {
  switch (error) {
    case 'missing_company':
      return 'Please join or create a company before signing in.';
    case 'company_not_found':
      return "That company ID doesn't exist. Double-check it and try again.";
    case 'unknown':
      return 'Something went wrong signing in. Please try again.';
    default:
      return null;
  }
}

// Shown before login — a brand-new user must join an existing company (by
// its short ID) or create one (becoming its first admin). Returning users
// never see this: their companyId is fixed at signup and untouched here.
export function CompanyGateScreen() {
  const colors = useColors();
  const { login, loginPP, ppLoginError, isLoading, loginError } = useAuth();
  const [mode, setMode] = useState<Mode>('choose');
  const [companyCode, setCompanyCode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [resolvedCompany, setResolvedCompany] = useState<{
    id: string;
    name: string;
    ppTier?: string;
  } | null>(null);

  // PP login form state
  const [ppEmail, setPpEmail] = useState('');
  const [ppPassword, setPpPassword] = useState('');

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

  const handleCreate = async () => {
    const name = companyName.trim();
    if (!name) {
      setFormError('Enter your company name.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { company } = await createCompany({ name });
      setCreatedId(company.id);
    } catch {
      setFormError('Could not create the company. Please try again.');
    } finally {
      setBusy(false);
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
          <Pressable
            onPress={() => {
              setFormError(null);
              setMode('create');
            }}
            style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.buttonText, { color: colors.foreground }]}>
              Create a company
            </Text>
          </Pressable>
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

      {mode === 'create' && !createdId && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Name your company. You'll be its first admin.
          </Text>
          {message && (
            <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text>
          )}
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            placeholder="Company name"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <Pressable
            onPress={handleCreate}
            disabled={busy}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Create company
              </Text>
            )}
          </Pressable>
          <Pressable onPress={() => setMode('choose')} style={styles.linkButton}>
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Back</Text>
          </Pressable>
        </>
      )}

      {mode === 'create' && createdId && (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Your company ID is:
          </Text>
          <Text style={[styles.code, { color: colors.foreground }]}>{createdId}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Share it with your team so they can join. You can find it again later in the
            admin dashboard.
          </Text>
          {message && (
            <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text>
          )}
          <Pressable
            onPress={() => login(createdId)}
            disabled={isLoading}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Continue to sign in
              </Text>
            )}
          </Pressable>
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
