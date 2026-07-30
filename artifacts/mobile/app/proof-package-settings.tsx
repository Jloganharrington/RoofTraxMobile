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
  useListCompanyJurisdictionPacks,
  useUpsertCompanyJurisdictionPack,
  useDeleteCompanyJurisdictionPack,
  useResearchJurisdictionCodes,
  getGetCompanyReportSettingsQueryKey,
  getListCompanyJurisdictionPacksQueryKey,
} from '@workspace/api-client-react';
import type { ContractorLicense, JurisdictionPack, CodeCitation, OpeningStatement } from '@workspace/api-client-react';
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
        <JurisdictionPacksSection companyId={companyId} colors={colors} />
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

function JurisdictionPacksSection({ companyId, colors }: { companyId: string; colors: ReturnType<typeof useColors> }) {
  const queryClient = useQueryClient();
  const packsQuery = useListCompanyJurisdictionPacks(companyId, {
    query: { enabled: !!companyId, queryKey: getListCompanyJurisdictionPacksQueryKey(companyId) }
  });
  const deletePack = useDeleteCompanyJurisdictionPack();

  const packs = packsQuery.data?.packs || [];
  const [editorState, setEditorState] = useState<{ pack: JurisdictionPack | null } | null>(null);

  const confirmDelete = (pack: JurisdictionPack) => {
    Alert.alert(
      'Delete pack?',
      `"${pack.jurisdiction}" will be removed. Already-compiled Proof Packages are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePack.mutateAsync({ companyId, packId: pack.id });
              queryClient.invalidateQueries({ queryKey: getListCompanyJurisdictionPacksQueryKey(companyId) });
            } catch (err) {
              Alert.alert('Delete failed', err instanceof Error ? err.message : 'Check your connection and try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ gap: 16, marginTop: 16, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 24 }}>
      <View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>Building Regulation Jurisdiction Packs</Text>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 4 }}>
          Per-jurisdiction opening statements, UPPA law, and general / roofing / siding code citations for Proof Packages. You can create several packs per state.
        </Text>
      </View>

      {packsQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : (
        <View style={{ gap: 8 }}>
          {packs.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No jurisdiction packs yet.</Text>
          ) : (
            packs.map(p => (
              <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground }}>{p.jurisdiction}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>{p.state}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                  <Pressable onPress={() => setEditorState({ pack: p })}>
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(p)}>
                    <Icon name="x" size={18} color={colors.destructive} />
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      <Pressable
        onPress={() => setEditorState({ pack: null })}
        style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, alignSelf: 'flex-start' }}
      >
        <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>Add Jurisdiction Pack</Text>
      </Pressable>

      {editorState && (
        <Modal visible animationType="slide" presentationStyle="pageSheet">
          <JurisdictionPackEditor
            companyId={companyId}
            colors={colors}
            onClose={() => setEditorState(null)}
            existingPack={editorState.pack}
          />
        </Modal>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION PACK EDITOR
// ─────────────────────────────────────────────────────────────────────────────
type CitationCategory = 'general' | 'roofing' | 'siding';
const CATEGORY_LABELS: Record<CitationCategory, string> = {
  general: 'General Code Citations',
  roofing: 'Roofing Code Citations',
  siding: 'Siding Code Citations',
};

function JurisdictionPackEditor({
  companyId,
  colors,
  onClose,
  existingPack
}: {
  companyId: string;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
  existingPack: JurisdictionPack | null;
}) {
  const queryClient = useQueryClient();
  const upsertPack = useUpsertCompanyJurisdictionPack();

  const [jurisdiction, setJurisdiction] = useState(existingPack?.jurisdiction || '');
  const [state, setState] = useState(existingPack?.state || '');

  // Opening statements (applicable code book titles in effect).
  const [openingStatements, setOpeningStatements] = useState<OpeningStatement[]>(
    existingPack?.openingStatements || []
  );

  // UPPA
  const [uppaLaw, setUppaLaw] = useState(existingPack?.uppaLaw || '');
  const [uppaStatement, setUppaStatement] = useState(existingPack?.uppaStatement || '');

  // Code citations, per category.
  const [citations, setCitations] = useState<Record<CitationCategory, CodeCitation[]>>({
    general: existingPack?.generalCodeCitations || [],
    roofing: existingPack?.roofingCodeCitations || [],
    siding: existingPack?.sidingCodeCitations || [],
  });

  const allCitations = [...citations.general, ...citations.roofing, ...citations.siding];

  const researchCodes = useResearchJurisdictionCodes();
  const [researchQuery, setResearchQuery] = useState('');
  const [researchYear, setResearchYear] = useState<number | null>(null);
  const [researchCategory, setResearchCategory] = useState<CitationCategory>('general');
  const [researchSuggestions, setResearchSuggestions] = useState<CodeCitation[]>([]);

  const handleResearch = async () => {
    if (researchCodes.isPending) return;
    const stateCode = state.trim().toUpperCase();
    if (stateCode.length !== 2) {
      Alert.alert('State needed', 'Enter the pack\u2019s 2-letter state code before researching codes.');
      return;
    }
    try {
      const resp = await researchCodes.mutateAsync({
        companyId,
        state: stateCode,
        data: {
          query: researchQuery.trim() || null,
          editionYear: researchYear,
          existingKeys: allCitations.map(c => c.key),
          category: researchCategory,
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
    // Generate a unique key if it somehow conflicts (uniqueness is across all
    // three sections — keys are the compile-time selection identity).
    let key = suggestion.key;
    let counter = 1;
    while (allCitations.some(c => c.key === key)) {
      key = `${suggestion.key}_${counter}`;
      counter++;
    }
    setCitations(prev => ({ ...prev, [researchCategory]: [...prev[researchCategory], { ...suggestion, key }] }));
    setResearchSuggestions(researchSuggestions.filter(s => s.key !== suggestion.key));
  };

  const dismissSuggestion = (key: string) => {
    setResearchSuggestions(researchSuggestions.filter(s => s.key !== key));
  };

  const updateCitation = (cat: CitationCategory, index: number, field: keyof CodeCitation, value: string) => {
    setCitations(prev => {
      const list = [...prev[cat]];
      list[index] = { ...list[index], [field]: value };
      return { ...prev, [cat]: list };
    });
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

    const name = jurisdiction.trim();
    if (!name) {
      Alert.alert('Jurisdiction needed', 'Give the pack a jurisdiction name, e.g. "Dallas County, TX".');
      return;
    }
    const stateCode = state.trim().toUpperCase();
    if (stateCode.length !== 2) {
      Alert.alert('Invalid State', 'State must be a 2-letter code, e.g. TX.');
      return;
    }

    const statementsClean = openingStatements.map(s => ({ title: s.title.trim(), body: s.body.trim() }));
    for (const s of statementsClean) {
      if (!s.title || !s.body) {
        Alert.alert('Incomplete Opening Statement', 'Each opening statement needs a title and statement text, or remove empty ones.');
        return;
      }
    }

    const cleanList = (list: CodeCitation[]) => list.map(c => ({
      key: c.key.trim(),
      element: c.element.trim(),
      title: c.title.trim(),
      cite: c.cite.trim(),
      body: c.body.trim(),
    }));
    const cleaned: Record<CitationCategory, CodeCitation[]> = {
      general: cleanList(citations.general),
      roofing: cleanList(citations.roofing),
      siding: cleanList(citations.siding),
    };
    const flat = [...cleaned.general, ...cleaned.roofing, ...cleaned.siding];
    for (const c of flat) {
      if (!c.key || !c.element || !c.title || !c.cite || !c.body) {
        Alert.alert('Incomplete Citation', 'All fields in each code citation must be filled.');
        return;
      }
    }
    const keys = flat.map(c => c.key.toLowerCase());
    if (new Set(keys).size !== keys.length) {
      Alert.alert('Duplicate keys', 'Citation keys must be unique across the General, Roofing, and Siding lists.');
      return;
    }

    try {
      await upsertPack.mutateAsync({
        companyId,
        data: {
          pack: {
            id: existingPack?.id ?? null,
            jurisdiction: name,
            state: stateCode,
            openingStatements: statementsClean,
            uppaLaw: uppaLaw.trim() || null,
            uppaStatement: uppaStatement.trim() || null,
            generalCodeCitations: cleaned.general,
            roofingCodeCitations: cleaned.roofing,
            sidingCodeCitations: cleaned.siding,
          }
        }
      });
      Alert.alert('Saved', `"${name}" saved successfully.`);
      queryClient.invalidateQueries({ queryKey: getListCompanyJurisdictionPacksQueryKey(companyId) });
      onClose();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Check your connection and try again.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>
          {existingPack ? 'Edit Jurisdiction Pack' : 'New Jurisdiction Pack'}
        </Text>
        <Pressable onPress={onClose} style={{ padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 32 }}>

        {/* Identity */}
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Jurisdiction name * (e.g. Dallas County, TX)</Text>
            <TextInput
              style={inputStyle}
              value={jurisdiction}
              onChangeText={setJurisdiction}
              placeholder="Jurisdiction"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>State * (2 letters — used to match the property address)</Text>
            <TextInput
              style={[inputStyle, { width: 100 }]}
              value={state}
              onChangeText={setState}
              placeholder="TX"
              placeholderTextColor={colors.mutedForeground}
              maxLength={2}
              autoCapitalize="characters"
            />
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border }} />

        {/* Opening statements */}
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>Proof Package Opening Statement Titles</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
              The applicable code book titles in effect for this jurisdiction, each with its statement text. Printed at the front of the Proof Package.
            </Text>
          </View>
          {openingStatements.map((s, i) => (
            <View key={i} style={{ backgroundColor: colors.card, padding: 12, borderRadius: 8, gap: 8, borderWidth: 1, borderColor: colors.border }}>
              <TextInput
                style={[inputStyle, { fontWeight: '600' }]}
                placeholder="Title (e.g. 2021 International Residential Code)"
                placeholderTextColor={colors.mutedForeground}
                value={s.title}
                onChangeText={v => { const n = [...openingStatements]; n[i] = { ...n[i], title: v }; setOpeningStatements(n); }}
              />
              <TextInput
                style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
                placeholder="Statement text"
                placeholderTextColor={colors.mutedForeground}
                value={s.body}
                onChangeText={v => { const n = [...openingStatements]; n[i] = { ...n[i], body: v }; setOpeningStatements(n); }}
                multiline
              />
              <Pressable onPress={() => setOpeningStatements(openingStatements.filter((_, idx) => idx !== i))} style={{ alignSelf: 'flex-end' }}>
                <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => setOpeningStatements([...openingStatements, { title: '', body: '' }])}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add Opening Statement</Text>
          </Pressable>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border }} />

        {/* UPPA Section */}
        <View style={{ gap: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>UPPA Law and Statement</Text>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>UPPA Law (e.g. Texas Insurance Code § 4102.163)</Text>
            <TextInput
              style={inputStyle}
              value={uppaLaw}
              onChangeText={setUppaLaw}
              placeholder="Law / statute reference"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>UPPA Statement</Text>
            <TextInput
              style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
              value={uppaStatement}
              onChangeText={setUppaStatement}
              placeholder="We are not public adjusters..."
              placeholderTextColor={colors.mutedForeground}
              multiline
            />
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border }} />

        {/* Code Citations */}
        <View style={{ gap: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>Code Citations</Text>

          {/* AI Research Panel */}
          <View style={{ backgroundColor: colors.card, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>AI Code Research</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
                Find applicable building codes for roof/siding replacements{state.trim().length === 2 ? ` in ${state.trim().toUpperCase()}` : ''}. Suggestions you add go to the selected list.
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
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Add results to</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['general', 'roofing', 'siding'] as CitationCategory[]).map(cat => {
                  const selected = researchCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setResearchCategory(cat)}
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
                        {cat === 'general' ? 'General' : cat === 'roofing' ? 'Roofing' : 'Siding'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
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
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>
                Suggestions → {CATEGORY_LABELS[researchCategory]}
              </Text>
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

          {(['general', 'roofing', 'siding'] as CitationCategory[]).map(cat => (
            <View key={cat} style={{ gap: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{CATEGORY_LABELS[cat]}</Text>
              {citations[cat].length === 0 && (
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>None yet.</Text>
              )}
              {citations[cat].map((c, i) => (
                <View key={i} style={{ backgroundColor: colors.card, padding: 12, borderRadius: 8, gap: 8, borderWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput style={[inputStyle, { flex: 1 }]} placeholder="Key (e.g. drip_edge)" placeholderTextColor={colors.mutedForeground} value={c.key} onChangeText={v => updateCitation(cat, i, 'key', v)} />
                    <TextInput style={[inputStyle, { flex: 1 }]} placeholder="Element" placeholderTextColor={colors.mutedForeground} value={c.element} onChangeText={v => updateCitation(cat, i, 'element', v)} />
                  </View>
                  <TextInput style={inputStyle} placeholder="Title (e.g. IRC 2018)" placeholderTextColor={colors.mutedForeground} value={c.title} onChangeText={v => updateCitation(cat, i, 'title', v)} />
                  <TextInput style={inputStyle} placeholder="Citation (e.g. R905.2.8.5)" placeholderTextColor={colors.mutedForeground} value={c.cite} onChangeText={v => updateCitation(cat, i, 'cite', v)} />
                  <TextInput style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} placeholder="Body text" placeholderTextColor={colors.mutedForeground} value={c.body} onChangeText={v => updateCitation(cat, i, 'body', v)} multiline />
                  <Pressable onPress={() => setCitations(prev => ({ ...prev, [cat]: prev[cat].filter((_, idx) => idx !== i) }))} style={{ alignSelf: 'flex-end' }}>
                    <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '600' }}>Remove Citation</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={() => setCitations(prev => ({ ...prev, [cat]: [...prev[cat], { key: '', element: '', title: '', cite: '', body: '' }] }))}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add Citation</Text>
              </Pressable>
            </View>
          ))}
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
          {upsertPack.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Save Pack</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
