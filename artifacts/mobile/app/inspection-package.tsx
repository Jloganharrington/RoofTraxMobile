import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  getGetInspectionQueryKey,
  getGetInspectionStatusQueryKey,
  useGetInspection,
  useGetInspectionStatus,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import { File as FSFile, Paths, Directory } from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useGetAgreement, useEmailAgreement, useVoidAgreement } from '@/lib/agreementApi';

// M-F (F3) — Status & package receipt. Polls the server for this inspection's
// submission status and a clearly-labeled receipt showing what intake
// verified (record + verified-photo counts). It never fabricates a finished
// package.

const STATUS_LABELS: Record<string, string> = {
  capturing: 'Capturing evidence',
  submitted: 'Submitted — awaiting processing',
  package_ready: 'Package ready',
};

export default function InspectionPackageScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useProfile();
  const isSuperAdmin = role === 'super_admin';
  const isManagerOrAdmin = role === 'manager' || role === 'admin' || role === 'super_admin';

  const statusQuery = useGetInspectionStatus(id, {
    query: {
      queryKey: getGetInspectionStatusQueryKey(id),
      // Poll while the package is in flight so the receipt appears without a
      // manual refresh once the server finishes intake.
      refetchInterval: 5000,
    },
  });

  // Fetch the inspection itself so we know the phase (forensic vs preliminary).
  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  // Agreement status — forensic inspections only.
  const isForensic = inspection?.phase === 'forensic';
  const agreementQuery = useGetAgreement(id);

  const emailAgreement = useEmailAgreement();
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');

  const voidAgreement = useVoidAgreement();
  const [showVoidInput, setShowVoidInput] = useState(false);
  const [voidReasonText, setVoidReasonText] = useState('');

  // Report compilation state
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Content-lint state for the latest compiled version. The server lints
  // every AI fragment against the contractor-lane policy; `blocked` prevents
  // export until a manager resolves or a clean re-compile passes.
  type LintFinding = { fragmentRef: string; ruleId: string; matchedText: string; severity: string };
  const [lintStatus, setLintStatus] = useState<'passed' | 'needs_review' | 'blocked' | null>(null);
  const [lintFindings, setLintFindings] = useState<LintFinding[]>([]);
  const [lintResolved, setLintResolved] = useState(false);
  const [resolving, setResolving] = useState(false);

  const refreshLint = useCallback(async () => {
    try {
      const token = await getToken('auth_session_token');
      const res = await fetch(`${getApiBaseUrl()}/inspections/${id}/report/lint`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        lintStatus: 'passed' | 'needs_review' | 'blocked';
        findings: LintFinding[];
        resolution: { path: string } | null;
      };
      setLintStatus(body.lintStatus);
      setLintFindings(body.findings ?? []);
      setLintResolved(body.resolution != null);
    } catch {
      // Non-fatal: lint banner just stays hidden offline.
    }
  }, [id]);

  useEffect(() => {
    if (inspection?.compiledReportReadyAt) void refreshLint();
  }, [inspection?.compiledReportReadyAt, refreshLint]);

  async function handleResolveLint() {
    if (resolving) return;
    setResolving(true);
    try {
      const token = await getToken('auth_session_token');
      const res = await fetch(`${getApiBaseUrl()}/inspections/${id}/report/lint-resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      await refreshLint();
    } catch (err) {
      Alert.alert('Could not resolve', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setResolving(false);
    }
  }

  async function handleCompileReport() {
    if (compiling) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const token = await getToken('auth_session_token');
      const res = await fetch(`${getApiBaseUrl()}/inspections/${id}/report/compile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        lintStatus?: 'passed' | 'needs_review' | 'blocked';
        findings?: LintFinding[];
      };
      if (body.lintStatus) {
        setLintStatus(body.lintStatus);
        setLintFindings(body.findings ?? []);
        setLintResolved(false); // a new compile always re-enters the gate
      }
      // Refresh the inspection so compiledReportReadyAt updates.
      await queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) });
    } catch (err) {
      setCompileError(err instanceof Error ? err.message : 'Report compilation failed');
    } finally {
      setCompiling(false);
    }
  }

  const handleEmailAgreement = async () => {
    const trimmed = emailRecipient.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    emailAgreement.mutate(
      { inspectionId: id, recipient: trimmed },
      {
        onSuccess: async (result) => {
          if (result.sent) {
            setShowEmailInput(false);
            setEmailRecipient('');
            Alert.alert('Sent', `Agreement emailed to ${trimmed}.`);
          } else if (result.noSmtp) {
            // No SMTP configured — fall back to device mail composer
            const downloadUrl = agreementQuery.data?.agreement?.downloadUrl;
            if (!downloadUrl) {
              Alert.alert(
                'No email configured',
                'SMTP is not set up on your profile and no download URL is available. Configure SMTP in your profile settings to email the agreement.',
              );
              return;
            }
            try {
              // Download to cache using the new expo-file-system API
              const destDir = new Directory(Paths.cache) as unknown as { uri: string };
              const downloaded = await (FSFile as unknown as {
                downloadFileAsync(url: string, dest: unknown, opts?: unknown): Promise<{ uri: string }>;
              }).downloadFileAsync(downloadUrl, destDir, { idempotent: true });
              const available = await MailComposer.isAvailableAsync();
              if (!available) {
                Alert.alert(
                  'Mail unavailable',
                  'No mail account is configured on this device. Set up SMTP in your profile or add a mail account.',
                );
                return;
              }
              await MailComposer.composeAsync({
                recipients: [trimmed],
                subject: `Forensic Inspection Purchase & Sale Agreement — ${inspection?.address ?? 'your property'}`,
                body: 'Thank you for signing the Forensic Inspection Purchase & Sale Agreement. A copy is attached for your records.',
                attachments: [downloaded.uri],
              });
              setShowEmailInput(false);
              setEmailRecipient('');
            } catch {
              Alert.alert('Error', 'Could not open mail composer. Please try again.');
            }
          }
        },
        onError: (err) => {
          Alert.alert('Error', err.message ?? 'Failed to send the agreement email.');
        },
      },
    );
  };

  const handleVoidAgreement = () => {
    if (voidReasonText.trim().length < 5) {
      Alert.alert('Reason required', 'Please enter a reason of at least 5 characters.');
      return;
    }
    Alert.alert(
      'Void signed agreement?',
      'This will mark the agreement as voided and allow a replacement to be collected. This action is permanent and audit-logged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void agreement',
          style: 'destructive',
          onPress: () => {
            voidAgreement.mutate(
              { inspectionId: id, voidReason: voidReasonText.trim() },
              {
                onSuccess: () => {
                  setShowVoidInput(false);
                  setVoidReasonText('');
                },
                onError: (err) => {
                  Alert.alert('Error', err.message ?? 'Failed to void agreement');
                },
              },
            );
          },
        },
      ],
    );
  };

  const data = statusQuery.data;

  if (statusQuery.isLoading && !data) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Package status' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Package status' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
          Status unavailable. Check your connection.
        </Text>
      </View>
    );
  }

  const receipt = data.receipt;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Package status' }} />

      {/* Submission status */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Icon name="file-text" size={20} color={colors.foreground} />
          <Text style={[styles.title, { color: colors.foreground }]}>Submission status</Text>
        </View>
        <Text style={[styles.status, { color: colors.secondary }]}>
          {STATUS_LABELS[data.status] ?? data.status}
        </Text>
        {data.lockedAt ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Locked {new Date(data.lockedAt).toLocaleString()} — the record is now immutable;
            corrections are filed as addenda.
          </Text>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Not yet submitted. Once submitted, the record locks and a receipt appears here.
          </Text>
        )}
      </View>

      {/* Receipt */}
      {receipt ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="check" size={20} color={colors.success} />
            <Text style={[styles.title, { color: colors.foreground }]}>{receipt.label}</Text>
            {receipt.isStub ? (
              <View style={[styles.stubBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.stubText, { color: colors.foreground }]}>Preview</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {receipt.message}
          </Text>
          <View style={styles.statRow}>
            <View style={[styles.statCell, { borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {receipt.recordCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Records received
              </Text>
            </View>
            <View style={[styles.statCell, { borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {receipt.verifiedPhotoCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Photos verified
              </Text>
            </View>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
            Receipt generated {new Date(receipt.generatedAtUtc).toLocaleString()}
          </Text>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No receipt yet — the package receipt appears once the inspection is submitted and its
            evidence verified at intake.
          </Text>
        </View>
      )}

      {/* Compiled Forensic Report card — forensic inspections only */}
      {isForensic && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="file-text" size={20} color={colors.foreground} />
            <Text style={[styles.title, { color: colors.foreground }]}>Forensic report</Text>
            {inspection?.compiledReportReadyAt ? (
              <View style={[styles.stubBadge, { backgroundColor: '#dcfce7' }]}>
                <Text style={[styles.stubText, { color: '#166534' }]}>Ready</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {inspection?.compiledReportReadyAt
              ? `Last compiled ${new Date(inspection.compiledReportReadyAt).toLocaleString()}.`
              : 'Use Gemini to compile the HTML forensic report from all captured data and the AI summary.'}
          </Text>

          {compileError ? (
            <Text style={{ color: colors.destructive, fontSize: 12 }}>{compileError}</Text>
          ) : null}

          {/* Content-lint banner — surfaces contractor-lane policy findings */}
          {lintStatus && lintStatus !== 'passed' ? (
            <View
              style={{
                borderRadius: 8,
                padding: 10,
                gap: 6,
                backgroundColor: lintStatus === 'blocked' && !lintResolved ? '#fee2e2' : '#fef9c3',
              }}
            >
              <Text
                style={{
                  fontWeight: '700',
                  fontSize: 13,
                  color: lintStatus === 'blocked' && !lintResolved ? '#991b1b' : '#854d0e',
                }}
              >
                {lintStatus === 'blocked'
                  ? lintResolved
                    ? 'Blocked content resolved by a reviewer — export allowed'
                    : 'Export blocked: report contains insurance-advocacy or legal language'
                  : 'Needs review: report contains language a reviewer should check'}
              </Text>
              {lintFindings.slice(0, 5).map((f, i) => (
                <Text key={i} style={{ fontSize: 12, color: '#57534e' }}>
                  • {f.fragmentRef} — {f.ruleId}: “{f.matchedText}”
                </Text>
              ))}
              {lintFindings.length > 5 ? (
                <Text style={{ fontSize: 12, color: '#57534e' }}>
                  …and {lintFindings.length - 5} more
                </Text>
              ) : null}
              {lintStatus === 'blocked' && !lintResolved ? (
                <Text style={{ fontSize: 12, color: '#57534e' }}>
                  Re-compile after regenerating the AI summary
                  {isManagerOrAdmin ? ', or resolve explicitly to allow export as-is.' : '. A manager can also resolve it explicitly.'}
                </Text>
              ) : null}
              {lintStatus === 'blocked' && !lintResolved && isManagerOrAdmin ? (
                <Pressable
                  onPress={handleResolveLint}
                  disabled={resolving}
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: '#991b1b',
                    borderRadius: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    opacity: resolving ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                    {resolving ? 'Resolving…' : 'Resolve & allow export'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={handleCompileReport}
              disabled={compiling}
              style={[
                styles.reportBtn,
                {
                  backgroundColor: colors.secondary,
                  opacity: compiling ? 0.6 : 1,
                  flex: inspection?.compiledReportReadyAt ? 1 : undefined,
                },
              ]}
            >
              {compiling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="cpu" size={14} color="#fff" />
              )}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                {compiling ? 'Compiling…' : inspection?.compiledReportReadyAt ? 'Re-compile' : 'Compile Report'}
              </Text>
            </Pressable>

            {inspection?.compiledReportReadyAt ? (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/inspection-compiled-report',
                    params: { id },
                  } as never)
                }
                style={[styles.reportBtn, { backgroundColor: colors.primary, flex: 1 }]}
              >
                <Icon name="eye" size={14} color={colors.primaryForeground} />
                <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 13 }}>
                  Preview Report
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {/* Forensic agreement card */}
      {isForensic && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="edit-3" size={20} color={colors.foreground} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Homeowner agreement
            </Text>
          </View>

          {agreementQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : agreementQuery.data?.agreement?.voidedAt ? (
            // ── Voided state ─────────────────────────────────────────────────
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="slash" size={16} color={colors.destructive} />
                <Text style={{ color: colors.destructive, fontWeight: '700', fontSize: 14 }}>
                  Voided — re-sign required
                </Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Previously signed by {agreementQuery.data.agreement.signerName} on{' '}
                {new Date(agreementQuery.data.agreement.signedAt).toLocaleString()}.
              </Text>
              {agreementQuery.data.agreement.voidReason ? (
                <View
                  style={[
                    styles.errorBox,
                    { backgroundColor: colors.destructive + '18', borderColor: colors.destructive + '40' },
                  ]}
                >
                  <Text style={{ color: colors.destructive, fontSize: 12, lineHeight: 17 }}>
                    Void reason: {agreementQuery.data.agreement.voidReason}
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/inspection-agreement', params: { id } } as never)
                }
                style={[styles.signBtn, { backgroundColor: colors.primary }]}
              >
                <Icon name="edit-3" size={16} color={colors.primaryForeground} />
                <Text style={[styles.signBtnText, { color: colors.primaryForeground }]}>
                  Collect Replacement Signature
                </Text>
              </Pressable>
            </>
          ) : agreementQuery.data?.agreement ? (
            // ── Signed (active) state ─────────────────────────────────────────
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={16} color={colors.success} />
                <Text style={{ color: colors.success, fontWeight: '700', fontSize: 14 }}>
                  Agreement signed
                </Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Signed by {agreementQuery.data.agreement.signerName} on{' '}
                {new Date(agreementQuery.data.agreement.signedAt).toLocaleString()}.
              </Text>
              {agreementQuery.data.agreement.downloadUrl ? (
                <Pressable
                  onPress={() => {
                    const url = agreementQuery.data?.agreement?.downloadUrl;
                    if (url) Linking.openURL(url);
                  }}
                  style={[styles.viewPdfBtn, { borderColor: colors.border }]}
                >
                  <Icon name="file-text" size={16} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14 }}>
                    View PDF
                  </Text>
                </Pressable>
              ) : null}

              {/* Email to homeowner */}
              {!showEmailInput ? (
                <Pressable
                  onPress={() => setShowEmailInput(true)}
                  style={[styles.emailBtn, { borderColor: colors.border }]}
                >
                  <Icon name="mail" size={15} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 13 }}>
                    Email agreement to homeowner
                  </Text>
                  {agreementQuery.data?.agreement?.emailedAt ? (
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                      (sent {new Date(agreementQuery.data.agreement.emailedAt).toLocaleDateString()})
                    </Text>
                  ) : null}
                </Pressable>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    Homeowner email address:
                  </Text>
                  <TextInput
                    value={emailRecipient}
                    onChangeText={setEmailRecipient}
                    placeholder="homeowner@example.com"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.voidInput,
                      {
                        color: colors.foreground,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                        minHeight: 44,
                      },
                    ]}
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => { setShowEmailInput(false); setEmailRecipient(''); }}
                      style={[styles.voidCancelBtn, { borderColor: colors.border }]}
                    >
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleEmailAgreement}
                      disabled={emailAgreement.isPending}
                      style={[
                        styles.voidConfirmBtn,
                        {
                          backgroundColor: colors.primary,
                          opacity: emailAgreement.isPending ? 0.6 : 1,
                        },
                      ]}
                    >
                      {emailAgreement.isPending ? (
                        <ActivityIndicator size="small" color={colors.primaryForeground} />
                      ) : (
                        <Text style={{ color: colors.primaryForeground, fontSize: 13, fontWeight: '700' }}>
                          Send
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Super-admin void control */}
              {isSuperAdmin && !showVoidInput && (
                <Pressable
                  onPress={() => setShowVoidInput(true)}
                  style={[
                    styles.voidBtn,
                    { borderColor: colors.destructive + '60' },
                  ]}
                >
                  <Icon name="slash" size={14} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontWeight: '600', fontSize: 13 }}>
                    Void agreement
                  </Text>
                </Pressable>
              )}
              {isSuperAdmin && showVoidInput && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    Reason for voiding (required, audit-logged):
                  </Text>
                  <TextInput
                    value={voidReasonText}
                    onChangeText={setVoidReasonText}
                    placeholder="e.g. Rep signed instead of homeowner"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    style={[
                      styles.voidInput,
                      {
                        color: colors.foreground,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => { setShowVoidInput(false); setVoidReasonText(''); }}
                      style={[styles.voidCancelBtn, { borderColor: colors.border }]}
                    >
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleVoidAgreement}
                      disabled={voidAgreement.isPending}
                      style={[
                        styles.voidConfirmBtn,
                        {
                          backgroundColor: colors.destructive,
                          opacity: voidAgreement.isPending ? 0.6 : 1,
                        },
                      ]}
                    >
                      {voidAgreement.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                          Confirm void
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          ) : (
            // ── Unsigned state ────────────────────────────────────────────────
            <>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Have the homeowner sign the Forensic Inspection Purchase &amp; Sale Agreement
                on-site.
              </Text>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/inspection-agreement', params: { id } } as never)
                }
                style={[styles.signBtn, { backgroundColor: colors.primary }]}
              >
                <Icon name="edit-3" size={16} color={colors.primaryForeground} />
                <Text style={[styles.signBtnText, { color: colors.primaryForeground }]}>
                  Get Homeowner Signature
                </Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', flex: 1 },
  status: { fontSize: 16, fontWeight: '800' },
  errorBox: { borderRadius: 8, borderWidth: 1, padding: 10 },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
  },
  stubBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  stubText: { fontSize: 11, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: 10 },
  statCell: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12 },
  signBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
  },
  signBtnText: { fontSize: 15, fontWeight: '700' },
  viewPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  voidBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 2,
  },
  voidInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  voidCancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  voidConfirmBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
});
