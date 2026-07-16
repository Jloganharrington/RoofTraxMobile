import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { DAMAGE_TYPE_LABEL } from '@/lib/preliminary';
import { generateHomeownerReportPdf, shareHomeownerReport } from '@/lib/homeownerReport';

// P3 — the homeowner report. This screen previews the Phase 1 findings, then
// turns everything captured — property, damage type, matched storm, homeowner
// facts, and the four evidence photos — into a PDF. The flow is two steps:
//   1. Generate the report (builds the PDF on-device; that PDF IS the summary).
//   2. Share it via the device's share sheet, which includes Mail/email.
// It is deliberately NOT a quote or a coverage opinion.
const NEXT_STEPS: Array<{ title: string; detail: string }> = [
  { title: 'File a claim', detail: 'Open a claim with your insurance carrier for the storm date noted above.' },
  { title: 'Pay for a forensic inspection', detail: 'Authorize the detailed, documented forensic roof inspection.' },
  { title: 'Forensic inspection', detail: 'A full evidence capture of every slope, elevation, and damaged component.' },
  { title: 'Proof package', detail: 'The findings are compiled into a documented, photo-backed report.' },
  { title: 'Claim negotiation', detail: 'The proof package supports the conversation with your carrier.' },
];

export default function InspectionReportScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'generate' | 'share'>(null);

  async function handleGenerate() {
    if (!inspection || busy) return;
    setBusy('generate');
    try {
      const uri = await generateHomeownerReportPdf(inspection);
      setPdfUri(uri);
    } catch (err) {
      console.warn('[report] generate failed', err);
      Alert.alert('Could not create report', 'Something went wrong generating the PDF. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!pdfUri || busy) return;
    setBusy('share');
    try {
      await shareHomeownerReport(pdfUri);
    } catch (err) {
      console.warn('[report] share failed', err);
      Alert.alert('Could not share report', 'Something went wrong opening the share sheet. Try again.');
    } finally {
      setBusy(null);
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
  const facts = inspection.homeownerFacts;
  const photoCount = (inspection.photos ?? []).filter((p) => p.preliminaryRole).length;

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

      {facts ? (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Homeowner-reported facts</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <FactRow
              label="Aware of the date of loss"
              value={facts.awareOfDateOfLoss === true ? 'Yes' : facts.awareOfDateOfLoss === false ? 'No' : 'Unsure'}
              colors={colors}
            />
            {facts.priorRepairs ? (
              <FactRow label="Prior repairs reported" value={facts.priorRepairs} colors={colors} />
            ) : null}
            {facts.priorClaims ? (
              <FactRow label="Prior claims reported" value={facts.priorClaims} colors={colors} />
            ) : null}
          </View>
        </>
      ) : null}

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

      <Text style={[styles.section, { color: colors.foreground }]}>Homeowner report</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {pdfUri ? (
          <>
            <View style={styles.rowIcon}>
              <View style={[styles.iconBubble, { backgroundColor: colors.accent }]}>
                <Icon name="check" size={18} color={colors.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Report ready</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  PDF with the summary above and all {photoCount} photo{photoCount === 1 ? '' : 's'}.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleShare}
              disabled={!!busy}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
            >
              {busy === 'share' ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Icon name="upload" size={18} color={colors.primaryForeground} />
                  <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Share report</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={handleGenerate}
              disabled={!!busy}
              style={[styles.secondaryBtn, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
            >
              {busy === 'generate' ? (
                <ActivityIndicator color={colors.foreground} />
              ) : (
                <Text style={[styles.btnText, { color: colors.foreground }]}>Regenerate</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Generate a PDF with the summary above and all {photoCount} photo
              {photoCount === 1 ? '' : 's'}. You can share it once it's ready.
            </Text>
            <Pressable
              onPress={handleGenerate}
              disabled={!!busy}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
            >
              {busy === 'generate' ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Icon name="file-text" size={18} color={colors.primaryForeground} />
                  <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Generate report</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function FactRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.factRow}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
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
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  btnText: { fontSize: 16, fontWeight: '700' },
});
