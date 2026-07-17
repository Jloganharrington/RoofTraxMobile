import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetInspectionQueryKey,
  useGetInspection,
  usePreflightInspection,
} from '@workspace/api-client-react';
import type {
  Inspection,
  PreflightResult,
  SubmissionManifestV1,
} from '@workspace/api-client-react';
import { STAGE_DEFINITIONS, type Stage } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/hooks/useProfile';
import { confirmFinalReview, submitInspection } from '@/lib/inspectionSync';
import { buildProtocolState, evaluateInspection } from '@/lib/inspectionProtocolState';
import { countUnsyncedWritesForInspection } from '@/lib/outbox/queue';
import { drainOutbox } from '@/lib/outbox/drain';

// E4 — Readiness. This is the centerpiece: it runs the SHARED gate engine
// (evaluate) over the assembled capture state and shows exactly what still
// blocks submission (hard deficiencies) versus what merely warrants review
// (soft flags). The app derives nothing itself — it renders the engine's
// verdict. E6 (final-review confirm + submit) lives at the bottom, unlocked
// only once every hard gate but the submit step is clear.

// Stages the field rep can jump to in order to clear a deficiency. the submit step is
// resolved in-place here (final-review confirm), so it is intentionally absent.
const STAGE_FIX_ROUTES: Partial<Record<Stage, string>> = {
  arrival: '/inspection-arrival',
  elevation_access: '/inspection-elevations',
  facets: '/inspection-roof',
  test_squares: '/inspection-test-squares',
  components: '/inspection-components',
  collateral: '/inspection-collateral',
  product: '/inspection-product',
  interior: '/inspection-interior',
  homeowner: '/inspection-homeowner',
  declaration: '/inspection-declaration',
};

function assembleManifest(
  inspection: Inspection,
  gate: ReturnType<typeof evaluateInspection>,
  signature: { url: string; sha256: string; signedAt: string | null } | null,
): SubmissionManifestV1 {
  const photos = inspection.photos ?? [];
  const records: Record<string, string[]> = {
    elevations: (inspection.elevations ?? []).map((r) => r.id),
    slopes: (inspection.slopes ?? []).map((r) => r.id),
    damageInstances: (inspection.damageInstances ?? []).map((r) => r.id),
    testSquares: (inspection.testSquares ?? []).map((r) => r.id),
    testSquareHits: (inspection.testSquareHits ?? []).map((r) => r.id),
    components: (inspection.components ?? []).map((r) => r.id),
    penetrations: (inspection.penetrations ?? []).map((r) => r.id),
    products: (inspection.products ?? []).map((r) => r.id),
    measurements: (inspection.measurements ?? []).map((r) => r.id),
    interiorObservations: (inspection.interiorObservations ?? []).map((r) => r.id),
    attestations: (inspection.attestations ?? []).map((r) => r.id),
    photos: photos.map((r) => r.id),
  };
  return {
    protocolVersion: 'v1',
    generatedAtUtc: new Date().toISOString(),
    records,
    photoHashes: photos
      .filter((p) => p.sha256)
      .map((p) => ({ photoId: p.id, sha256: p.sha256 as string })),
    gateResults: { deficiencies: gate.deficiencies, softFlags: gate.softFlags },
    // M-F (F0) — carry the inspector's on-file signature so the package is
    // self-contained. The server is the source of truth and re-stamps this from
    // the profile, but including it keeps the client-assembled manifest complete.
    signatureOnFile: signature
      ? { url: signature.url, sha256: signature.sha256, signedAt: signature.signedAt }
      : null,
  };
}

