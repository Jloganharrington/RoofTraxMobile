import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { getListPinsQueryKey, useListPins } from '@workspace/api-client-react';
import type { Pin } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

// Start-from-pin (B3): an inspector picks one of their canvassing pins to
// seed a new inspection with its address + coordinates, or starts a blank
// intake. Insurance-workflow pins are the natural inspection candidates.
export default function InspectionStartScreen() {
  const colors = useColors();
  const pins = useListPins(undefined, { query: { queryKey: getListPinsQueryKey() } });
  const candidates = (pins.data?.pins ?? []).filter((p) => p.workflow === 'insurance');

  function startFromPin(pin: Pin) {
    router.replace({
      pathname: '/inspection-intake',
      params: {
        pinId: pin.id,
        address: pin.address ?? '',
        insuredName: pin.customerName ?? '',
        latitude: String(pin.latitude),
        longitude: String(pin.longitude),
      },
    });
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Pressable
        onPress={() => router.replace('/inspection-intake')}
        style={[styles.blankCta, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Icon name="plus" size={20} color={colors.primary} />
        <Text style={[styles.blankText, { color: colors.foreground }]}>
          Start a blank inspection
        </Text>
        <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>

      <Text style={[styles.section, { color: colors.foreground }]}>Start from a pin</Text>
      {pins.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : candidates.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="map-pin" size={20} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1 }}>
            No insurance-workflow pins yet. Drop one from the map, or start a blank inspection.
          </Text>
        </View>
      ) : (
        candidates.map((pin) => (
          <Pressable
            key={pin.id}
            onPress={() => startFromPin(pin)}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Icon name="map-pin" size={18} color={colors.insurance} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
                {pin.customerName ?? pin.address ?? 'Insurance pin'}
              </Text>
              <Text style={{ color: colors.mutedForeground }} numberOfLines={1}>
                {pin.address ?? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ))
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  blankCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  blankText: { flex: 1, fontSize: 15, fontWeight: '700' },
  section: { fontSize: 17, fontWeight: '700', marginTop: 10 },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
});
