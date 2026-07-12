import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

export interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * Cross-platform current-location hook. Uses expo-location on native, and
 * the browser geolocation API on web (expo-location has no web support).
 */
export function useCurrentLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web') {
        await new Promise<void>((resolve) => {
          if (!navigator.geolocation) {
            setPermissionDenied(true);
            resolve();
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setCoords({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
              resolve();
            },
            () => {
              setPermissionDenied(true);
              resolve();
            },
          );
        });
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setPermissionDenied(true);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { coords, permissionDenied, isLoading, refresh };
}