export default function InspectionReadinessScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signatureUrl, signatureSha256, signatureSignedAt } = useProfile();
  const hasSignatureOnFile = !!signatureUrl && !!signatureSha256;

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingWrites, setPendingWrites] = React.useState<number | null>(null);

  // M-F (F1) — on-site pre-flight. Runs the server's authoritative gate re-run
  // so the inspector can catch a deficiency the client might have missed BEFORE
  // leaving the property. Distinct from the local gate below (which drives the
  // live UI): this proves the server will accept the package.
  const preflight = usePreflightInspection();
  const [preflightResult, setPreflightResult] = React.useState<PreflightResult | null>(null);
  const [preflightError, setPreflightError] = React.useState<string | null>(null);

  async function onRunPreflight() {
    setPreflightError(null);
    try {
      const res = await preflight.mutateAsync({ inspectionId: id });
      setPreflightResult(res.preflight);
    } catch {
      setPreflightError('Could not reach the server for a pre-flight check. Try again on-site.');
    }
  }

  // Poll the outbox for still-unsynced captures on this inspection. Submit is
  // blocked until this is zero, so the manifest never references a child record
  // that has not durably persisted server-side. We also nudge a drain each
  // tick so an online device converges to zero without user action.
  React.useEffect(() => {
    let active = true;
    async function refresh() {
      const count = await countUnsyncedWritesForInspection(id);
      if (!active) return;
      setPendingWrites(count);
      if (count > 0) void drainOutbox();
    }
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Readiness' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Readiness' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const gate = evaluateInspection(inspection);
  const { deficiencies, softFlags } = gate;
  const submitted = inspection.status === 'submitted' || inspection.status === 'package_ready';

  // S9 (final review) is the last hard gate the rep clears here. Everything
  // else must be green before the confirm unlocks; once S9 is filed too, the
  // deficiency list is empty and submit unlocks.
  const nonFinalDeficiencies = deficiencies.filter((d) => d.stage !== 'submit');
  const canConfirmFinalReview =
    nonFinalDeficiencies.length === 0 && !state.finalReviewConfirmed;
  // pendingWrites === null means we haven't finished the first outbox read yet;
  // treat that as "not clear" so we never assemble a manifest prematurely.
  const packageSynced = pendingWrites === 0;
  // M-F (F0) — the server rejects submission without a signature on file, so
  // gate submit on it here too and surface the fix path.
  const canSubmit =
    deficiencies.length === 0 && !submitted && packageSynced && hasSignatureOnFile;

  async function onConfirmFinalReview() {
    if (!user || confirming) return;
    setConfirming(true);
    try {
      await confirmFinalReview(queryClient, id, user.id);
    } finally {
      setConfirming(false);
    }
  }

  async function onSubmit() {
    if (submitting || !inspection) return;
    setSubmitting(true);
    try {
      const signature =
        signatureUrl && signatureSha256
          ? { url: signatureUrl, sha256: signatureSha256, signedAt: signatureSignedAt ?? null }
          : null;
      const manifest = assembleManifest(inspection, gate, signature);
      await submitInspection(queryClient, id, manifest);
      router.back();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Readiness' }} />

      {submitted ? (
        <>
          <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
            <Icon name="check" size={22} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.foreground }]}>Package submitted</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                This inspection has been submitted for review.
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/inspection-package', params: { id } } as never)
            }
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Icon name="file-text" size={20} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                View package status & receipt
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Track processing and see what was received.
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        </>
      ) : deficiencies.length === 0 ? (
        <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
          <Icon name="check" size={22} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>Ready to submit</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Every capture gate is satisfied.
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
          <Icon name="alert-circle" size={22} color="#b45309" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: '#92400e' }]}>
              {deficiencies.length} gate{deficiencies.length === 1 ? '' : 's'} remaining
            </Text>
            <Text style={{ color: '#92400e', fontSize: 13 }}>
              Clear every blocking gate below before the package can be submitted.
            </Text>
          </View>
        </View>
      )}

      {deficiencies.length > 0 ? (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Blocking gates</Text>
          {deficiencies.map((d) => {
            const route = STAGE_FIX_ROUTES[d.stage];
            return (
              <Pressable
                key={`${d.stage}-${d.code}`}
                disabled={!route}
                onPress={() =>
                  route && router.push({ pathname: route as Href, params: { id } } as never)
                }
                style={[styles.row, { backgroundColor: colors.card, borderColor: '#f59e0b' }]}
              >
                <View style={[styles.badge, { backgroundColor: '#fffbeb' }]}>
                  <Text style={styles.stageTag}>{d.stage}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {STAGE_DEFINITIONS[d.stage].name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{d.message}</Text>
                </View>
                {route ? <Icon name="chevron-right" size={20} color={colors.mutedForeground} /> : null}
              </Pressable>
            );
          })}
        </>
      ) : null}

      {softFlags.length > 0 ? (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Review flags (non-blocking)</Text>
          {softFlags.map((f) => (
            <View
              key={`${f.stage}-${f.code}`}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.stageTag, { color: colors.secondary }]}>{f.stage}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {STAGE_DEFINITIONS[f.stage].name}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{f.message}</Text>
              </View>
            </View>
          ))}
        </>
      ) : null}

      {!submitted ? (
        <>
          <Text style={[styles.section, { color: colors.foreground }]}>Finalize</Text>
          <View style={[styles.finalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.finalStep}>
              <Icon
                name={state.finalReviewConfirmed ? 'check' : 'clipboard'}
                size={18}
                color={state.finalReviewConfirmed ? colors.success : colors.mutedForeground}
              />
              <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>
                {state.finalReviewConfirmed
                  ? 'Final review confirmed (final review)'
                  : 'Confirm you have reviewed the full package (final review)'}
              </Text>
            </View>
            {!state.finalReviewConfirmed ? (
              <Pressable
                onPress={onConfirmFinalReview}
                disabled={!canConfirmFinalReview || confirming}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: colors.secondary,
                    opacity: !canConfirmFinalReview || confirming ? 0.5 : 1,
                  },
                ]}
              >
                {confirming ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.actionText}>
                    {canConfirmFinalReview
                      ? 'Confirm package ready'
                      : 'Clear the gates above first'}
                  </Text>
                )}
              </Pressable>
            ) : null}

            {deficiencies.length === 0 && !packageSynced ? (
              <View style={styles.finalStep}>
                <ActivityIndicator color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
                  {pendingWrites === null
                    ? 'Checking captured evidence…'
                    : `Uploading ${pendingWrites} captured item${pendingWrites === 1 ? '' : 's'} — submit unlocks once the package is fully synced.`}
                </Text>
              </View>
            ) : null}

            {/* M-F (F1) — on-site pre-flight. Ask the server to re-run the gate
                before leaving, so a server-side deficiency surfaces here rather
                than at submit. */}
            <View style={styles.finalStep}>
              <Icon name="server" size={18} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>
                Pre-flight check (server-verified)
              </Text>
            </View>
            <Pressable
              onPress={onRunPreflight}
              disabled={preflight.isPending}
              style={[
                styles.actionBtn,
                { backgroundColor: colors.secondary, opacity: preflight.isPending ? 0.6 : 1 },
              ]}
            >
              {preflight.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.actionText}>Run pre-flight check</Text>
              )}
            </Pressable>
            {preflightError ? (
              <Text style={{ color: colors.destructive, fontSize: 13 }}>{preflightError}</Text>
            ) : null}
            {preflightResult ? (
              preflightResult.deficiencies.length === 0 ? (
                <View style={styles.finalStep}>
                  <Icon name="check" size={16} color={colors.success} />
                  <Text style={{ color: colors.success, flex: 1, fontSize: 13, fontWeight: '600' }}>
                    Server pre-flight passed — no blocking gates.
                    {preflightResult.softFlags.length > 0
                      ? ` ${preflightResult.softFlags.length} review flag${preflightResult.softFlags.length === 1 ? '' : 's'} (non-blocking).`
                      : ''}
                  </Text>
                </View>
              ) : (
                <View style={styles.finalStep}>
                  <Icon name="alert-circle" size={16} color="#b45309" />
                  <Text style={{ color: '#92400e', flex: 1, fontSize: 13 }}>
                    Server found {preflightResult.deficiencies.length} blocking gate
                    {preflightResult.deficiencies.length === 1 ? '' : 's'}:{' '}
                    {preflightResult.deficiencies.map((d) => `${d.stage} ${d.message}`).join('; ')}
                  </Text>
                </View>
              )
            ) : null}

            {!hasSignatureOnFile ? (
              <Pressable
                onPress={() => router.push('/(tabs)/profile')}
                style={[styles.finalStep, { paddingVertical: 4 }]}
              >
                <Icon name="edit-3" size={16} color="#b45309" />
                <Text style={{ color: '#92400e', flex: 1, fontSize: 13 }}>
                  You have no signature on file. Tap to set one up — required before you can submit.
                </Text>
                <Icon name="chevron-right" size={18} color="#b45309" />
              </Pressable>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit || submitting}
              style={[
                styles.actionBtn,
                { backgroundColor: colors.primary, opacity: !canSubmit || submitting ? 0.5 : 1 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.actionText, { color: colors.primaryForeground }]}>
                  Submit inspection package
                </Text>
              )}
            </Pressable>
          </View>
        </>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stageTag: { fontSize: 13, fontWeight: '800', color: '#b45309' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  finalCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  finalStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
