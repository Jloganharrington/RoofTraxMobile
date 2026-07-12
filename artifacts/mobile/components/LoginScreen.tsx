import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';

export function LoginScreen() {
  const colors = useColors();
  const { login, isLoading } = useAuth();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Image
        source={require('@/assets/images/brand/full-logo-trimmed.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Field pins, door knocks, and team tracking for storm restoration
        crews.
      </Text>

      <Pressable
        onPress={login}
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
    marginBottom: 24,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
