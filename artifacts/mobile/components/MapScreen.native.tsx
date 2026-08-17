import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  type LatLng,
  type MapPressEvent,
  type MarkerDragStartEndEvent,
} from 'react-native-maps';
import { AddressSearchBar } from '@/components/AddressSearchBar';
import { Icon } from '@/components/Icon';
import { router } from 'expo-router';
import {
  getListTeamUsersQueryKey,
  useListPins,
  useListTeamUsers,
  usePingLocation,
} from '@workspace/api-client-react';
import type { GeocodeSearchResult } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { canEditPin } from '@/lib/permissions';

const DEFAULT_REGION = {
  latitude: 39.8283,
  longitude: -98.5795,
  latitudeDelta: 30,
  longitudeDelta: 30,
};

export default function MapScreen() {
  const colors = useColors();
  const mapRef = useRef<MapView>(null);
  const { coords, permissionDenied, isLoading: locLoading } =
    useCurrentLocation();
  const { role, department } = useProfile();
  const { user } = useAuth();
  const isManagerOrAdmin = role === 'manager' || role === 'admin';

  const [filterUserId, setFilterUserId] = useState<string | null>(null);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);

  const teamQuery = useListTeamUsers({
    query: { enabled: isManagerOrAdmin, queryKey: getListTeamUsersQueryKey() },
  });
  const pinsQuery = useListPins(
    isManagerOrAdmin && filterUserId ? { userId: filterUserId } : undefined,
  );
  const pingLocation = usePingLocation();
  const [hasCentered, setHasCentered] = useState(false);
  const [pendingPin, setPendingPin] = useState<LatLng | null>(null);

  useEffect(() => {
    if (coords && !hasCentered) {
      mapRef.current?.animateToRegion(
        {
          ...coords,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        400,
      );
      setHasCentered(true);
    }
  }, [coords, hasCentered]);

  // Keep the server's "latest known location" fresh for team-position
  // awareness (managers/admins can see it on the Team tab).
  useEffect(() => {
    if (!coords) return;
    pingLocation.mutate({ data: coords });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.latitude, coords?.longitude]);

  const pins = pinsQuery.data?.pins ?? [];
  const teamMembers = teamQuery.data?.users ?? [];
  const filterLabel = filterUserId
    ? (() => {
        const member = teamMembers.find((m) => m.id === filterUserId);
        return member
          ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
          : 'Selected rep';
      })()
    : 'All reps';

  const initialRegion = useMemo(
    () => (coords ? { ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 } : DEFAULT_REGION),
    [coords],
  );

  // Tapping the map drops a draggable pin so the rep can fine-tune the exact
  // spot (e.g. over the house, not the street) before confirming.
  function handleMapPress(event: MapPressEvent) {
    setPendingPin(event.nativeEvent.coordinate);
  }

  function handleFabPress() {
    if (pendingPin) {
      confirmPendingPin();
      return;
    }
    if (!coords) return;
    setPendingPin(coords);
  }

  function handlePendingPinDragEnd(event: MarkerDragStartEndEvent) {
    setPendingPin(event.nativeEvent.coordinate);
  }

  // Search result selection recenters the map on that address and drops a
  // pending pin there, reusing the same confirm/cancel flow as tapping the
  // map directly — so a rep can search an address they aren't standing at
  // and immediately drop a pin on it.
  function handleSearchSelect(result: GeocodeSearchResult) {
    const coordinate = { latitude: result.latitude, longitude: result.longitude };
    mapRef.current?.animateToRegion(
      { ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    );
    setPendingPin(coordinate);
  }

  function confirmPendingPin() {
    if (!pendingPin) return;
    router.push({
      pathname: '/pin-new',
      params: {
        latitude: String(pendingPin.latitude),
        longitude: String(pendingPin.longitude),
      },
    });
    setPendingPin(null);
  }

  // Canvassers see every pin for team awareness, but pins dropped by other
  // reps render as neutral grey — only their own pins are colored by workflow.
  // Inspector field reps, managers, and admins always see workflow coloring
  // since they coordinate across the full team.
  // Do-Not-Knock pins are always red regardless of viewer or ownership.
  function pinColorFor(pin: (typeof pins)[number]) {
    if (pin.doorKnockResult === 'do_not_knock') return '#dc2626';
    if (department === 'canvasser' && pin.userId !== user?.id) {
      return colors.mutedForeground;
    }
    return pin.workflow === 'retail' ? colors.retail : colors.insurance;
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={handleMapPress}
      >
        {pendingPin && (
          <Marker
            coordinate={pendingPin}
            draggable
            onDragEnd={handlePendingPinDragEnd}
            pinColor={colors.primary}
          />
        )}

        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            pinColor={pinColorFor(pin)}
            title={pin.address ?? `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`}
            description={
              pin.workflow === 'retail'
                ? `Retail · ${pin.doorKnockResult ?? 'no result'}`
                : `Insurance · ${pin.damageType ?? 'unspecified'}`
            }
            onCalloutPress={() => {
              if (!canEditPin(role, user?.id, pin.userId)) return;
              router.push({ pathname: '/pin-edit', params: { pin: JSON.stringify(pin) } });
            }}
          />
        ))}
      </MapView>

      <AddressSearchBar
        onSelect={handleSearchSelect}
        localItems={pins.filter((p): p is typeof p & { address: string } => !!p.address)}
        near={coords}
      />

      {(locLoading || pinsQuery.isLoading) && (
        <View style={styles.loadingBadge} pointerEvents="none">
          <ActivityIndicator />
        </View>
      )}

      {isManagerOrAdmin && !pendingPin && (
        <Pressable
          onPress={() => setFilterPickerOpen(true)}
          style={[
            styles.filterPill,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Icon name="users" size={14} color={colors.foreground} />
          <Text style={[styles.filterPillText, { color: colors.foreground }]} numberOfLines={1}>
            {filterLabel}
          </Text>
          <Icon name="chevron-down" size={14} color={colors.mutedForeground} />
        </Pressable>
      )}

      {permissionDenied && !pendingPin && (
        <View style={[styles.banner, { backgroundColor: colors.destructive }]}>
          <Text style={styles.bannerText}>
            Location access is needed to drop pins at your position.
          </Text>
        </View>
      )}

      {pendingPin && (
        <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          <Text style={[styles.bannerText, { color: colors.foreground }]}>
            Drag the pin over the house, then tap the check to confirm.
          </Text>
        </View>
      )}

      {pendingPin && (
        <Pressable
          onPress={() => setPendingPin(null)}
          style={[
            styles.secondaryFab,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Icon name="x" size={20} color={colors.foreground} />
        </Pressable>
      )}

      {isManagerOrAdmin && !pendingPin && (
        <Pressable
          onPress={() => router.push('/bulk-upload')}
          style={[
            styles.secondaryFab,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Icon name="upload" size={20} color={colors.foreground} />
        </Pressable>
      )}

      <Pressable
        onPress={handleFabPress}
        disabled={!pendingPin && !coords}
        style={[
          styles.fab,
          {
            backgroundColor:
              pendingPin || coords ? colors.primary : colors.mutedForeground,
          },
        ]}
      >
        <Icon
          name={pendingPin ? 'check' : 'plus'}
          size={28}
          color={colors.primaryForeground}
        />
      </Pressable>

      <Modal
        visible={filterPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setFilterPickerOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFilterPickerOpen(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.border }]}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Show pins for</Text>

            <Pressable
              onPress={() => {
                setFilterUserId(null);
                setFilterPickerOpen(false);
              }}
              style={[
                styles.optionRow,
                {
                  borderColor: colors.border,
                  backgroundColor: filterUserId === null ? colors.muted : 'transparent',
                },
              ]}
            >
              <Text style={{ color: colors.foreground, fontSize: 15 }}>All reps</Text>
              {filterUserId === null && <Icon name="check" size={18} color={colors.primary} />}
            </Pressable>

            {teamMembers.map((member) => {
              const name =
                [member.firstName, member.lastName].filter(Boolean).join(' ') ||
                member.email ||
                'Unnamed';
              const selected = filterUserId === member.id;
              return (
                <Pressable
                  key={member.id}
                  onPress={() => {
                    setFilterUserId(member.id);
                    setFilterPickerOpen(false);
                  }}
                  style={[
                    styles.optionRow,
                    {
                      borderColor: colors.border,
                      backgroundColor: selected ? colors.muted : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: colors.foreground, fontSize: 15 }}>{name}</Text>
                  {selected && <Icon name="check" size={18} color={colors.primary} />}
                </Pressable>
              );
            })}

            <Pressable onPress={() => setFilterPickerOpen(false)} style={styles.cancelButton}>
              <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingBadge: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 80 : 130,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    padding: 8,
  },
  filterPill: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 80 : 130,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 200,
  },
  filterPillText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  banner: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 80 : 130,
    left: 16,
    right: 16,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: Platform.OS === 'web' ? 110 : 100,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  secondaryFab: {
    position: 'absolute',
    right: 24,
    bottom: Platform.OS === 'web' ? 180 : 170,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    elevation: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 6,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
});
