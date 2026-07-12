import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useListPins } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';

// react-native-maps has no web renderer (its web entry is an
// UnimplementedView stub), so the web build shows a plain list of pins
// instead of a live map. Native (iOS/Android/Expo Go) uses MapScreen.native.
export default function MapScreenWeb() {
  const colors = useColors();
  const { role } = useProfile();
  const pinsQuery = useListPins();
  const pins = pinsQuery.data?.pins ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.banner, { backgroundColor: colors.secondary }]}>
        <Feather name="smartphone" size={18} color="#fff" />
        <Text style={styles.bannerText}>
          The live map needs the mobile app (iOS/Android) — showing pins as a
          list here instead.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {pins.map((pin) => (
          <View
            key={pin.id}
            style={[styles.pinRow, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: pin.workflow === 'retail' ? colors.retail : colors.insurance },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: '600' }}>
                {pin.address ?? `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {pin.workflow === 'retail'
                  ? `Retail · ${pin.doorKnockResult ?? 'no result'}`
                  : `Insurance · ${pin.damageType ?? 'unspecified'}`}
              </Text>
            </View>
          </View>
        ))}
        {pins.length === 0 && !pinsQuery.isLoading && (
          <Text style={{ color: colors.mutedForeground, padding: 16 }}>
            No pins yet.
          </Text>
        )}
      </ScrollView>

      {role === 'field_rep' && (
        <Pressable
          onPress={() => router.push('/bulk-upload')}
          style={[styles.fab, { backgroundColor: colors.primary }]}
        >
          <Feather name="upload" size={22} color={colors.primaryForeground} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    padding: 14,
    paddingTop: 67 + 14,
  },
  bannerText: { color: '#fff', fontSize: 13, flex: 1, lineHeight: 18 },
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  pinRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 34 + 84,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
