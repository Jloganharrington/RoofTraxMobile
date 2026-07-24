import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { Icon } from '@/components/Icon';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';

// AI Summary step — lets the inspector trigger a Claude Sonnet analysis of all
// inspection findings and review the generated narrative before submitting.
// The summary is persisted server-side so it survives app restarts.

type Summary = {
  forensicSummary: string;
  repairabilityText: string;
  generatedAt: string;
};

export default function InspectionSummaryScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Regenerate modal
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenSaving, setRegenSaving] = useState(false);

  /** Fetch stored summary from the server. */
  const loadSummary = useCallback(async () => {
    try {
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/inspections/${id}/summary`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { summary: Summary | null };
      setSummary(data.summary);
    } catch {
      // If it fails just leave summary as null — user can still generate
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  /** Call the server to generate (or regenerate) the AI summary. */
  async function generate(userPrompt = '') {
    setGenerating(true);
    try {
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/inspections/${id}/summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(userPrompt ? { userPrompt } : {}),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { summary: Summary };
      setSummary(data.summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Try again.';
      Alert.alert('Generation failed', message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegen() {
    setRegenSaving(true);
    const prompt = regenPrompt.trim();
    setRegenOpen(false);
    setRegenPrompt('');
    await generate(prompt);
    setRegenSaving(false);
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      {/* Regenerate modal */}
      <Modal
        visible={regenOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setRegenOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Regenerate Summary
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>
              Optionally focus the AI on a specific aspect (e.g. "emphasize hail damage on F2
              and F3"). Leave blank to regenerate with the standard approach.
            </Text>
            <TextInput
              style={[
                styles.promptInput,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              placeholder="Additional focus (optional)"
              placeholderTextColor={colors.mutedForeground}
              value={regenPrompt}
              onChangeText={setRegenPrompt}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                onPress={() => { setRegenOpen(false); setRegenPrompt(''); }}
                style={[styles.modalBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Text style={{ color: colors.foreground, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleRegen}
                disabled={regenSaving}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: regenSaving ? 0.6 : 1 }]}
              >
                <Icon name="zap" size={15} color={colors.primaryForeground} />
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Regenerate</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={[styles.headerCard, { backgroundColor: colors.secondary }]}>
          <View style={styles.headerRow}>
            <Icon name="zap" size={22} color="#fff" />
            <Text style={styles.headerTitle}>AI Summary</Text>
          </View>
          <Text style={styles.headerSub}>
            Claude Sonnet reviews your captured findings and drafts a forensic narrative and
            repairability assessment.
          </Text>
        </View>

        {/* Not yet generated */}
        {!summary && !generating && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.emptyRow}>
              <Icon name="file-text" size={28} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No summary yet
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
              Tap below to send your inspection findings to Claude Sonnet. The result is saved
              and available offline once generated.
            </Text>
            <Pressable
              onPress={() => generate()}
              style={[styles.generateBtn, { backgroundColor: colors.primary }]}
            >
              <Icon name="zap" size={18} color={colors.primaryForeground} />
              <Text style={[styles.generateBtnText, { color: colors.primaryForeground }]}>
                Send findings for analysis
              </Text>
            </Pressable>
          </View>
        )}

        {/* Generating spinner */}
        {generating && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', gap: 12 }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 15 }}>
              Analyzing findings…
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: 'center' }}>
              Claude Sonnet is reviewing your inspection data. This usually takes 10–20 seconds.
            </Text>
          </View>
        )}

        {/* Summary result */}
        {summary && !generating && (
          <>
            {/* Generated-at banner */}
            <View style={[styles.genBanner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
              <Icon name="check" size={15} color={colors.success} />
              <Text style={{ color: colors.success, fontSize: 12, fontWeight: '600', flex: 1 }}>
                Generated {new Date(summary.generatedAt).toLocaleString()}
              </Text>
              <Pressable
                onPress={() => setRegenOpen(true)}
                style={[styles.regenBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Icon name="refresh-cw" size={13} color={colors.foreground} />
                <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '600' }}>Regenerate</Text>
              </Pressable>
            </View>

            {/* Forensic Summary */}
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.sectionHeader}>
                <Icon name="file-text" size={16} color={colors.foreground} />
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Forensic Summary</Text>
              </View>
              <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 22 }}>
                {summary.forensicSummary}
              </Text>
            </View>

            {/* Repairability Assessment */}
            {summary.repairabilityText ? (
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.sectionHeader}>
                  <Icon name="tool" size={16} color={colors.foreground} />
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Repairability Assessment</Text>
                </View>
                <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 22 }}>
                  {summary.repairabilityText}
                </Text>
              </View>
            ) : null}

            {/* Bottom regen shortcut */}
            <Pressable
              onPress={() => setRegenOpen(true)}
              style={[styles.regenFullBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Icon name="refresh-cw" size={16} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 14, fontWeight: '600' }}>
                Regenerate with focus
              </Text>
            </Pressable>
          </>
        )}

        {/* Continue to the Estimate step */}
        <Pressable
          onPress={() => router.push({ pathname: '/inspection-estimate', params: { id } } as never)}
          style={[styles.continueBtn, { backgroundColor: colors.secondary }]}
        >
          <Text style={styles.continueBtnText}>Continue to Estimate</Text>
          <Icon name="chevron-right" size={18} color="#fff" />
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerCard: { borderRadius: 16, padding: 18, gap: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 18, marginTop: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 20, gap: 12, alignItems: 'center' },
  emptyRow: { marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 4,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  generateBtnText: { fontSize: 15, fontWeight: '700' },
  genBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  sectionCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  regenFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  continueBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    borderRadius: 18,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  promptInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
});
