import { useLocalSearchParams } from 'expo-router';
import { router } from 'expo-router';
import { useEffect } from 'react';

// Homeowner Interview is now embedded in the Arrival Log screen (shown when
// "Homeowner" is selected in Personnel Present). Deep links land here and are
// immediately redirected.
export default function InspectionHomeownerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    router.replace({ pathname: '/inspection-arrival', params: { id } });
  }, [id]);
  return null;
}
