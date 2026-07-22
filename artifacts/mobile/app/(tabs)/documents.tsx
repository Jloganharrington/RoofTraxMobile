/**
 * Documents tab — unified list of FIPSA agreements, Phase 1 preliminary
 * reports, and Phase 2 forensic reports for the rep's company.
 *
 * Filter pills narrow by type; search bar filters by address or homeowner.
 * Tapping a card offers type-specific actions:
 *   FIPSA   → View PDF | Resend to homeowner (email input modal)
 *   Phase 1 → Open report screen (re-render + email live there)
 *   Phase 2 → Open forensic inspection hub
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  useListDocuments,
  useEmailAgreement,
  type DocumentListItem,
} from '@/lib/agreementApi';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocFilter = 'all' | 'fipsa' | 'phase1' | 'phase2';

// ── Constants ─────────────────────────────────────────────────────────────────

const FILTERS: { key: DocFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'fipsa', label: 'FIPSA' },
  { key: 'phase1', label: 'Phase 1 Report' },
  { key: 'phase2', label: 'Phase 2 Report' },
];

const TYPE_CONFIG: Record<
  DocumentListItem['type'],
  { icon: string; label: string; color: string }
> = {
  fipsa:  { icon: 'file-text', label: 'FIPSA',   color: '#2563eb' },
  phase1: { icon: 'clipboard', label: 'Phase 1',  color: '#059669' },
  phase2: { icon: 'package',   label: 'Phase 2',  color: '#7c3aed' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── DocumentCard ──────────────────────────────────────────────────────────────

function DocumentCard({
  item,
  colors,
  onPress,
}: {
  item: DocumentListItem;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  onPress: () => void;
}) {
  const conf = TYPE_CONFIG[item.type];
  const isVoided = !!item.voidedAt;
  const isScheduled = !!item.scheduledFor && !isVoided;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {/* Left icon */}
      <View style={styles.cardLeft}>
        <View style={[styles.iconCircle, { backgroundColor: conf.color + '18' }]}>
          <Icon name={conf.icon as any} size={20} color={conf.color} />
        </View>
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        <Text style={[styles.address, { color: colors.foreground }]} numberOfLines={1}>
          {item.propertyAddress ?? 'Unknown address'}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.homeownerName ?? 'Homeowner not recorded'}
        </Text>
        <Text style={[styles.dateLine, { color: colors.mutedForeground }]}>
          {item.type === 'fipsa' ? 'Signed' : 'Created'} {formatDate(item.date)}
          {item.repName ? ` · ${item.repName}` : ''}
        </Text>
      </View>

      {/* Right badges */}
      <View style={styles.cardRight}>
        <View style={[styles.badge, { backgroundColor: conf.color + '18' }]}>
          <Text style={[styles.badgeText, { color: conf.color }]}>{conf.label}</Text>
        </View>
        {isVoided && (
          <View style={[styles.badge, { backgroundColor: colors.destructive + '22' }]}>
            <Text style={[styles.badgeText, { color: colors.destructive }]}>Voided</Text>
          </View>
        )}
        {isScheduled && (
          <View style={[styles.badge, { backgroundColor: colors.insurance + '22' }]}>
            <Text style={[styles.badgeText, { color: colors.insurance }]}>Scheduled</Text>
          </View>
        )}
        <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DocumentsScreen() {
  const colors = useColors();

  // ── Search ─────────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(searchText.trim()), 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchText]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState<DocFilter>('all');

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data, isLoading, isRefetching, refetch } = useListDocuments(
    debouncedQ || undefined,
  );
  const allDocs = data?.documents ?? [];
  const visibleDocs =
    activeFilter === 'all' ? allDocs : allDocs.filter((d) => d.type === activeFilter);

  // ── FIPSA resend modal ─────────────────────────────────────────────────────
  const [resendItem, setResendItem] = useState<DocumentListItem | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const emailAgreement = useEmailAgreement();

  async function handleResendSend() {
    if (!resendItem) return;
    const recipient = resendEmail.trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      Alert.alert('Invalid email', 'Enter a valid email address to send the agreement.');
      return;
    }
    try {
      const result = await emailAgreement.mutateAsync({
        inspectionId: resendItem.inspectionId,
        recipient,
      });
      if (result.noSmtp) {
        Alert.alert(
          'No email configured',
          'Configure SMTP on your Profile tab to send directly, or open the PDF and share it manually.',
        );
      } else {
        Alert.alert('Sent', `Agreement emailed to ${recipient}.`);
        setResendItem(null);
        setResendEmail('');
        void refetch();
      }
    } catch {
      Alert.alert('Could not send', 'Check your connection and try again.');
    }
  }

  // ── Card tap ───────────────────────────────────────────────────────────────
  const handlePress = useCallback((item: DocumentListItem) => {
    if (item.type === 'fipsa') {
      Alert.alert(
        item.propertyAddress ?? 'Agreement',
        item.signerName ? `Signed by ${item.signerName}` : undefined,
        [
          {
            text: 'View PDF',
            onPress: () => {
              router.push({
                pathname: '/agreement-detail',
                params: {
                  inspectionId: item.inspectionId,
                  propertyAddress: item.propertyAddress ?? '',
                  signerName: item.signerName ?? '',
                },
              });
            },
          },
          {
            text: 'Resend to homeowner',
            onPress: () => {
              setResendEmail('');
              setResendItem(item);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else if (item.type === 'phase1') {
      Alert.alert(
        item.propertyAddress ?? 'Phase 1 Report',
        'Re-render the report with the current template, or email it to the homeowner.',
        [
          {
            text: 'Open report screen',
            onPress: () =>
              router.push({
                pathname: '/inspection-report',
                params: { id: item.inspectionId },
              }),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      // Phase 2 — open the forensic inspection hub where the rep can
      // review and re-render the full proof package.
      router.push(`/inspection/${item.inspectionId}` as any);
    }
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: DocumentListItem }) => (
      <DocumentCard item={item} colors={colors} onPress={() => handlePress(item)} />
    ),
    [colors, handlePress],
  );

  const emptyLabel =
    activeFilter === 'fipsa'  ? 'FIPSA agreements' :
    activeFilter === 'phase1' ? 'Phase 1 reports' :
    activeFilter === 'phase2' ? 'Phase 2 reports' :
    'documents';

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Search bar */}
      <View
        style={[
          styles.searchWrap,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Icon name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search by address or homeowner…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {searchText.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setSearchText('')} hitSlop={8}>
            <Icon name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterScroll, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => {
          const active = f.key === activeFilter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setActiveFilter(f.key)}
              style={[
                styles.pill,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: active ? '#fff' : colors.mutedForeground },
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* List */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={visibleDocs}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Icon name="folder" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {debouncedQ ? `No matching ${emptyLabel}` : `No ${emptyLabel} yet`}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                {debouncedQ
                  ? 'Try a different address or homeowner name.'
                  : activeFilter === 'fipsa'
                  ? 'Signed FIPSAs will appear here once collected in the field.'
                  : activeFilter === 'phase1'
                  ? 'Phase 1 preliminary inspections will appear here.'
                  : activeFilter === 'phase2'
                  ? 'Phase 2 forensic inspections will appear here.'
                  : 'Documents will appear here as inspections and agreements are created.'}
              </Text>
            </View>
          }
        />
      )}

      {/* FIPSA resend modal */}
      <Modal
        visible={!!resendItem}
        transparent
        animationType="slide"
        onRequestClose={() => setResendItem(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setResendItem(null)} />
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
              Resend agreement
            </Text>
            <Text style={[styles.sheetSub, { color: colors.mutedForeground }]} numberOfLines={2}>
              {resendItem?.propertyAddress ?? ''}
            </Text>
            <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>
              Homeowner email address
            </Text>
            <TextInput
              value={resendEmail}
              onChangeText={setResendEmail}
              placeholder="homeowner@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={[
                styles.emailInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            />
            <View style={styles.sheetButtons}>
              <Pressable
                onPress={() => {
                  setResendItem(null);
                  setResendEmail('');
                }}
                style={[styles.sheetBtn, { backgroundColor: colors.muted }]}
              >
                <Text style={[styles.sheetBtnText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleResendSend}
                disabled={emailAgreement.isPending}
                style={[
                  styles.sheetBtn,
                  { backgroundColor: colors.primary, opacity: emailAgreement.isPending ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.sheetBtnText, { color: '#fff' }]}>
                  {emailAgreement.isPending ? 'Sending…' : 'Send'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Search bar
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 2 },

  // Filter row
  filterScroll: { borderBottomWidth: 1 },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: '600' },

  // List
  list: { padding: 16, gap: 10 },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  cardLeft: { alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  address: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 13 },
  dateLine: { fontSize: 12 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  // State
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Resend modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: 24,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetSub: { fontSize: 14 },
  sheetLabel: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  emailInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  sheetBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sheetBtnText: { fontSize: 15, fontWeight: '600' },
});
