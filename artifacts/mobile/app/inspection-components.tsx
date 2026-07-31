import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

// Everything that was here has moved to Roof Inspection (inspection-roof.tsx).
// This stub redirects any deep-links that still point to /inspection-components.
export default function InspectionComponentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    if (id) router.replace({ pathname: '/inspection-roof', params: { id } });
  }, [id]);
  return null;
}
