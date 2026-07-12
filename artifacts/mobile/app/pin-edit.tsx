import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/components/Icon';
import { router, useLocalSearchParams } from 'expo-router';
import { useUpdatePin } from '@workspace/api-client-react';
import type {
  ContactOutcome,
  DamageType,
  DoorKnockResult,
  Pin,
  PinWorkflow,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { uploadFile } from '@/lib/upload';

const DAMAGE_TYPES: { value: DamageType; label: string }[] = [
  { value: 'roof', label: 'Roof' },
  { value: 'siding', label: 'Siding' },
  { value: 'roof_and_siding', label: 'Roof & siding' },
];

const DOOR_KNOCK_RESULTS: { value: DoorKnockResult; label: string }[] = [
  { value: 'no_answer', label: 'No answer' },
  { value: 'no_appointment', label: 'No appointment' },
  { value: 'appointment', label: 'Appointment' },
];

const CONTACT_OUTCOMES: { value: ContactOutcome; label: string }[] = [
  { value: 'no_soliciting', label: 'No Soliciting - Mailer Only' },
  { value: 'priority_inspection', label: 'Priority Inspection Authorized' },
  { value: 'call_to_schedule', label: 'Call to Schedule' },
];

function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.choiceRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.choiceChip,
              {
                backgroundColor: active ? colors.primary : colors.muted,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: active ? colors.primaryForeground : colors.foreground,
                fontSize: 13,
                fontWeight: '600',
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PinEditScreen() {
  const colors = useColors();
  const { pin: pinParam } = useLocalSearchParams<{ pin: string }>();
  const updatePin = useUpdatePin();

  const pin: Pin | null = (() => {
    try {
      return pinParam ? (JSON.parse(pinParam) as Pin) : null;
    } catch {
      return null;
    }
  })();

  const [workflow] = useState<PinWorkflow>(pin?.workflow ?? 'insurance');
  const isRetail = workflow === 'retail';

  const [damageType, setDamageType] = useState<DamageType | null>(pin?.damageType ?? null);
  const [doorKnockResult, setDoorKnockResult] = useState<DoorKnockResult | null>(
    pin?.doorKnockResult ?? null,
  );
  const [contactOutcome, setContactOutcome] = useState<ContactOutcome | null>(
    pin?.contactOutcome ?? null,
  );
  const [customerName, setCustomerName] = useState(pin?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(pin?.customerPhone ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(pin?.photoUrl ?? null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [ownerName1, setOwnerName1] = useState(pin?.retailData?.ownerName1 ?? '');
  const [ownerName2, setOwnerName2] = useState(pin?.retailData?.ownerName2 ?? '');
  const [phone, setPhone] = useState(pin?.retailData?.phone ?? '');
  const [email, setEmail] = useState(pin?.retailData?.email ?? '');
  const [interestedRoof, setInterestedRoof] = useState(pin?.retailData?.interestedRoof ?? false);
  const [interestedSiding, setInterestedSiding] = useState(
    pin?.retailData?.interestedSiding ?? false,
  );
  const [interestedWindows, setInterestedWindows] = useState(
    pin?.retailData?.interestedWindows ?? false,
  );
  const [interestedDoors, setInterestedDoors] = useState(
    pin?.retailData?.interestedDoors ?? false,
  );
  const [interestNotes, setInterestNotes] = useState(pin?.retailData?.interestNotes ?? '');
  const [notes, setNotes] = useState(pin?.retailData?.notes ?? '');

  if (!pin) {
    return (
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>This pin could not be loaded.</Text>
      </View>
    );
  }

  const pinId = pin.id;

  async function handlePickPhoto() {
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setPhotoUri(asset.uri);
    setUploadingPhoto(true);
    try {
      const url = await uploadFile(asset.uri, asset.mimeType ?? 'image/jpeg');
      setPhotoUrl(url);
    } catch {
      Alert.alert('Upload failed', 'Could not upload the photo. You can still save changes.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  function handleSave() {
    if (!isRetail && !photoUrl) {
      Alert.alert(
        'Photo required',
        'Add a photo of the front of the home before saving this pin.',
      );
      return;
    }

    if (!isRetail && contactOutcome === 'call_to_schedule' && (!customerName.trim() || !customerPhone.trim())) {
      Alert.alert(
        'Customer info required',
        'Enter the customer name and phone number to schedule a call.',
      );
      return;
    }

    updatePin.mutate(
      {
        pinId,
        data: {
          damageType: !isRetail ? damageType ?? undefined : undefined,
          doorKnockResult: isRetail ? doorKnockResult ?? undefined : undefined,
          photoUrl: photoUrl ?? undefined,
          contactOutcome: !isRetail ? contactOutcome ?? undefined : undefined,
          customerName:
            !isRetail && contactOutcome === 'call_to_schedule' ? customerName.trim() : undefined,
          customerPhone:
            !isRetail && contactOutcome === 'call_to_schedule' ? customerPhone.trim() : undefined,
          retailData: isRetail
            ? {
                ownerName1,
                ownerName2: ownerName2 || undefined,
                phone: phone || undefined,
                email: email || undefined,
                interestedRoof,
                interestedSiding,
                interestedWindows,
                interestedDoors,
                interestNotes: interestNotes || undefined,
                notes: notes || undefined,
              }
            : undefined,
        },
      },
      {
        onSuccess: () => router.back(),
        onError: () => Alert.alert('Error', 'Could not save changes to this pin.'),
      },
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.locationBlock}>
        <Text style={[styles.address, { color: colors.foreground }]}>
          {pin.address ?? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
        </Text>
        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 2 }]}>
          {isRetail ? 'Retail' : 'Insurance'} pin · location can't be changed
        </Text>
      </View>

      {!isRetail ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Damage type</Text>
          <ChoiceRow options={DAMAGE_TYPES} value={damageType} onChange={setDamageType} />

          <Text style={[styles.label, { color: colors.foreground }]}>Homeowner contact</Text>
          <ChoiceRow
            options={CONTACT_OUTCOMES}
            value={contactOutcome}
            onChange={setContactOutcome}
          />

          {contactOutcome === 'call_to_schedule' && (
            <>
              <TextInput
                placeholder="Customer name"
                value={customerName}
                onChangeText={setCustomerName}
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
              />
              <TextInput
                placeholder="Customer phone"
                value={customerPhone}
                onChangeText={setCustomerPhone}
                keyboardType="phone-pad"
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Door knock result</Text>
          <ChoiceRow
            options={DOOR_KNOCK_RESULTS}
            value={doorKnockResult}
            onChange={setDoorKnockResult}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Homeowner</Text>
          <TextInput
            placeholder="Owner name"
            value={ownerName1}
            onChangeText={setOwnerName1}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            placeholderTextColor={colors.mutedForeground}
          />
          <TextInput
            placeholder="Co-owner name (optional)"
            value={ownerName2}
            onChangeText={setOwnerName2}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            placeholderTextColor={colors.mutedForeground}
          />
          <TextInput
            placeholder="Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            placeholderTextColor={colors.mutedForeground}
          />
          <TextInput
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Interested in</Text>
          {[
            ['Roof', interestedRoof, setInterestedRoof],
            ['Siding', interestedSiding, setInterestedSiding],
            ['Windows', interestedWindows, setInterestedWindows],
            ['Doors', interestedDoors, setInterestedDoors],
          ].map(([label, val, setter]: any) => (
            <View key={label} style={styles.switchRow}>
              <Text style={{ color: colors.foreground }}>{label}</Text>
              <Switch value={val} onValueChange={setter} />
            </View>
          ))}

          <TextInput
            placeholder="Interest notes"
            value={interestNotes}
            onChangeText={setInterestNotes}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            placeholderTextColor={colors.mutedForeground}
          />
          <TextInput
            placeholder="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, height: 80 },
            ]}
            placeholderTextColor={colors.mutedForeground}
          />
        </>
      )}

      {!isRetail && (
        <Text style={[styles.label, { color: colors.foreground }]}>
          Photo of front of home
        </Text>
      )}
      <Pressable
        onPress={handlePickPhoto}
        style={[
          styles.photoButton,
          {
            borderColor: !isRetail && !photoUrl ? colors.destructive : colors.border,
          },
        ]}
      >
        {uploadingPhoto ? (
          <ActivityIndicator />
        ) : (
          <>
            <Icon name="camera" size={18} color={colors.foreground} />
            <Text style={{ color: colors.foreground }}>
              {photoUri || photoUrl ? 'Retake photo' : !isRetail ? 'Add photo (required)' : 'Add photo'}
            </Text>
          </>
        )}
      </Pressable>

      {(() => {
        const missingCustomerInfo =
          !isRetail &&
          contactOutcome === 'call_to_schedule' &&
          (!customerName.trim() || !customerPhone.trim());
        const saveDisabled =
          updatePin.isPending || uploadingPhoto || (!isRetail && !photoUrl) || missingCustomerInfo;

        return (
          <Pressable
            onPress={handleSave}
            disabled={saveDisabled}
            style={[
              styles.saveButton,
              {
                backgroundColor: colors.primary,
                opacity: saveDisabled ? 0.5 : 1,
              },
            ]}
          >
            {updatePin.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 16 }}>
                Save changes
              </Text>
            )}
          </Pressable>
        );
      })()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 32 : 16,
    paddingBottom: 60,
    gap: 10,
  },
  label: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  locationBlock: { gap: 2 },
  address: { fontSize: 16, fontWeight: '700' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  photoButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
  },
  saveButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
});
