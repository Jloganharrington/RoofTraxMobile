import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { markNoCollateralDamage } from '@/lib/inspectionSync';
import { isCollateralWaived } from '@/lib/inspectionProtocolState';

// Step 7 · Collateral & Ground Evidence (protocol v2). A simple labeled-photo
// pass with no hard gate: the inspector shoots roof-level collateral first
// (vents, flashing, gutters seen from the roof), then ground-level evidence
// (screens, siding, AC fins, mailbox). Each shot gets a short label typed
// before capture; "Add Additional Collateral" keeps the list open-ended.
// Photos attach to the inspection itself under the `collateral` stage.

const SUGGESTIONS: Record<'roof' | 'ground', string[]> = {
  roof: ['Vents', 'Flashing', 'Gutters', 'Skylight', 'Satellite mount'],
  ground: ['Window screens', 'Siding', 'AC condenser fins', 'Mailbox', 'Fence'],
};

export default function InspectionCollateralScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [waiving, setWaiving] = React.useState(false);

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [labelTarget, setLabelTarget] = React.useState<'roof' | 'ground' | null>(null);
  const [label, setLabel] = React.useState('');

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Collateral & Ground' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Collateral & Ground' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const collateralPhotos = (inspection.photos ?? []).filter((p) => p.stage === 'collateral');
  const waived = isCollateralWaived(inspection);
  const addressed = collateralPhotos.length > 0 || waived;

  async function markNoDamage() {
    if (!user || waiving) return;
    setWaiving(true);
    try {
      await markNoCollateralDamage(queryClient, id, user.id);
    } finally {
      setWaiving(false);
    }
  }

  function capture(section: 'roof' | 'ground', photoLabel: string) {
    setLabelTarget(null);
    setLabel('');
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'inspection',
        roles: 'wide',
        stage: 'collateral',
        title: `${section === 'roof' ? 'Roof-level' : 'Ground-level'} · ${photoLabel}`,
      },
    });
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Collateral & Ground' }} />

      <View
        style={[
          styles.summary,
          {
            backgroundColor: addressed ? '#ecfdf5' : colors.card,
            borderColor: addressed ? colors.success : colors.border,
          },
        ]}
      >
        <Icon
          name={addressed ? 'check' : 'camera'}
          size={22}
          color={addressed ? colors.success : colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {collateralPhotos.length > 0
              ? `${collateralPhotos.length} collateral photo${collateralPhotos.length === 1 ? '' : 's'} captured`
              : waived
                ? 'No collateral damage found'
                : 'No collateral photos yet'}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Optional but powerful corroborating evidence. Label each shot, then capture it.
          </Text>
        </View>
      </View>

      {(['roof', 'ground'] as const).map((section) => (
        <View key={section} style={{ gap: 8 }}>
          <Text style={[styles.section, { color: colors.foreground }]}>
            {section === 'roof' ? '1. Roof-level collateral' : '2. Ground-level evidence'}
          </Text>
          <View style={styles.chipRow}>
            {SUGGESTIONS[section].map((s) => (
              <Pressable
                key={s}
                onPress={() => capture(section, s)}
                style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Icon name="camera" size={14} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontWeight: '600' }}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => {
              setLabel('');
              setLabelTarget(section);
            }}
            style={[styles.addRow, { borderColor: colors.border }]}
          >
            <Icon name="plus" size={18} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Add additional collateral</Text>
          </Pressable>
        </View>
      ))}

      {!waived && collateralPhotos.length === 0 ? (
        <Pressable
          onPress={markNoDamage}
          disabled={waiving}
          style={[styles.waiveBtn, { borderColor: colors.border, opacity: waiving ? 0.6 : 1 }]}
        >
          {waiving ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (
            <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>
              No Collateral Damage Found
            </Text>
          )}
        </Pressable>
      ) : null}

      <View style={{ height: 40 }} />

      {/* Custom-label entry before capture. */}
      <Modal visible={labelTarget !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
              Label this {labelTarget === 'roof' ? 'roof-level' : 'ground-level'} photo
            </Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Dented chimney cap"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setLabelTarget(null)}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => labelTarget && label.trim() && capture(labelTarget, label.trim())}
                disabled={!label.trim()}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: label.trim() ? 1 : 0.5 }]}
              >
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Capture</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  summaryTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  waiveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});
