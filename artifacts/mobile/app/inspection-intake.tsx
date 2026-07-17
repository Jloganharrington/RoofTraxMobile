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
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { inspectionsListKey, patchInspection, startInspection } from '@/lib/inspectionSync';
import { AddressAutocompleteField } from '@/components/AddressAutocompleteField';

// Claim intake (B4): captures the claim/policy header for a new forensic
// inspection. Offline-first — the inspection is created against a durable
// outbox with a client id, so an intake filled in airplane mode syncs later.
export default function InspectionIntakeScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { companyId } = useProfile();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    id?: string;
    pinId?: string;
    insuredName?: string;
    address?: string;
    carrierName?: string;
    policyNumber?: string;
    claimNumber?: string;
    dateOfLoss?: string;
    latitude?: string;
    longitude?: string;
  }>();

  // Advance mode (P4): when an `id` is passed, this screen patches an existing
  // preliminary record into forensic in place (same row) instead of creating a
  // new one — carrying the Phase 1 property/damage/storm/photos forward.
  const advancingId = params.id;

  const [insuredName, setInsuredName] = useState(params.insuredName ?? '');
  const [address, setAddress] = useState(params.address ?? '');
  const [claimNumber, setClaimNumber] = useState(params.claimNumber ?? '');
  const [policyNumber, setPolicyNumber] = useState(params.policyNumber ?? '');
  const [carrierName, setCarrierName] = useState(params.carrierName ?? '');
  const [dateOfLoss, setDateOfLoss] = useState(params.dateOfLoss ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [latitude, setLatitude] = useState<number | null>(
    params.latitude ? Number(params.latitude) : null,
  );
  const [longitude, setLongitude] = useState<number | null>(
    params.longitude ? Number(params.longitude) : null,
  );

  async function handleCreate() {
    setSaving(true);
    try {
      if (advancingId) {
        // P4 advance: patch the SAME preliminary record into forensic, adding
        // the claim identity and stamping preliminaryCompletedAt. The server's
        // forward-only phase guard rejects any other phase transition.
        await patchInspection(queryClient, advancingId, {
          phase: 'forensic',
          preliminaryCompletedAt: new Date().toISOString(),
          insuredName: insuredName.trim() || null,
          address: address.trim() || null,
          ...(latitude != null && { latitude }),
          ...(longitude != null && { longitude }),
          claimNumber: claimNumber.trim() || null,
          policyNumber: policyNumber.trim() || null,
          carrierName: carrierName.trim() || null,
          dateOfLoss: dateOfLoss.trim() || null,
          notes: notes.trim() || null,
        });
        await queryClient.invalidateQueries({ queryKey: inspectionsListKey() });
        router.replace({ pathname: '/inspection/[id]', params: { id: advancingId } });
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
          pinId: params.pinId ?? null,
          insuredName: insuredName.trim() || null,
          address: address.trim() || null,
          claimNumber: claimNumber.trim() || null,
          policyNumber: policyNumber.trim() || null,
          carrierName: carrierName.trim() || null,
          dateOfLoss: dateOfLoss.trim() || null,
          notes: notes.trim() || null,
          latitude,
          longitude,
        },
      });
      await queryClient.invalidateQueries({ queryKey: inspectionsListKey() });
      router.replace({ pathname: '/inspection/[id]', params: { id } });
    } catch {
      Alert.alert(
        advancingId ? 'Could not advance' : 'Could not start',
        'Something went wrong. Try again.',
      );
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
        {advancingId ? (
          <View style={[styles.pinNote, { backgroundColor: colors.accent }]}>
            <Icon name="check" size={16} color={colors.insurance} />
            <Text style={{ color: colors.accentForeground, flex: 1, fontSize: 13 }}>
              Advancing to Phase 2 — the property, damage type, storm, and Phase 1 photos carry over.
            </Text>
          </View>
        ) : params.pinId ? (
          <View style={[styles.pinNote, { backgroundColor: colors.accent }]}>
            <Icon name="map-pin" size={16} color={colors.insurance} />
            <Text style={{ color: colors.accentForeground, flex: 1, fontSize: 13 }}>
              Started from a canvassing pin — location prefilled.
            </Text>
          </View>
        ) : null}

        <Field label="Owners name" value={insuredName} onChange={setInsuredName} placeholder="Homeowner name" />
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
        <Field label="Carrier" value={carrierName} onChange={setCarrierName} placeholder="Insurance carrier" />
        <Field label="Policy number" value={policyNumber} onChange={setPolicyNumber} />
        <Field label="Claim number" value={claimNumber} onChange={setClaimNumber} />
        <Field label="Date of loss" value={dateOfLoss} onChange={setDateOfLoss} placeholder="YYYY-MM-DD" />
        <Field label="Notes" value={notes} onChange={setNotes} multiline placeholder="Optional context" />

        <Pressable
          onPress={handleCreate}
          disabled={saving}
          style={[styles.submit, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
              {advancingId ? 'Advance to forensic' : 'Create inspection'}
            </Text>
          )}
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Defined at module level ON PURPOSE: an inline component defined inside the
// screen's render function gets a new identity every keystroke, which remounts
// the TextInput and dismisses the keyboard after each character.
function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric';
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[
          styles.input,
          multiline && { height: 88, textAlignVertical: 'top' },
          { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  pinNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  submit: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitText: { fontSize: 16, fontWeight: '700' },
});
