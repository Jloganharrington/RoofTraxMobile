import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AddressSearchBar } from '@/components/AddressSearchBar';
import { Icon } from '@/components/Icon';
import { router } from 'expo-router';
import {
  getListTeamUsersQueryKey,
  useListPins,
  useListTeamUsers,
} from '@workspace/api-client-react';
import type { GeocodeSearchResult } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { canEditPin } from '@/lib/permissions';

// react-native-maps has no web renderer (its web entry is an
// UnimplementedView stub), so the web build shows a plain list of pins
// instead of a live map. Native (iOS/Android/Expo Go) uses MapScreen.native.
export default function MapScreenWeb() {
  const colors = useColors();
  const { role, department } = useProfile();
  const { user } = useAuth();
  const isManagerOrAdmin = role === 'manager' || role === 'admin';

  const [filterUserId, setFilterUserId] = useState<string | null>(null);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const [searchedLocation, setSearchedLocation] = useState<GeocodeSearchResult | null>(null);

  const teamQuery = useListTeamUsers({
    query: { enabled: isManagerOrAdmin, queryKey: getListTeamUsersQueryKey() },
  });
  const pinsQuery = useListPins(
    isManagerOrAdmin && filterUserId ? { userId: filterUserId } : undefined,
  );
  const pins = pinsQuery.data?.pins ?? [];
  const teamMembers = teamQuery.data?.users ?? [];
  const filterLabel = filterUserId
    ? (() => {
        const member = teamMembers.find((m) => m.id === filterUserId);
        return member
          ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
          : 'Selected rep';
      })()
    : 'All reps';

  // Canvassers see every pin for team awareness, but other reps' pins show
  // as neutral grey — only their own pins are colored by workflow.
  // Inspector field reps, managers, and admins always see workflow coloring.
  function dotColorFor(pin: (typeof pins)[number]) {
    if (department === 'canvasser' && pin.userId !== user?.id) {
      return colors.mutedForeground;
    }
    return pin.workflow === 'retail' ? colors.retail : colors.insurance;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.banner, { backgroundColor: colors.secondary }]}>
        <Icon name="smartphone" size={18} color="#fff" />
        <Text style={styles.bannerText}>
          The live map needs the mobile app (iOS/Android) — showing pins as a
          list here instead.
        </Text>
      </View>

      <AddressSearchBar
        variant="inline"
        onSelect={(result) => setSearchedLocation(result)}
        localItems={pins.filter((p): p is typeof p & { address: string } => !!p.address)}
      />

      {searchedLocation && (
        <View
          style={[
            styles.searchResultCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: '600' }} numberOfLines={2}>
              {searchedLocation.address}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {searchedLocation.latitude.toFixed(5)}, {searchedLocation.longitude.toFixed(5)}
            </Text>
          </View>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/pin-new',
                params: {
                  latitude: String(searchedLocation.latitude),
                  longitude: String(searchedLocation.longitude),
                },
              })
            }
            style={[styles.dropPinButton, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 13 }}>
              Drop pin here
            </Text>
          </Pressable>
        </View>
      )}

      {isManagerOrAdmin && (
        <Pressable
          onPress={() => setFilterPickerOpen(true)}
          style={[styles.filterPill, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Icon name="users" size={14} color={colors.foreground} />
          <Text style={[styles.filterPillText, { color: colors.foreground }]} numberOfLines={1}>
            {filterLabel}
          </Text>
          <Icon name="chevron-down" size={14} color={colors.mutedForeground} />
        </Pressable>
      )}

      <ScrollView contentContainerStyle={styles.list}>
        {pins.map((pin) => {
          const editable = canEditPin(role, user?.id, pin.userId);
          return (
            <Pressable
              key={pin.id}
              disabled={!editable}
              onPress={() =>
                router.push({ pathname: '/pin-edit', params: { pin: JSON.stringify(pin) } })
              }
              style={[styles.pinRow, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <View style={[styles.dot, { backgroundColor: dotColorFor(pin) }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: '600' }}>
                  {pin.address ?? `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {pin.workflow === 'retail'
                    ? `Retail · ${pin.doorKnockResult ?? 'no result'}`
                    : `Insurance · ${pin.damageType ?? 'unspecified'}`}
                </Text>
              </View>
              {editable && (
                <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
              )}
            </Pressable>
          );
        })}
        {pins.length === 0 && !pinsQuery.isLoading && (
          <Text style={{ color: colors.mutedForeground, padding: 16 }}>
            No pins yet.
          </Text>
        )}
      </ScrollView>

      {isManagerOrAdmin && (
        <Pressable
          onPress={() => router.push('/bulk-upload')}
          style={[styles.fab, { backgroundColor: colors.primary }]}
        >
          <Icon name="upload" size={22} color={colors.primaryForeground} />
        </Pressable>
      )}

      <Modal
        visible={filterPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setFilterPickerOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFilterPickerOpen(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.border }]}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Show pins for</Text>

            <Pressable
              onPress={() => {
                setFilterUserId(null);
                setFilterPickerOpen(false);
              }}
              style={[
                styles.optionRow,
                {
                  borderColor: colors.border,
                  backgroundColor: filterUserId === null ? colors.muted : 'transparent',
                },
              ]}
            >
              <Text style={{ color: colors.foreground, fontSize: 15 }}>All reps</Text>
              {filterUserId === null && <Icon name="check" size={18} color={colors.primary} />}
            </Pressable>

            {teamMembers.map((member) => {
              const name =
                [member.firstName, member.lastName].filter(Boolean).join(' ') ||
                member.email ||
                'Unnamed';
              const selected = filterUserId === member.id;
              return (
                <Pressable
                  key={member.id}
                  onPress={() => {
                    setFilterUserId(member.id);
                    setFilterPickerOpen(false);
                  }}
                  style={[
                    styles.optionRow,
                    {
                      borderColor: colors.border,
                      backgroundColor: selected ? colors.muted : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: colors.foreground, fontSize: 15 }}>{name}</Text>
                  {selected && <Icon name="check" size={18} color={colors.primary} />}
                </Pressable>
              );
            })}

            <Pressable onPress={() => setFilterPickerOpen(false)} style={styles.cancelButton}>
              <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    padding: 14,
    paddingTop: 67 + 14,
  },
  bannerText: { color: '#fff', fontSize: 13, flex: 1, lineHeight: 18 },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 12,
    maxWidth: 220,
  },
  filterPillText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  dropPinButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  pinRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 34 + 84,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 6,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
});
