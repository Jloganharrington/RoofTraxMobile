import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useListPins, usePingLocation } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import { useProfile } from '@/hooks/useProfile';

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
  const { role } = useProfile();
  const pinsQuery = useListPins();
  const pingLocation = usePingLocation();
  const [hasCentered, setHasCentered] = useState(false);

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

  const initialRegion = useMemo(
    () => (coords ? { ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 } : DEFAULT_REGION),
    [coords],
  );

  function handleDropPin() {
    if (!coords) return;
    router.push({
      pathname: '/pin-new',
      params: { latitude: String(coords.latitude), longitude: String(coords.longitude) },
    });
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
      >
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            pinColor={pin.workflow === 'retail' ? colors.retail : colors.insurance}
            title={pin.address ?? `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`}
            description={
              pin.workflow === 'retail'
                ? `Retail · ${pin.doorKnockResult ?? 'no result'}`
                : `Insurance · ${pin.damageType ?? 'unspecified'}`
            }
          />
        ))}
      </MapView>

      {(locLoading || pinsQuery.isLoading) && (
        <View style={styles.loadingBadge} pointerEvents="none">
          <ActivityIndicator />
        </View>
      )}

      {permissionDenied && (
        <View style={[styles.banner, { backgroundColor: colors.destructive }]}>
          <Text style={styles.bannerText}>
            Location access is needed to drop pins at your position.
          </Text>
        </View>
      )}

      {role === 'field_rep' && (
        <Pressable
          onPress={() => router.push('/bulk-upload')}
          style={[
            styles.secondaryFab,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="upload" size={20} color={colors.foreground} />
        </Pressable>
      )}

      <Pressable
        onPress={handleDropPin}
        disabled={!coords}
        style={[
          styles.fab,
          { backgroundColor: coords ? colors.primary : colors.mutedForeground },
        ]}
      >
        <Feather name="plus" size={28} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingBadge: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 80 : 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    padding: 8,
  },
  banner: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 80 : 16,
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
});
