import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { inspectionsListKey, patchInspection, startInspection } from '@/lib/inspectionSync';
import { DAMAGE_TYPE_OPTIONS } from '@/lib/preliminary';
import { AddressAutocompleteField } from '@/components/AddressAutocompleteField';

// Phase 1 intake (P2): a light top-of-funnel start. Address + a single damage
// type only — deliberately NO contact/claim info (that is captured later, at
// the Phase 2 forensic intake). Offline-first: the record is created against a
// durable outbox with a client id. When re-opened with an existing `id`, this
// screen edits the property/damage type in place instead of creating a record.
export default function PreliminaryIntakeScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { companyId } = useProfile();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    id?: string;
    pinId?: string;
    address?: string;
    damageType?: string;
    latitude?: string;
    longitude?: string;
  }>();

  const editingId = params.id;
  const [address, setAddress] = useState(params.address ?? '');
  const [damageType, setDamageType] = useState(params.damageType ?? '');
  const [saving, setSaving] = useState(false);

  const [latitude, setLatitude] = useState<number | null>(
    params.latitude ? Number(params.latitude) : null,
  );
  const [longitude, setLongitude] = useState<number | null>(
    params.longitude ? Number(params.longitude) : null,
  );

  async function handleSubmit() {
    if (!address.trim()) {
      Alert.alert('Address required', 'Enter the property address to start a preliminary inspection.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await patchInspection(queryClient, editingId, {
          address: address.trim(),
          damageType: damageType || null,
          ...(latitude != null && { latitude }),
          ...(longitude != null && { longitude }),
        });
        await queryClient.invalidateQueries({ queryKey: inspectionsListKey() });
        router.back();
        return;
      }

      if (!companyId || !user?.id) {
        Alert.alert('Not ready', 'Your profile is still loading. Try again in a moment.');
        return;
      }
      const id = await startInspection({
        queryClient,
        companyId,
        inspectorUserId: user.id,
        input: {
          status: 'capturing',
          phase: 'preliminary',
          pinId: params.pinId ?? null,
          address: address.trim(),
          damageType: damageType || null,
          latitude,
          longitude,
        },
      });
      await queryClient.invalidateQueries({ queryKey: inspectionsListKey() });
      router.replace({ pathname: '/inspection/[id]', params: { id } });
    } catch {
      Alert.alert('Could not start', 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {params.pinId ? (
          <View style={[styles.pinNote, { backgroundColor: colors.accent }]}>
            <Icon name="map-pin" size={16} color={colors.insurance} />
            <Text style={{ color: colors.accentForeground, flex: 1, fontSize: 13 }}>
              Started from a canvassing pin — location prefilled.
            </Text>
          </View>
        ) : null}

        <AddressAutocompleteField
          value={address}
          // Any manual edit drops the coordinates so we never submit a typed
          // address paired with a previously-selected location. Picking a
          // suggestion re-sets them immediately via onSelectResult.
          onChangeText={(text) => {
            setAddress(text);
            setLatitude(null);
            setLongitude(null);
          }}
          onSelectResult={(result) => {
            setLatitude(result.latitude);
            setLongitude(result.longitude);
          }}
        />

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Damage type</Text>
          <View style={styles.chips}>
            {DAMAGE_TYPE_OPTIONS.map((option) => {
              const on = damageType === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setDamageType(on ? '' : option.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: on ? colors.primary : colors.card,
                      borderColor: on ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: on ? colors.primaryForeground : colors.foreground,
                      fontWeight: '600',
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={saving}
          style={[styles.submit, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
              {editingId ? 'Save' : 'Start preliminary inspection'}
            </Text>
          )}
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  pinNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12 },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  submit: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  submitText: { fontSize: 16, fontWeight: '700' },
});
