import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

// Everything from this screen has moved to Roof Inspection (inspection-roof.tsx).
// This stub redirects any deep-links still pointing to /inspection-product.
export default function InspectionProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    if (id) router.replace({ pathname: '/inspection-roof', params: { id } });
  }, [id]);
  return null;
}
