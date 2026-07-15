import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import type { Inspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { DAMAGE_TYPE_LABEL } from '@/lib/preliminary';

// P3 — on-device shareable homeowner report. A plain-language summary of the
// Phase 1 findings: what damage was found, the severe-weather event it ties to,
// and the fixed next-steps path. It is deliberately NOT a quote or a coverage
// opinion — no pricing, no "you are covered / not covered" language — so the
// homeowner leaves with facts and a process, nothing that reads as a promise.
const NEXT_STEPS: Array<{ title: string; detail: string }> = [
  {
    title: 'File a claim',
    detail: 'Open a claim with your insurance carrier for the storm date noted above.',
  },
  {
    title: 'Pay for a forensic inspection',
    detail: 'Authorize the detailed, documented forensic roof inspection.',
  },
  {
    title: 'Forensic inspection',
    detail: 'A full evidence capture of every slope, elevation, and damaged component.',
  },
  {
    title: 'Proof package',
    detail: 'The findings are compiled into a documented, photo-backed report.',
  },
  {
    title: 'Claim negotiation',
    detail: 'The proof package supports the conversation with your carrier.',
  },
];

function buildShareText(inspection: Inspection): string {
  const lines: string[] = [];
  lines.push('Preliminary Roof Inspection Summary');
  if (inspection.address) lines.push(inspection.address);
  lines.push('');

  const damage = inspection.damageType
    ? DAMAGE_TYPE_LABEL[inspection.damageType] ?? inspection.damageType
    : 'Storm-related damage';
  lines.push(`Damage found: ${damage}`);

  const storm = inspection.stormConfirmedRef;
  if (storm) {
    lines.push(`Weather event: ${storm.type} on ${storm.date}`);
  }
  lines.push('');

  lines.push('Next steps:');
  NEXT_STEPS.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.title} — ${step.detail}`);
  });

  return lines.join('\n');
}

export default function InspectionReportScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const shareText = useMemo(
    () => (inspection ? buildShareText(inspection) : ''),
    [inspection],
  );

  async function handleShare() {
    if (!shareText) return;
    try {
      await Share.share({ message: shareText });
    } catch {
      // The user dismissing the share sheet is not an error worth surfacing.
    }
  }

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

  const damageLabel = inspection.damageType
    ? DAMAGE_TYPE_LABEL[inspection.damageType] ?? inspection.damageType
    : 'Storm-related damage';
  const storm = inspection.stormConfirmedRef;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.headerCard, { backgroundColor: colors.secondary }]}>
        <Text style={styles.headerEyebrow}>PRELIMINARY SUMMARY</Text>
        <Text style={styles.headerTitle}>{inspection.address ?? 'Your property'}</Text>
        <Text style={styles.headerSub}>A quick summary of what we found and what comes next.</Text>
      </View>

      <Text style={[styles.section, { color: colors.foreground }]}>Damage found</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.rowIcon}>
          <View style={[styles.iconBubble, { backgroundColor: colors.accent }]}>
            <Icon name="alert-circle" size={18} color={colors.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{damageLabel}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Observed during the preliminary roof review.
            </Text>
          </View>
        </View>
      </View>

      <Text style={[styles.section, { color: colors.foreground }]}>Weather event</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.rowIcon}>
          <View style={[styles.iconBubble, { backgroundColor: colors.accent }]}>
            <Icon name="cloud" size={18} color={colors.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            {storm ? (
              <>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {storm.type} · {storm.date}
                </Text>
                {storm.description ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {storm.description}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                A severe-weather event has not been matched yet.
              </Text>
            )}
          </View>
        </View>
      </View>

      <Text style={[styles.section, { color: colors.foreground }]}>Next steps</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {NEXT_STEPS.map((step, i) => (
          <View key={step.title} style={styles.stepRow}>
            <View style={[styles.stepNumber, { backgroundColor: colors.primary }]}>
              <Text style={[styles.stepNumberText, { color: colors.primaryForeground }]}>
                {i + 1}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{step.title}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{step.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={handleShare}
        style={[styles.shareBtn, { backgroundColor: colors.primary }]}
      >
        <Icon name="upload" size={18} color={colors.primaryForeground} />
        <Text style={[styles.shareText, { color: colors.primaryForeground }]}>
          Share this summary
        </Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerCard: { borderRadius: 16, padding: 18, gap: 4 },
  headerEyebrow: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 14 },
  rowIcon: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBubble: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNumber: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 13, fontWeight: '800' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 14,
  },
  shareText: { fontSize: 16, fontWeight: '700' },
});
