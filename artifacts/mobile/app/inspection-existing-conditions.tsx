import { Redirect, useLocalSearchParams } from 'expo-router';

// The standalone Existing/Unrelated Conditions step has been eliminated.
// Pre-existing conditions are now documented per siding facet. Redirect
// any deep-link or stale bookmark back to the inspection hub.
export default function InspectionExistingConditionsRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/inspection/${id}`} />;
}
