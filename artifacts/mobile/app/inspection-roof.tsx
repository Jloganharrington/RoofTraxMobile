import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createSlope } from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';

// C3 — Roof access + slope inventory (S2 / S3). Records the single roof-access
// photo (S2) and lets the inspector build the slope inventory: each slope is a
// raw fact (label + optional pitch/material), documented with one wide
// overview photo (S3). No squares/pitch math happens here — steepness and
// area are downstream of raw capture.

export default function InspectionRoofScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [label, setLabel] = React.useState('');
  const [pitchRise, setPitchRise] = React.useState('');
  const [pitchRun, setPitchRun] = React.useState('');
  const [material, setMaterial] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const roofAccessDone = state.roofAccessPhotoCaptured;
  const slopeCaptured = new Map(state.slopes.map((s) => [s.id, s.widePhotoCaptured]));
  const slopes = inspection.slopes ?? [];
  const s3Remaining = stageDeficiencies(inspection, 'S3').length;

  function captureRoofAccess() {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'inspection',
        roles: 'wide',
        stage: 'S2',
        title: 'Roof access',
      },
    });
  }

  function captureSlopeOverview(slopeId: string, slopeLabel: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'slope',
        subjectId: slopeId,
        roles: 'wide',
        stage: 'S3',
        title: `${slopeLabel} overview`,
      },
    });
  }

  async function addSlope() {
    if (!label.trim() || adding) return;
    setAdding(true);
    try {
      const slopeId = await createSlope(queryClient, id, {
        label: label.trim(),
        pitchRise: pitchRise.trim() ? Number(pitchRise) : null,
        pitchRun: pitchRun.trim() ? Number(pitchRun) : null,
        materialType: material.trim() || null,
      });
      const created = label.trim();
      setLabel('');
      setPitchRise('');
      setPitchRun('');
      setMaterial('');
      captureSlopeOverview(slopeId, created);
    } finally {
      setAdding(false);
    }
  }

  const pitchValid =
    (pitchRise.trim() === '' || !Number.isNaN(Number(pitchRise))) &&
    (pitchRun.trim() === '' || !Number.isNaN(Number(pitchRun)));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* S2 — Roof access */}
        <Text style={[styles.section, { color: colors.foreground }]}>S2 · Roof access</Text>
        <Pressable
          onPress={captureRoofAccess}
          style={[styles.row, { backgroundColor: colors.card, borderColor: roofAccessDone ? colors.success : colors.border }]}
        >
          <View style={[styles.badge, { backgroundColor: roofAccessDone ? colors.success : colors.accent }]}>
            <Icon name={roofAccessDone ? 'check' : 'camera'} size={18} color={roofAccessDone ? '#fff' : colors.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              {roofAccessDone ? 'Roof access photo captured' : 'Capture roof access photo'}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              How the roof was reached (ladder, hatch, drone launch point).
            </Text>
          </View>
          <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>

        {/* S3 — Slopes */}
        <Text style={[styles.section, { color: colors.foreground }]}>
          S3 · Slopes {slopes.length > 0 ? `(${slopes.length})` : ''}
        </Text>
        {slopes.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 4 }}>
            Document each roof slope below. At least one slope with a wide overview photo is required.
          </Text>
        ) : (
          slopes.map((slope) => {
            const done = slopeCaptured.get(slope.id) ?? false;
            const pitch =
              slope.pitchRise != null && slope.pitchRun != null
                ? `${slope.pitchRise}:${slope.pitchRun} pitch`
                : null;
            const meta = [pitch, slope.materialType].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={slope.id}
                onPress={() => captureSlopeOverview(slope.id, slope.label)}
                style={[styles.row, { backgroundColor: colors.card, borderColor: done ? colors.success : colors.border }]}
              >
                <View style={[styles.badge, { backgroundColor: done ? colors.success : colors.accent }]}>
                  <Icon name={done ? 'check' : 'camera'} size={18} color={done ? '#fff' : colors.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{slope.label}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {done ? 'Overview captured' : 'Tap to capture overview'}
                    {meta ? ` · ${meta}` : ''}
                  </Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
              </Pressable>
            );
          })
        )}

        {slopes.length > 0 ? (
          <Text style={{ color: s3Remaining === 0 ? colors.success : colors.mutedForeground, fontSize: 13 }}>
            {s3Remaining === 0
              ? 'All slopes have an overview photo.'
              : `${s3Remaining} slope${s3Remaining === 1 ? '' : 's'} still need an overview photo.`}
          </Text>
        ) : null}

        {/* Add slope form */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Add a slope</Text>
          <Field label="Label" value={label} onChange={setLabel} placeholder="e.g. Front-left, Main ridge" colors={colors} />
          <View style={styles.pitchRow}>
            <View style={{ flex: 1 }}>
              <Field label="Pitch rise" value={pitchRise} onChange={setPitchRise} placeholder="e.g. 6" keyboardType="numeric" colors={colors} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Pitch run" value={pitchRun} onChange={setPitchRun} placeholder="e.g. 12" keyboardType="numeric" colors={colors} />
            </View>
          </View>
          <Field label="Material" value={material} onChange={setMaterial} placeholder="e.g. Asphalt shingle" colors={colors} />
          <Pressable
            onPress={addSlope}
            disabled={!label.trim() || !pitchValid || adding}
            style={[styles.addBtn, { backgroundColor: colors.primary, opacity: !label.trim() || !pitchValid || adding ? 0.5 : 1 }]}
          >
            {adding ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.addText, { color: colors.primaryForeground }]}>Add slope & photograph</Text>
            )}
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? 'default'}
        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10, marginTop: 6 },
  pitchRow: { flexDirection: 'row', gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  addBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  addText: { fontSize: 15, fontWeight: '700' },
});
