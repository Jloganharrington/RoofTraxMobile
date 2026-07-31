import React from 'react';
import { Pressable, Text } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { applicableSteps, stepLabel, type StepKey } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

// Single source of truth for step-key → screen route, shared with the
// inspection hub so the header "Next" button and the hub cards never drift.
export const STEP_ROUTES: Record<StepKey, string> = {
  arrival: '/inspection-arrival',
  property_profile: '/inspection-property-profile',
  repairability: '/inspection-repairability',
  mitigation: '/inspection-mitigation',
  existing_conditions: '/inspection-existing-conditions',
  elevation_access: '/inspection-elevations',
  facets: '/inspection-roof',
  // Merged into Roof Inspection — redirect stubs remain for deep links.
  test_squares: '/inspection-roof',
  components: '/inspection-roof',
  product: '/inspection-roof',
  siding: '/inspection-siding',
  collateral: '/inspection-collateral',
  interior: '/inspection-interior',
  homeowner: '/inspection-arrival',
  declaration: '/inspection-declaration',
  summary: '/inspection-summary',
  estimate: '/inspection-estimate',
  submit: '/inspection-readiness',
};

// Steps that have been merged into the Roof Inspection screen and should not
// appear as separate navigation stops (hub cards or Next-button hops).
// Steps embedded in a parent screen — hidden from hub cards and Next-button hops.
export const STEPS_MERGED_INTO_ROOF = new Set<StepKey>([
  'existing_conditions',
  'test_squares', 'components', 'product', // merged into Roof Inspection
  'homeowner',                              // merged into Arrival Log
]);

/**
 * Puts a "Next" button in the header (opposite Back) that navigates to the
 * next applicable protocol section for this inspection. Conditional steps
 * (e.g. Siding when no siding damage) are skipped automatically because the
 * order comes from applicableSteps(). The last step (Submit) shows no button.
 *
 * Uses router.replace so walking Next → Next doesn't pile every section onto
 * the back stack — Back always returns to the inspection hub.
 */
export function useNextSectionHeader(id: string, current: StepKey): void {
  const navigation = useNavigation();
  const router = useRouter();
  const colors = useColors();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const steps = inspection
    ? applicableSteps({
        roofDamageFound: Boolean(inspection.roofDamageFound),
        sidingDamageFound: Boolean(inspection.sidingDamageFound),
        collateralDamageFound: Boolean(inspection.collateralDamageFound),
        interiorDamageFound: Boolean(inspection.interiorDamageFound),
      }).filter((s) => !STEPS_MERGED_INTO_ROOF.has(s.key))
    : [];
  const index = steps.findIndex((s) => s.key === current);
  const next = index >= 0 ? (steps[index + 1] ?? null) : null;
  const nextKey = next?.key ?? null;
  const latitude = inspection?.latitude != null ? String(inspection.latitude) : '';
  const longitude = inspection?.longitude != null ? String(inspection.longitude) : '';

  React.useEffect(() => {
    if (!nextKey) {
      navigation.setOptions({ headerRight: undefined });
      return;
    }
    const params: Record<string, string> =
      nextKey === 'arrival' ? { id, latitude, longitude } : { id };
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() =>
            router.replace({ pathname: STEP_ROUTES[nextKey] as never, params } as never)
          }
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Next: ${stepLabel(nextKey)}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 }}
        >
          <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>Next</Text>
          <Icon name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
      ),
    });
  }, [navigation, router, nextKey, id, latitude, longitude, colors.primary]);
}
