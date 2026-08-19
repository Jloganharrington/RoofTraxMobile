import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { CalendarPicker } from '@/components/CalendarPicker';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getListPinsQueryKey,
  useResolveDnkVerification,
  useSetPinAppointment,
  useUpdatePin,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ContactOutcome,
  DamageType,
  DoorKnockResult,
  Pin,
  PinWorkflow,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { uploadFile } from '@/lib/upload';
import { canResolveDnkVerification } from '@/lib/permissions';

/** Strip non-digits and format as (XXX) XXX-XXXX */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const APPT_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const APPT_MINUTES = [0, 15, 30, 45];

function formatHour(h: number): string {
  if (h === 12) return '12 PM';
  if (h > 12) return `${h - 12} PM`;
  return `${h} AM`;
}

function apptSummary(date: Date, hour: number, min: number): string {
  const d = new Date(date);
  d.setHours(hour, min, 0, 0);
  return (
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

const DAMAGE_TYPES: { value: DamageType; label: string }[] = [
  { value: 'roof', label: 'Roof' },
  { value: 'siding', label: 'Siding' },
  { value: 'roof_and_siding', label: 'Roof & siding' },
];

const DOOR_KNOCK_RESULTS: { value: DoorKnockResult; label: string }[] = [
  { value: 'no_answer', label: 'No answer' },
  { value: 'no_appointment', label: 'No appointment' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'do_not_knock', label: 'Do Not Knock' },
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
        const isDnk = opt.value === 'do_not_knock';
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.choiceChip,
              {
                  backgroundColor: active ? (isDnk ? colors.dnkPending : colors.primary) : colors.muted,
                  borderColor: isDnk ? colors.dnkPending : colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: active ? '#fff' : isDnk ? colors.dnkPending : colors.foreground,
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
  const queryClient = useQueryClient();
  const { role, department, workflowAssignment } = useProfile();
  const { pin: pinParam } = useLocalSearchParams<{ pin: string }>();
  const updatePin = useUpdatePin();
  const setAppointment = useSetPinAppointment();
  const resolveDnkVerification = useResolveDnkVerification();

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
  const isDoNotKnock = isRetail && doorKnockResult === 'do_not_knock';
  const [contactOutcome, setContactOutcome] = useState<ContactOutcome | null>(
    pin?.contactOutcome ?? null,
  );
  const [customerName, setCustomerName] = useState(pin?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(
    pin?.customerPhone ? formatPhone(pin.customerPhone) : '',
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(pin?.photoUrl ?? null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [ownerName1, setOwnerName1] = useState(pin?.retailData?.ownerName1 ?? '');
  const [ownerName2, setOwnerName2] = useState(pin?.retailData?.ownerName2 ?? '');
  const [phone, setPhone] = useState(
    pin?.retailData?.phone ? formatPhone(pin.retailData.phone) : '',
  );
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

  // Appointment scheduling state. Initialized to tomorrow 10 AM.
  // apptPickerUsed tracks whether the user interacted — we only POST to the
  // appointment endpoint if they actually set/changed the date or time.
  const [apptDate, setApptDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  });
  const [apptHour, setApptHour] = useState(10);
  const [apptMin, setApptMin] = useState(0);
  const [apptPickerUsed, setApptPickerUsed] = useState(false);

  if (!pin) {
    return (
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>This pin could not be loaded.</Text>
      </View>
    );
  }

  const pinId = pin.id;
  const canResolvePendingDnk = canResolveDnkVerification(
    role,
    department,
    workflowAssignment,
    pin,
  );
  const dnkColor =
    pin.dnkVerificationStatus === 'no_visible_damage'
      ? colors.dnkNoVisibleDamage
      : pin.dnkVerificationStatus === 'mailer_campaign'
        ? colors.dnkMailerCampaign
        : colors.dnkPending;
  const dnkLabel =
    pin.dnkVerificationStatus === 'no_visible_damage'
      ? 'No Visible Damage'
      : pin.dnkVerificationStatus === 'mailer_campaign'
        ? 'Mailer Campaign'
        : 'Insurance verification needed';

  function handleResolveDnk(status: 'no_visible_damage' | 'mailer_campaign') {
    resolveDnkVerification.mutate(
      { pinId, data: { status } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListPinsQueryKey() });
          router.back();
        },
        onError: () =>
          Alert.alert('Could not update pin', 'Try again or check your network connection.'),
      },
    );
  }

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

  const photoRequired = !isRetail && contactOutcome === 'no_soliciting';

  function handleSave() {
    if (photoRequired && !photoUrl) {
      Alert.alert(
        'Photo required',
        'Add a photo of the front of the home for Mailer Only outcomes.',
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
          photoUrl: !isDoNotKnock ? photoUrl ?? undefined : undefined,
          contactOutcome: !isRetail ? contactOutcome ?? undefined : undefined,
          customerName:
            !isRetail && contactOutcome === 'call_to_schedule' ? customerName.trim() : undefined,
          customerPhone:
            !isRetail && contactOutcome === 'call_to_schedule' ? customerPhone.trim() : undefined,
          retailData: isRetail && !isDoNotKnock
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
        onSuccess: () => {
          // Only update the appointment endpoint if the user interacted with the picker.
          if (isRetail && doorKnockResult === 'appointment' && apptPickerUsed) {
            const apptDatetime = new Date(apptDate);
            apptDatetime.setHours(apptHour, apptMin, 0, 0);
            setAppointment.mutate(
              {
                pinId,
                data: { appointmentAt: apptDatetime.toISOString(), appointmentStatus: 'scheduled' },
              },
              { onSettled: () => router.back() },
            );
          } else {
            router.back();
          }
        },
        onError: () => Alert.alert('Error', 'Could not save changes to this pin.'),
      },
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
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
                onChangeText={(v) => setCustomerPhone(formatPhone(v))}
                keyboardType="phone-pad"
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
              />
            </>
          )}
        </>
      ) : (
        <>
          {isDoNotKnock ? (
            <View style={[styles.dnkCard, { backgroundColor: `${dnkColor}12`, borderColor: dnkColor }]}>
              <Icon name="shield" size={20} color={dnkColor} />
              <View style={{ flex: 1, gap: 8 }}>
                <View>
                  <Text style={[styles.dnkTitle, { color: dnkColor }]}>{dnkLabel}</Text>
                  <Text style={[styles.dnkBody, { color: colors.mutedForeground }]}>
                    {pin.dnkVerificationStatus === 'pending'
                      ? 'No other pin details are required. Verify whether damage is visible from the property.'
                      : 'This Do Not Knock verification has been completed.'}
                  </Text>
                </View>
                {canResolvePendingDnk && pin.dnkVerificationStatus === 'pending' && (
                  <View style={styles.dnkActions}>
                    <Pressable
                      onPress={() => handleResolveDnk('no_visible_damage')}
                      disabled={resolveDnkVerification.isPending}
                      style={[styles.dnkAction, { backgroundColor: colors.dnkNoVisibleDamage }]}
                    >
                      <Text style={styles.dnkActionText}>No Visible Damage</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleResolveDnk('mailer_campaign')}
                      disabled={resolveDnkVerification.isPending}
                      style={[styles.dnkAction, { backgroundColor: colors.dnkMailerCampaign }]}
                    >
                      <Text style={[styles.dnkActionText, { color: colors.foreground }]}>Mailer Campaign</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.foreground }]}>Door knock result</Text>
              <ChoiceRow
                options={DOOR_KNOCK_RESULTS}
                value={doorKnockResult}
                onChange={setDoorKnockResult}
              />

              {/* Appointment scheduler — expands when rep selects "Appointment" */}
              {doorKnockResult === 'appointment' && (
            <View style={[styles.apptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.apptSummary, { color: colors.primary }]}>
                📅 {apptSummary(apptDate, apptHour, apptMin)}
              </Text>

              <Text style={[styles.apptLabel, { color: colors.foreground }]}>Date</Text>
              <CalendarPicker
                selected={apptDate}
                minDate={new Date()}
                onSelect={(d) => { setApptDate(d); setApptPickerUsed(true); }}
              />

              <Text style={[styles.apptLabel, { color: colors.foreground }]}>Time</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {APPT_HOURS.map((h) => (
                    <Pressable
                      key={h}
                      onPress={() => { setApptHour(h); setApptPickerUsed(true); }}
                      style={[
                        styles.choiceChip,
                        {
                          backgroundColor: apptHour === h ? colors.primary : colors.muted,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text style={{ color: apptHour === h ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>
                        {formatHour(h)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                {APPT_MINUTES.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => { setApptMin(m); setApptPickerUsed(true); }}
                    style={[
                      styles.choiceChip,
                      {
                        backgroundColor: apptMin === m ? colors.primary : colors.muted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: apptMin === m ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>
                      :{m.toString().padStart(2, '0')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
              )}

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
            onChangeText={(v) => setPhone(formatPhone(v))}
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
        </>
      )}

      {!isRetail && (
        <Text style={[styles.label, { color: colors.foreground }]}>
          Photo of front of home
        </Text>
      )}
      {!isDoNotKnock && <Pressable
        onPress={handlePickPhoto}
        style={[
          styles.photoButton,
          {
            borderColor: photoRequired && !photoUrl ? colors.destructive : colors.border,
          },
        ]}
      >
        {uploadingPhoto ? (
          <ActivityIndicator />
        ) : (
          <>
            <Icon name="camera" size={18} color={colors.foreground} />
            <Text style={{ color: colors.foreground }}>
              {photoUri || photoUrl ? 'Retake photo' : photoRequired ? 'Add photo (required)' : 'Add photo'}
            </Text>
          </>
        )}
      </Pressable>}

      {(!isDoNotKnock || pin.doorKnockResult !== 'do_not_knock') && (() => {
        const missingCustomerInfo =
          !isRetail &&
          contactOutcome === 'call_to_schedule' &&
          (!customerName.trim() || !customerPhone.trim());
        const saveDisabled =
          updatePin.isPending ||
          setAppointment.isPending ||
          uploadingPhoto ||
          missingCustomerInfo ||
          (photoRequired && !photoUrl);

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
            {updatePin.isPending || setAppointment.isPending ? (
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
    </KeyboardAvoidingView>
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
  dnkCard: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  dnkTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  dnkBody: { fontSize: 13, lineHeight: 18 },
  dnkActions: { gap: 8 },
  dnkAction: { borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, alignItems: 'center' },
  dnkActionText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  saveButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  apptCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  apptSummary: {
    fontSize: 14,
    fontWeight: '700',
  },
  apptLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
