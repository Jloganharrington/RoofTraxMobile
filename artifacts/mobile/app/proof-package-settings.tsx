import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, router } from 'expo-router';
import {
  useGetCompanyReportSettings,
  useUpdateCompanyReportSettings,
  useListCompanyStatePacks,
  useUpsertCompanyStatePack,
  useResearchCompanyStateCodes,
  getGetCompanyReportSettingsQueryKey,
  getListCompanyStatePacksQueryKey,
} from '@workspace/api-client-react';
import type { ContractorLicense, UpsertStatePackInputPack, CodeCitation, HomeownerRightsContent } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { Icon } from '@/components/Icon';
import { useQueryClient } from '@tanstack/react-query';

export default function ProofPackageSettingsScreen() {
  const colors = useColors();
  const { companyId, role, isLoading: profileLoading } = useProfile();

  if (profileLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (role !== 'super_admin' || !companyId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: colors.foreground }}>Access denied. Super admins only.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen options={{ title: 'Proof Package Settings' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        <CompanyReportSettingsSection companyId={companyId} colors={colors} />
        <StatePacksSection companyId={companyId} colors={colors} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CompanyReportSettingsSection({ companyId, colors }: { companyId: string; colors: ReturnType<typeof useColors> }) {
  const queryClient = useQueryClient();
  const settingsQuery = useGetCompanyReportSettings(companyId, {
    query: { enabled: !!companyId, queryKey: getGetCompanyReportSettingsQueryKey(companyId) }
  });
  const updateSettings = useUpdateCompanyReportSettings();

  const [licenses, setLicenses] = useState<ContractorLicense[]>([]);
  const [qualificationsText, setQualificationsText] = useState('');
  const [pricingBasisStatement, setPricingBasisStatement] = useState('');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    const s = settingsQuery.data?.settings;
    if (s && !seeded) {
      setLicenses(s.licenses || []);
      setQualificationsText(s.qualificationsText || '');
      setPricingBasisStatement(s.pricingBasisStatement || '');
      setSeeded(true);
    }
  }, [settingsQuery.data, seeded]);

  const addLicense = () => {
    setLicenses([...licenses, { state: '', number: '', classification: '' }]);
  };

  const removeLicense = (index: number) => {
    setLicenses(licenses.filter((_, i) => i !== index));
  };

  const updateLicense = (index: number, field: keyof ContractorLicense, value: string) => {
    const newLicenses = [...licenses];
    newLicenses[index] = { ...newLicenses[index], [field]: value };
    setLicenses(newLicenses);
  };

  const save = async () => {
    if (updateSettings.isPending) return;

    for (const l of licenses) {
      if (!l.state.trim() || !l.number.trim() || !l.classification.trim()) {
        Alert.alert('Incomplete License', 'Please fill out state, number, and classification for all licenses, or remove empty ones.');
        return;
      }
      if (l.state.trim().length !== 2) {
        Alert.alert('Invalid State', `State code "${l.state}" must be 2 letters.`);
        return;
      }
    }

    try {
      await updateSettings.mutateAsync({
        companyId,
        data: {
          settings: {
            licenses: licenses.map(l => ({
              state: l.state.trim().toUpperCase(),
              number: l.number.trim(),
              classification: l.classification.trim()
            })),
            qualificationsText: qualificationsText.trim() || null,
            pricingBasisStatement: pricingBasisStatement.trim() || null,
          }
        }
      });
      await queryClient.invalidateQueries({ queryKey: getGetCompanyReportSettingsQueryKey(companyId) });
      Alert.alert('Saved', 'Company report settings updated successfully.');
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Check your connection and try again.');
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.background,
  };

  return (
    <View style={{ gap: 16 }}>
      <View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>Report Settings</Text>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 4 }}>
          Global settings for all Proof Packages.
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>Licenses</Text>
        {licenses.map((lic, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="State (e.g. VA)"
              placeholderTextColor={colors.mutedForeground}
              value={lic.state}
              onChangeText={(v) => updateLicense(i, 'state', v)}
              maxLength={2}
              autoCapitalize="characters"
            />
            <TextInput
              style={[inputStyle, { flex: 2 }]}
              placeholder="Number"
              placeholderTextColor={colors.mutedForeground}
              value={lic.number}
              onChangeText={(v) => updateLicense(i, 'number', v)}
            />
            <TextInput
              style={[inputStyle, { flex: 2 }]}
              placeholder="Class"
              placeholderTextColor={colors.mutedForeground}
              value={lic.classification}
              onChangeText={(v) => updateLicense(i, 'classification', v)}
            />
            <Pressable onPress={() => removeLicense(i)} style={{ padding: 8 }}>
              <Icon name="x" size={20} color={colors.destructive} />
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addLicense} style={{ alignSelf: 'flex-start', paddingVertical: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add License</Text>
        </Pressable>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>Statement of Qualifications</Text>
        <TextInput
          style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
          placeholder="e.g. Fully licensed, bonded, and insured with 20+ years of experience..."
          placeholderTextColor={colors.mutedForeground}
          value={qualificationsText}
          onChangeText={setQualificationsText}
          multiline
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>Pricing Basis Statement</Text>
        <TextInput
          style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
          placeholder="e.g. Estimates are prepared using Xactimate..."
          placeholderTextColor={colors.mutedForeground}
          value={pricingBasisStatement}
          onChangeText={setPricingBasisStatement}
          multiline
        />
      </View>

      <Pressable
        onPress={save}
        disabled={updateSettings.isPending || settingsQuery.isLoading}
        style={{
          backgroundColor: colors.primary,
          padding: 14,
          borderRadius: 8,
          alignItems: 'center',
          opacity: (updateSettings.isPending || settingsQuery.isLoading) ? 0.6 : 1,
        }}
      >
        {updateSettings.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '600' }}>Save Report Settings</Text>
        )}
      </Pressable>
    </View>
  );
}

function StatePacksSection({ companyId, colors }: { companyId: string; colors: ReturnType<typeof useColors> }) {
  const packsQuery = useListCompanyStatePacks(companyId, {
    query: { enabled: !!companyId, queryKey: getListCompanyStatePacksQueryKey(companyId) }
  });

  const packs = packsQuery.data?.packs || [];
  const [newStateCode, setNewStateCode] = useState('');
  const [editingPackState, setEditingPackState] = useState<string | null>(null);

  const startEdit = (state: string) => {
    setEditingPackState(state);
  };

  const createPack = () => {
    const code = newStateCode.trim().toUpperCase();
    if (code.length !== 2) {
      Alert.alert('Invalid State', 'Must be a 2-letter state code.');
      return;
    }
    if (packs.some(p => p.state === code)) {
      Alert.alert('Exists', 'A pack for this state already exists. Edit it instead.');
      return;
    }
    setEditingPackState(code);
    setNewStateCode('');
  };

  return (
    <View style={{ gap: 16, marginTop: 16, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 24 }}>
      <View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>State Legal Packs</Text>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 4 }}>
          State-specific homeowner rights, UPPA disclaimers, and code citations.
        </Text>
      </View>

      {packsQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : (
        <View style={{ gap: 8 }}>
          {packs.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No state packs defined.</Text>
          ) : (
            packs.map(p => (
              <View key={p.state} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground }}>{p.state}</Text>
                <Pressable onPress={() => startEdit(p.state)}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <TextInput
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.foreground, backgroundColor: colors.background, width: 80 }}
          placeholder="State"
          placeholderTextColor={colors.mutedForeground}
          value={newStateCode}
          onChangeText={setNewStateCode}
          maxLength={2}
          autoCapitalize="characters"
        />
        <Pressable
          onPress={createPack}
          style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 }}
        >
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>Add State Pack</Text>
        </Pressable>
      </View>

      {editingPackState && (
        <Modal visible animationType="slide" presentationStyle="pageSheet">
          <StatePackEditor
            companyId={companyId}
            state={editingPackState}
            colors={colors}
            onClose={() => setEditingPackState(null)}
            existingPack={packs.find(p => p.state === editingPackState) || null}
          />
        </Modal>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE PACK EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function StatePackEditor({
  companyId,
  state,
  colors,
  onClose,
  existingPack
}: {
  companyId: string;
  state: string;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
  existingPack: any;
}) {
  const queryClient = useQueryClient();
  const upsertPack = useUpsertCompanyStatePack();

  // Homeowner Rights
  const [hoEnabled, setHoEnabled] = useState(!!existingPack?.homeownerRights);
  const [hoTitle, setHoTitle] = useState(existingPack?.homeownerRights?.title || '');
  const [hoSubtitle, setHoSubtitle] = useState(existingPack?.homeownerRights?.subtitle || '');
  const [hoPreparedBy, setHoPreparedBy] = useState(existingPack?.homeownerRights?.preparedByNote || '');
  const [hoSections, setHoSections] = useState<{heading: string, paragraphsText: string}[]>(
    (existingPack?.homeownerRights?.sections || []).map((s: any) => ({
      heading: s.heading,
      paragraphsText: (s.paragraphs || []).join('\n\n')
    }))
  );
  const [hoComplaintBlock, setHoComplaintBlock] = useState((existingPack?.homeownerRights?.complaintBlock || []).join('\n'));
  const [hoClosingDisclaimer, setHoClosingDisclaimer] = useState(existingPack?.homeownerRights?.closingDisclaimer || '');

  // UPPA
  const [uppaDisclaimer, setUppaDisclaimer] = useState(existingPack?.uppaDisclaimer || '');
  const [uppaStatute, setUppaStatute] = useState(existingPack?.uppaStatute || '');

  // Code Citations
  const [citations, setCitations] = useState<CodeCitation[]>(existingPack?.codeCitations || []);

  const researchCodes = useResearchCompanyStateCodes();
  const [researchQuery, setResearchQuery] = useState('');
  const [researchYear, setResearchYear] = useState<number | null>(null);
  const [researchSuggestions, setResearchSuggestions] = useState<CodeCitation[]>([]);

  const handleResearch = async () => {
    if (researchCodes.isPending) return;
    try {
      const resp = await researchCodes.mutateAsync({
        companyId,
        state,
        data: {
          query: researchQuery.trim() || null,
          editionYear: researchYear,
          existingKeys: citations.map(c => c.key),
        }
      });
      setResearchSuggestions(resp.suggestions || []);
      setResearchQuery('');
    } catch (err: any) {
      if (err?.status === 502) {
        Alert.alert('Research unavailable', 'The AI service is temporarily down or timed out. Please try again in a moment.');
      } else {
        Alert.alert('Research failed', err instanceof Error ? err.message : 'Check your connection and try again.');
      }
    }
  };

  const addSuggestion = (suggestion: CodeCitation) => {
    // Generate a unique key if it somehow conflicts
    let key = suggestion.key;
    let counter = 1;
    while (citations.some(c => c.key === key)) {
      key = `${suggestion.key}_${counter}`;
      counter++;
    }
    setCitations([...citations, { ...suggestion, key }]);
    setResearchSuggestions(researchSuggestions.filter(s => s.key !== suggestion.key));
  };

  const dismissSuggestion = (key: string) => {
    setResearchSuggestions(researchSuggestions.filter(s => s.key !== key));
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.background,
  };

  const save = async () => {
    if (upsertPack.isPending) return;

    let homeownerRights: HomeownerRightsContent | null = null;
    if (hoEnabled) {
      if (!hoTitle.trim() || !hoSubtitle.trim()) {
        Alert.alert('Incomplete', 'Title and Subtitle are required if Homeowner Information is enabled.');
        return;
      }
      homeownerRights = {
        title: hoTitle.trim(),
        subtitle: hoSubtitle.trim(),
        preparedByNote: hoPreparedBy.trim() || '',
        sections: hoSections.map(s => ({
          heading: s.heading.trim(),
          paragraphs: s.paragraphsText.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
        })),
        complaintBlock: hoComplaintBlock.split('\n').map((l: string) => l.trim()).filter(Boolean),
        closingDisclaimer: hoClosingDisclaimer.trim() || '',
      };
    }

    const citationsClean = citations.map(c => ({
      key: c.key.trim(),
      element: c.element.trim(),
      title: c.title.trim(),
      cite: c.cite.trim(),
      body: c.body.trim(),
    }));

    for (const c of citationsClean) {
      if (!c.key || !c.element || !c.title || !c.cite || !c.body) {
        Alert.alert('Incomplete Citation', 'All fields in each code citation must be filled.');
        return;
      }
    }

    try {
      await upsertPack.mutateAsync({
        companyId,
        state,
        data: {
          pack: {
            homeownerRights,
            uppaDisclaimer: uppaDisclaimer.trim() || null,
            uppaStatute: uppaStatute.trim() || null,
            codeCitations: citationsClean,
          }
        }
      });
      Alert.alert('Saved', `State pack for ${state} saved successfully.`);
      queryClient.invalidateQueries({ queryKey: getListCompanyStatePacksQueryKey(companyId) });
      onClose();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Check your connection and try again.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>Edit {state} Legal Pack</Text>
        <Pressable onPress={onClose} style={{ padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 32 }}>
        
        {/* UPPA Section */}
        <View style={{ gap: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>UPPA Disclaimer</Text>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Statute Reference (e.g. Texas Insurance Code § 4102.163)</Text>
            <TextInput
              style={inputStyle}
              value={uppaStatute}
              onChangeText={setUppaStatute}
              placeholder="Statute"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Disclaimer Text</Text>
            <TextInput
              style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
              value={uppaDisclaimer}
              onChangeText={setUppaDisclaimer}
              placeholder="We are not public adjusters..."
              placeholderTextColor={colors.mutedForeground}
              multiline
            />
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border }} />

        {/* Homeowner Information Section */}
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>Homeowner Rights Page</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
                Tokens {`{{contractor}}`} and {`{{license}}`} will be replaced automatically.
              </Text>
            </View>
            <Pressable
              onPress={() => setHoEnabled(!hoEnabled)}
              style={{ backgroundColor: hoEnabled ? colors.primary : colors.muted, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }}
            >
              <Text style={{ color: hoEnabled ? '#fff' : colors.foreground, fontSize: 12, fontWeight: '600' }}>
                {hoEnabled ? 'Enabled' : 'Disabled'}
              </Text>
            </Pressable>
          </View>

          {hoEnabled && (
            <View style={{ gap: 16 }}>
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Title *</Text>
                <TextInput style={inputStyle} value={hoTitle} onChangeText={setHoTitle} placeholder="Important Information for Homeowners" placeholderTextColor={colors.mutedForeground} />
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Subtitle *</Text>
                <TextInput style={inputStyle} value={hoSubtitle} onChangeText={setHoSubtitle} placeholder="Subtitle" placeholderTextColor={colors.mutedForeground} />
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Prepared By Note</Text>
                <TextInput style={inputStyle} value={hoPreparedBy} onChangeText={setHoPreparedBy} placeholder="Prepared by {{contractor}}..." placeholderTextColor={colors.mutedForeground} />
              </View>

              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground, marginTop: 8 }}>Sections</Text>
              {hoSections.map((sec, i) => (
                <View key={i} style={{ backgroundColor: colors.card, padding: 12, borderRadius: 8, gap: 8, borderWidth: 1, borderColor: colors.border }}>
                  <TextInput
                    style={[inputStyle, { fontWeight: '600' }]}
                    placeholder="Section Heading"
                    placeholderTextColor={colors.mutedForeground}
                    value={sec.heading}
                    onChangeText={v => { const n = [...hoSections]; n[i].heading = v; setHoSections(n); }}
                  />
                  <TextInput
                    style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
                    placeholder="Paragraphs (separated by blank lines)"
                    placeholderTextColor={colors.mutedForeground}
                    value={sec.paragraphsText}
                    onChangeText={v => { const n = [...hoSections]; n[i].paragraphsText = v; setHoSections(n); }}
                    multiline
                  />
                  <Pressable onPress={() => setHoSections(hoSections.filter((_, idx) => idx !== i))} style={{ alignSelf: 'flex-end' }}>
                    <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '600' }}>Remove Section</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={() => setHoSections([...hoSections, { heading: '', paragraphsText: '' }])}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add Section</Text>
              </Pressable>

              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Complaint Block (one line per entry)</Text>
                <TextInput style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} value={hoComplaintBlock} onChangeText={setHoComplaintBlock} multiline placeholder="State Dept of Insurance: 1-800..." placeholderTextColor={colors.mutedForeground} />
              </View>

              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Closing Disclaimer</Text>
                <TextInput style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} value={hoClosingDisclaimer} onChangeText={setHoClosingDisclaimer} multiline placeholder="This document is provided for informational purposes..." placeholderTextColor={colors.mutedForeground} />
              </View>
            </View>
          )}
        </View>

        <View style={{ height: 1, backgroundColor: colors.border }} />

        {/* Code Citations Section */}
        <View style={{ gap: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>Code Citations</Text>

          {/* AI Research Panel */}
          <View style={{ backgroundColor: colors.card, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>AI Code Research</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
                Find applicable building codes for roof/siding replacements in {state}.
              </Text>
            </View>
            <TextInput
              style={inputStyle}
              placeholder="Optional: specific code or topic, e.g. drip edge or IRC R908.3"
              placeholderTextColor={colors.mutedForeground}
              value={researchQuery}
              onChangeText={setResearchQuery}
            />
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Code edition year</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[null, 2015, 2018, 2021, 2024].map(year => {
                  const selected = researchYear === year;
                  return (
                    <Pressable
                      key={year ?? 'current'}
                      onPress={() => setResearchYear(year)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary : colors.background,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: selected ? colors.primaryForeground : colors.foreground }}>
                        {year ?? 'Current'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Pressable
              onPress={handleResearch}
              disabled={researchCodes.isPending}
              style={{
                backgroundColor: colors.secondary,
                padding: 10,
                borderRadius: 8,
                alignItems: 'center',
                opacity: researchCodes.isPending ? 0.6 : 1,
              }}
            >
              {researchCodes.isPending ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color={colors.foreground} size="small" />
                  <Text style={{ color: colors.foreground, fontWeight: '600' }}>Researching applicable codes… (10–20 seconds)</Text>
                </View>
              ) : (
                <Text style={{ color: colors.foreground, fontWeight: '600' }}>Research codes</Text>
              )}
            </Pressable>
          </View>

          {/* AI Suggestions */}
          {researchSuggestions.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>Suggestions</Text>
              {researchSuggestions.map(s => (
                <View key={s.key} style={{ backgroundColor: colors.background, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, gap: 8 }}>
                  <Text style={{ fontWeight: '700', color: colors.foreground }}>{s.element} — {s.title}</Text>
                  <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>{s.cite}</Text>
                  <Text style={{ fontSize: 13, color: colors.foreground }}>{s.body}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, justifyContent: 'flex-end' }}>
                    <Pressable onPress={() => dismissSuggestion(s.key)} style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
                      <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>Dismiss</Text>
                    </Pressable>
                    <Pressable onPress={() => addSuggestion(s)} style={{ backgroundColor: colors.primary, paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6 }}>
                      <Text style={{ color: '#fff', fontWeight: '600' }}>Add</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {citations.map((c, i) => (
            <View key={i} style={{ backgroundColor: colors.card, padding: 12, borderRadius: 8, gap: 8, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={[inputStyle, { flex: 1 }]} placeholder="Key (e.g. drip_edge)" placeholderTextColor={colors.mutedForeground} value={c.key} onChangeText={v => { const n = [...citations]; n[i].key = v; setCitations(n); }} />
                <TextInput style={[inputStyle, { flex: 1 }]} placeholder="Element" placeholderTextColor={colors.mutedForeground} value={c.element} onChangeText={v => { const n = [...citations]; n[i].element = v; setCitations(n); }} />
              </View>
              <TextInput style={inputStyle} placeholder="Title (e.g. IRC 2018)" placeholderTextColor={colors.mutedForeground} value={c.title} onChangeText={v => { const n = [...citations]; n[i].title = v; setCitations(n); }} />
              <TextInput style={inputStyle} placeholder="Citation (e.g. R905.2.8.5)" placeholderTextColor={colors.mutedForeground} value={c.cite} onChangeText={v => { const n = [...citations]; n[i].cite = v; setCitations(n); }} />
              <TextInput style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} placeholder="Body text" placeholderTextColor={colors.mutedForeground} value={c.body} onChangeText={v => { const n = [...citations]; n[i].body = v; setCitations(n); }} multiline />
              <Pressable onPress={() => setCitations(citations.filter((_, idx) => idx !== i))} style={{ alignSelf: 'flex-end' }}>
                <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '600' }}>Remove Citation</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => setCitations([...citations, { key: '', element: '', title: '', cite: '', body: '' }])}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add Citation</Text>
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
        <Pressable
          onPress={save}
          disabled={upsertPack.isPending}
          style={{
            backgroundColor: colors.primary,
            padding: 14,
            borderRadius: 8,
            alignItems: 'center',
            opacity: upsertPack.isPending ? 0.6 : 1,
          }}
        >
          {upsertPack.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Save {state} Pack</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
