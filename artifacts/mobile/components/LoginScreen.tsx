import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';

export function LoginScreen() {
  const colors = useColors();
  const { login, isLoading } = useAuth();

  return (
    <View style={[styles.container, { backgroundColor: colors.secondary }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
        <Feather name="home" size={36} color={colors.primaryForeground} />
      </View>
      <Text style={[styles.title, { color: '#ffffff' }]}>RoofTrax</Text>
      <Text style={[styles.subtitle, { color: '#c7d2e0' }]}>
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
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
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
