import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchInspection } from '@/lib/inspectionSync';

// Repairability Assessment v2 — structured question flow (2026-07-26 spec).
// Radio / yes-no-unknown selectors with conditional evidence requirements,
// so the record is defensible: a rep can never jump from "damage exists"
// straight to a replacement conclusion. The app only ever outputs one of
// four determinations; the server re-validates every gate on save.

type Answers = Record<string, string | string[]>;

interface FlowState {
  answers: Answers;
  determination: string | null;
  basisFactors: string[];
  nextStep: string | null;
  evidencePhotoIds: string[];
  evidenceDocRefs: string[];
  notes: string;
}

const emptyFlow = (): FlowState => ({
  answers: {},
  determination: null,
  basisFactors: [],
  nextStep: null,
  evidencePhotoIds: [],
  evidenceDocRefs: [],
  notes: '',
});

type Opt = { value: string; label: string };
const o = (value: string, label: string): Opt => ({ value, label });

const YNU: Opt[] = [o('yes', 'Yes'), o('no', 'No'), o('unknown', 'Unknown / Not verified')];
const YN_NA: Opt[] = [o('yes', 'Yes'), o('no', 'No'), o('not_applicable', 'Not applicable')];
const YN_UNK: Opt[] = [o('yes', 'Yes'), o('no', 'No'), o('unknown', 'Unknown')];

interface QuestionDef {
  id: string;
  label: string;
  type: 'radio' | 'multi';
  options: Opt[];
  visible?: (a: Answers) => boolean;
  hint?: string;
}

const IDENTIFICATION_SOURCES: Opt[] = [
  o('rear_stamp', 'Rear-side stamp'),
  o('physical_sample', 'Physical sample'),
  o('lab_report', 'Laboratory identification report'),
  o('manufacturer_confirmation', 'Manufacturer confirmation'),
  o('invoice_permit', 'Prior invoice or permit record'),
  o('field_comparison', 'Field comparison'),
  o('other', 'Other documented source'),
];

const DISCONTINUATION_OPTIONS: Opt[] = [
  o('manufacturer_confirmed', 'Yes — manufacturer confirmed'),
  o('distributor_confirmed', 'Yes — distributor confirmed'),
  o('reported_unverified', 'Reported but not verified'),
  o('no', 'No'),
  o('unknown', 'Unknown / Not verified'),
];

const DISCONTINUATION_EVIDENCE: Opt[] = [
  o('manufacturer_letter', 'Manufacturer letter or email'),
  o('manufacturer_document', 'Manufacturer product document'),
  o('distributor_confirmation', 'Distributor written confirmation'),
  o('supplier_confirmation', 'Supplier written confirmation'),
  o('other_document', 'Other document'),
];

const AVAILABILITY_OPTIONS: Opt[] = [
  o('sufficient_quantity', 'Yes — sufficient quantity located'),
  o('limited_quantity', 'Limited quantity located'),
  o('no_sufficient_quantity', 'No sufficient quantity located after documented search'),
  o('search_not_performed', 'Search not performed'),
  o('unknown', 'Unknown / Not verified'),
];

const SOURCES_SEARCHED: Opt[] = [
  o('manufacturer', 'Manufacturer'),
  o('local_distributor', 'Local distributor'),
  o('regional_distributor', 'Regional distributor'),
  o('salvage_supplier', 'Salvage supplier'),
  o('specialty_supplier', 'Specialty supplier'),
  o('contractor_inventory', 'Existing contractor inventory'),
  o('other', 'Other documented source'),
];

const TEST_PERFORMED_OPTIONS: Opt[] = [
  o('yes', 'Yes'),
  o('no_authorization', 'No — owner authorization not obtained'),
  o('no_not_needed', 'No — not needed based on existing evidence'),
  o('no_unsafe', 'No — unsafe conditions'),
  o('no_deferred', 'No — deferred pending further review'),
  o('no_emergency', 'No — emergency mitigation was required'),
];

const ACCESS_OPTIONS: Opt[] = [
  o('yes', 'Yes'),
  o('limited', 'Yes, with limited access'),
  o('no', 'No'),
  o('unknown', 'Unknown / Not verified'),
];

const ACCESS_LIMITS: Opt[] = [
  o('steep_pitch', 'Steep pitch'),
  o('height', 'Height'),
  o('geometry', 'Roof geometry'),
  o('weather', 'Active weather conditions'),
  o('safety', 'Safety limitation'),
  o('vegetation', 'Vegetation or site obstruction'),
  o('not_authorized', 'Access not authorized'),
  o('other', 'Other documented condition'),
];

function roofQuestions(facetOptions: Opt[]): QuestionDef[] {
  return [
    { id: 'RR-001', label: 'Is direct physical roof-covering damage documented?', type: 'radio', options: YNU },
    {
      id: 'RR-002',
      label: 'Which roof facet(s) or area(s) are being assessed?',
      type: 'multi',
      options: [...facetOptions, o('other_area', 'Other documented roof area')],
      visible: (a) => a['RR-001'] === 'yes',
    },
    { id: 'RR-003', label: 'Is the affected roofing material accessible for evaluation?', type: 'radio', options: ACCESS_OPTIONS },
    {
      id: 'RR-003A',
      label: 'What limits access?',
      type: 'multi',
      options: ACCESS_LIMITS,
      visible: (a) => a['RR-003'] === 'limited',
      hint: 'Access limitations alone cannot support "spot repair not supported".',
    },
    {
      id: 'RR-004',
      label: 'Assessment type',
      type: 'radio',
      options: [
        o('visual_screening', 'Visual and documentary screening only'),
        o('non_destructive', 'Controlled non-destructive evaluation'),
        o('controlled_test', 'Controlled repairability test'),
        o('post_removal', 'Post-removal concealed-condition evaluation'),
      ],
    },
    {
      id: 'RR-010',
      label: 'Is the existing roofing product identified?',
      type: 'radio',
      options: [
        o('exact', 'Exact manufacturer and product identified'),
        o('manufacturer_profile', 'Manufacturer and profile identified; exact product not confirmed'),
        o('material_type_only', 'Material type identified only'),
        o('not_identified', 'Not identified'),
      ],
    },
    {
      id: 'RR-011',
      label: 'What supports the roofing product identification?',
      type: 'multi',
      options: IDENTIFICATION_SOURCES,
      visible: (a) => !!a['RR-010'] && a['RR-010'] !== 'not_identified',
      hint: 'Requires at least one linked photo, sample, lab result, invoice, or document reference below.',
    },
    { id: 'RR-012', label: 'Is the existing product documented as discontinued?', type: 'radio', options: DISCONTINUATION_OPTIONS },
    {
      id: 'RR-012A',
      label: 'Discontinuation evidence',
      type: 'multi',
      options: DISCONTINUATION_EVIDENCE,
      visible: (a) => a['RR-012'] === 'manufacturer_confirmed' || a['RR-012'] === 'distributor_confirmed',
      hint: '"Discontinued" cannot be used as a basis factor unless evidence is linked.',
    },
    { id: 'RR-020', label: 'Has a sufficient quantity of the same roofing product been located?', type: 'radio', options: AVAILABILITY_OPTIONS },
    {
      id: 'RR-020A',
      label: 'What sources were searched?',
      type: 'multi',
      options: SOURCES_SEARCHED,
      visible: (a) =>
        a['RR-020'] === 'sufficient_quantity' ||
        a['RR-020'] === 'limited_quantity' ||
        a['RR-020'] === 'no_sufficient_quantity',
    },
    { id: 'RR-021', label: 'Has a proposed substitute shingle been identified?', type: 'radio', options: YN_NA },
    {
      id: 'RR-021A',
      label: 'Has the substitute been physically compared to the existing shingle?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('pending', 'Comparison pending')],
      visible: (a) => a['RR-021'] === 'yes',
    },
    {
      id: 'RR-021B',
      label: 'Which differences were documented?',
      type: 'multi',
      options: [
        o('exposure', 'Exposure'),
        o('thickness', 'Thickness'),
        o('overall_profile', 'Overall profile'),
        o('tab_profile', 'Tab profile'),
        o('seal_strip', 'Seal strip location'),
        o('nail_zone', 'Nail zone'),
        o('granule_texture', 'Granule texture'),
        o('color', 'Color'),
        o('wind_classification', 'Wind classification'),
        o('starter_compatibility', 'Starter compatibility'),
        o('ridge_compatibility', 'Ridge compatibility'),
        o('other', 'Other measured difference'),
      ],
      visible: (a) => a['RR-021'] === 'yes' && a['RR-021A'] === 'yes',
      hint: 'Any selected difference requires linked photo, measurement, sample comparison, or document reference below.',
    },
    {
      id: 'RR-030',
      label: 'Would the documented repair method require lifting or disturbing adjacent undamaged shingles?',
      type: 'radio',
      options: YNU,
    },
    {
      id: 'RR-030A',
      label: 'What adjacent materials must be disturbed?',
      type: 'multi',
      options: [
        o('overlying_course', 'Overlying shingle course'),
        o('adjacent_field', 'Adjacent field shingles'),
        o('ridge_hip', 'Ridge or hip shingles'),
        o('starter', 'Starter shingles'),
        o('flashing', 'Flashing'),
        o('underlayment', 'Underlayment'),
        o('vent_penetration', 'Vent or penetration component'),
        o('other', 'Other documented component'),
      ],
      visible: (a) => a['RR-030'] === 'yes',
    },
    {
      id: 'RR-031',
      label: 'Are the existing shingles documented as capable of being reset after lifting?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('not_tested', 'Not tested'), o('unknown', 'Unknown / Not verified')],
      hint: '"No" requires direct test evidence or a documented manufacturer/product limitation.',
    },
    {
      id: 'RR-032',
      label: 'Is a manufacturer repair or installation method available for the identified roofing product?',
      type: 'radio',
      options: [
        o('supports', 'Yes — supports proposed repair method'),
        o('does_not_support', 'Yes — does not support proposed repair method'),
        o('not_reviewed', 'Available but not reviewed'),
        o('not_available', 'Not available'),
        o('product_not_identified', 'Product not sufficiently identified'),
      ],
      hint: 'If "supports" or "does not support" is selected, add a document reference below.',
    },
    { id: 'RR-040', label: 'Was a controlled roofing repairability test performed?', type: 'radio', options: TEST_PERFORMED_OPTIONS },
    {
      id: 'RR-041',
      label: 'Was the test initiated at an already damaged shingle?',
      type: 'radio',
      options: YN_NA,
      visible: (a) => a['RR-040'] === 'yes',
    },
    {
      id: 'RR-042',
      label: 'Did the test require lifting adjacent shingles to access fasteners?',
      type: 'radio',
      options: YN_UNK,
      visible: (a) => a['RR-040'] === 'yes',
    },
    {
      id: 'RR-043',
      label: 'Did adjacent shingles fracture, tear, delaminate, or become damaged during the test?',
      type: 'radio',
      options: YN_NA,
      visible: (a) => a['RR-040'] === 'yes',
      hint: 'If Yes: photo or video evidence is required below.',
    },
    {
      id: 'RR-044',
      label: 'Could adjacent shingles be reset into a secure, weather-resistant position?',
      type: 'radio',
      options: YN_UNK,
      visible: (a) => a['RR-040'] === 'yes',
    },
    {
      id: 'RR-045',
      label: 'Was a verified compatible replacement shingle available for the test?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('not_evaluated', 'Product compatibility not evaluated')],
      visible: (a) => a['RR-040'] === 'yes',
    },
    {
      id: 'RR-046',
      label: 'If a replacement was tested, did it integrate with the existing roof covering?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('partially', 'Partially'), o('not_applicable', 'Not applicable')],
      visible: (a) => a['RR-040'] === 'yes' && a['RR-045'] === 'yes',
    },
    {
      id: 'RR-047',
      label: 'Did the controlled test create an exposed or non-weather-resistant condition?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No')],
      visible: (a) => a['RR-040'] === 'yes',
    },
    {
      id: 'RR-047A',
      label: 'What condition occurred?',
      type: 'multi',
      options: [
        o('adjacent_fractured', 'Adjacent shingle fractured'),
        o('could_not_reset', 'Shingle could not be reset'),
        o('underlayment_exposed', 'Underlayment exposed'),
        o('fastener_holes', 'Fastener holes could not be reliably resealed'),
        o('material_split', 'Material split, tore, or deformed'),
        o('other', 'Other documented condition'),
      ],
      visible: (a) => a['RR-040'] === 'yes' && a['RR-047'] === 'yes',
    },
    {
      id: 'RR-047B',
      label: 'Was temporary weather protection installed?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('not_needed', 'Not needed')],
      visible: (a) => a['RR-040'] === 'yes' && a['RR-047'] === 'yes',
    },
    {
      id: 'RR-047C',
      label: 'Temporary protection type',
      type: 'multi',
      options: [
        o('tarp', 'Tarp'),
        o('membrane', 'Temporary membrane'),
        o('replacement_material', 'Temporary replacement material'),
        o('other', 'Other documented protection'),
      ],
      visible: (a) => a['RR-040'] === 'yes' && a['RR-047'] === 'yes' && a['RR-047B'] === 'yes',
    },
    {
      id: 'RR-048',
      label: 'Were test photos or video linked?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No')],
      visible: (a) => a['RR-040'] === 'yes',
      hint: 'A test cannot support the final determination unless photos/video are linked.',
    },
  ];
}

function sidingQuestions(): QuestionDef[] {
  return [
    { id: 'SR-001', label: 'Is direct physical siding damage documented?', type: 'radio', options: YNU },
    {
      id: 'SR-002',
      label: 'Which siding elevation(s) or area(s) are being assessed?',
      type: 'multi',
      options: [
        o('front', 'Front'),
        o('right', 'Right'),
        o('rear', 'Rear'),
        o('left', 'Left'),
        o('other', 'Other labeled elevation'),
      ],
      visible: (a) => a['SR-001'] === 'yes',
    },
    { id: 'SR-003', label: 'Is the damaged siding accessible for evaluation?', type: 'radio', options: ACCESS_OPTIONS },
    {
      id: 'SR-004',
      label: 'Assessment type',
      type: 'radio',
      options: [
        o('visual_screening', 'Visual and documentary screening only'),
        o('non_destructive', 'Controlled non-destructive evaluation'),
        o('panel_detach_test', 'Controlled panel-detach test'),
        o('post_removal', 'Post-removal concealed-condition evaluation'),
      ],
    },
    {
      id: 'SR-010',
      label: 'Is the existing siding product identified?',
      type: 'radio',
      options: [
        o('exact', 'Exact manufacturer and product identified'),
        o('manufacturer_profile', 'Manufacturer and profile identified; exact product not confirmed'),
        o('material_type_only', 'Material type identified only'),
        o('not_identified', 'Not identified'),
      ],
    },
    {
      id: 'SR-011',
      label: 'What supports the siding identification?',
      type: 'multi',
      options: IDENTIFICATION_SOURCES,
      visible: (a) => !!a['SR-010'] && a['SR-010'] !== 'not_identified',
      hint: 'Requires at least one linked photo, sample, lab result, invoice, or document reference below.',
    },
    { id: 'SR-012', label: 'Is the existing siding documented as discontinued?', type: 'radio', options: DISCONTINUATION_OPTIONS },
    {
      id: 'SR-012A',
      label: 'Discontinuation evidence',
      type: 'multi',
      options: DISCONTINUATION_EVIDENCE,
      visible: (a) => a['SR-012'] === 'manufacturer_confirmed' || a['SR-012'] === 'distributor_confirmed',
      hint: '"Discontinued" cannot be used as a basis factor unless evidence is linked.',
    },
    { id: 'SR-020', label: 'Has a sufficient quantity of the same siding product been located?', type: 'radio', options: AVAILABILITY_OPTIONS },
    {
      id: 'SR-020A',
      label: 'What sources were searched?',
      type: 'multi',
      options: SOURCES_SEARCHED,
      visible: (a) =>
        a['SR-020'] === 'sufficient_quantity' ||
        a['SR-020'] === 'limited_quantity' ||
        a['SR-020'] === 'no_sufficient_quantity',
    },
    { id: 'SR-021', label: 'Has a substitute siding product been identified?', type: 'radio', options: YN_NA },
    {
      id: 'SR-021A',
      label: 'Has the substitute been physically compared to the existing siding?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('pending', 'Comparison pending')],
      visible: (a) => a['SR-021'] === 'yes',
    },
    {
      id: 'SR-021B',
      label: 'Which differences were documented?',
      type: 'multi',
      options: [
        o('exposure', 'Exposure'),
        o('thickness', 'Thickness'),
        o('panel_profile', 'Panel profile'),
        o('butt_projection', 'Butt projection'),
        o('lock_geometry', 'Lock geometry'),
        o('nail_hem', 'Nail hem'),
        o('texture', 'Texture'),
        o('gloss', 'Gloss'),
        o('color', 'Color'),
        o('panel_length', 'Panel length'),
        o('corner_compatibility', 'Corner compatibility'),
        o('trim_compatibility', 'Trim compatibility'),
        o('other', 'Other measured difference'),
      ],
      visible: (a) => a['SR-021'] === 'yes' && a['SR-021A'] === 'yes',
      hint: 'Any selected difference requires linked photo, measurement, sample comparison, or document reference below.',
    },
    { id: 'SR-030', label: 'Would repair require detaching adjacent undamaged siding panels?', type: 'radio', options: YNU },
    { id: 'SR-031', label: 'Are continuous courses or interlocking panels involved?', type: 'radio', options: YNU },
    { id: 'SR-032', label: 'Is there a documented natural break near the damaged area?', type: 'radio', options: YNU },
    {
      id: 'SR-032A',
      label: 'What type of natural break is documented?',
      type: 'multi',
      options: [
        o('outside_corner', 'Outside corner with corner post'),
        o('inside_corner', 'Inside corner'),
        o('masonry_transition', 'Full-height masonry transition'),
        o('cladding_transition', 'Distinct cladding transition'),
        o('story_break', 'Story break'),
        o('trim_band', 'Full-width trim band'),
        o('other', 'Other documented break'),
      ],
      visible: (a) => a['SR-032'] === 'yes',
    },
    {
      id: 'SR-033',
      label: 'Would a limited repair disturb weather-resistive barrier, flashing, trim, or accessory components?',
      type: 'radio',
      options: YNU,
    },
    { id: 'SR-040', label: 'Was a controlled panel-detach or repairability test performed?', type: 'radio', options: TEST_PERFORMED_OPTIONS },
    {
      id: 'SR-041',
      label: 'Was the test initiated at an already damaged panel or area?',
      type: 'radio',
      options: YN_NA,
      visible: (a) => a['SR-040'] === 'yes',
    },
    {
      id: 'SR-042',
      label: 'Did adjacent panels crack, deform, tear, or become damaged during the test?',
      type: 'radio',
      options: YN_NA,
      visible: (a) => a['SR-040'] === 'yes',
    },
    {
      id: 'SR-043',
      label: 'Could adjacent panels be reset and re-engaged securely?',
      type: 'radio',
      options: YN_UNK,
      visible: (a) => a['SR-040'] === 'yes',
    },
    {
      id: 'SR-044',
      label: 'Did the proposed substitute engage the existing lock system?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('partially', 'Partially'), o('no_substitute', 'No substitute tested')],
      visible: (a) => a['SR-040'] === 'yes',
    },
    {
      id: 'SR-045',
      label: 'Did the controlled test disturb WRB, flashing, trim, or accessory components?',
      type: 'radio',
      options: YN_UNK,
      visible: (a) => a['SR-040'] === 'yes',
    },
    {
      id: 'SR-046',
      label: 'Did the test create an exposed or non-weather-resistant condition?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No')],
      visible: (a) => a['SR-040'] === 'yes',
    },
    {
      id: 'SR-046A',
      label: 'Was temporary protection installed?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('not_needed', 'Not needed')],
      visible: (a) => a['SR-040'] === 'yes' && a['SR-046'] === 'yes',
    },
    {
      id: 'SR-046B',
      label: 'Temporary protection type',
      type: 'multi',
      options: [
        o('membrane', 'Temporary membrane'),
        o('panel', 'Temporary panel'),
        o('tarp', 'Tarp'),
        o('flashing_protection', 'Temporary flashing protection'),
        o('other', 'Other documented protection'),
      ],
      visible: (a) => a['SR-040'] === 'yes' && a['SR-046'] === 'yes' && a['SR-046A'] === 'yes',
    },
  ];
}

const DETERMINATION_OPTIONS: Opt[] = [
  o('supported', 'Spot repair supported by documented evidence'),
  o('conditionally_supported', 'Spot repair conditionally supported'),
  o('not_supported', 'Documented evidence does not support a reliable spot repair'),
  o('indeterminate', 'Repairability cannot yet be determined'),
];

const ROOF_BASIS_OPTIONS: Opt[] = [
  o('same_product_available', 'Same product available in sufficient quantity'),
  o('same_product_unavailable', 'Same product unavailable in sufficient quantity'),
  o('substitute_compatible', 'Substitute product physically compatible'),
  o('substitute_not_compatible', 'Substitute product not physically compatible'),
  o('removal_no_adjacent_damage', 'Controlled removal completed without adjacent damage'),
  o('removal_caused_adjacent_damage', 'Controlled removal caused adjacent damage'),
  o('shingles_reset_securely', 'Existing shingles reset securely'),
  o('shingles_could_not_reset', 'Existing shingles could not be reset securely'),
  o('manufacturer_supports_repair', 'Manufacturer guidance supports repair'),
  o('manufacturer_does_not_support_repair', 'Manufacturer guidance does not support repair'),
  o('repair_requires_disturbance', 'Repair requires disturbance of additional materials'),
  o('repair_within_damaged_area', 'Repair can be completed without disturbance beyond damaged area'),
  o('evidence_incomplete', 'Supporting evidence remains incomplete'),
];

const SIDING_BASIS_OPTIONS: Opt[] = [
  o('same_product_available', 'Same product available in sufficient quantity'),
  o('same_product_unavailable', 'Same product unavailable in sufficient quantity'),
  o('substitute_compatible', 'Substitute product physically compatible'),
  o('substitute_not_compatible', 'Substitute product not physically compatible'),
  o('panels_detached_without_damage', 'Existing panels detached without damage'),
  o('panels_cracked_during_test', 'Existing panels cracked or deformed during testing'),
  o('panels_reset_securely', 'Existing panels reset securely'),
  o('panels_could_not_reset', 'Existing panels could not be reset securely'),
  o('locks_engaged', 'Existing and substitute locks engaged'),
  o('locks_did_not_engage', 'Existing and substitute locks did not engage'),
  o('repair_requires_additional_panels', 'Repair requires disturbance of additional panels'),
  o('repair_terminates_at_natural_break', 'Repair can terminate at a documented natural break'),
  o('no_natural_break', 'No documented natural break supports the proposed limited repair'),
  o('disturbs_wrb_flashing_trim', 'Repair disturbs WRB, flashing, trim, or accessories'),
  o('evidence_incomplete', 'Supporting evidence remains incomplete'),
];

const ROOF_NEXT_STEPS: Opt[] = [
  o('prepare_repair_scope', 'Prepare limited roofing repair scope'),
  o('obtain_product_id', 'Obtain product identification'),
  o('obtain_availability', 'Obtain availability documentation'),
  o('obtain_substitute_comparison', 'Obtain substitute comparison'),
  o('obtain_manufacturer_instructions', 'Obtain manufacturer repair instructions'),
  o('conduct_test', 'Conduct controlled repairability test'),
  o('maintain_protection', 'Maintain temporary weather protection'),
  o('document_concealed', 'Document concealed conditions after removal'),
  o('prepare_summary', 'Prepare repairability summary from current record'),
];

const SIDING_NEXT_STEPS: Opt[] = [
  o('prepare_repair_scope', 'Prepare limited siding repair scope'),
  o('obtain_product_id', 'Obtain product identification'),
  o('obtain_availability', 'Obtain availability documentation'),
  o('obtain_substitute_comparison', 'Obtain substitute comparison'),
  o('document_natural_breaks', 'Document natural breaks and visibility'),
  o('conduct_panel_detach_test', 'Conduct controlled panel-detach test'),
  o('maintain_protection', 'Maintain temporary protection'),
  o('document_concealed', 'Document concealed conditions after removal'),
  o('prepare_summary', 'Prepare repairability summary from current record'),
];

// --- Client-side mirror of the server validation gates (server re-checks). ---

const DIRECT_FACTORS = new Set([
  'removal_no_adjacent_damage', 'removal_caused_adjacent_damage', 'shingles_reset_securely',
  'shingles_could_not_reset', 'panels_detached_without_damage', 'panels_cracked_during_test',
  'panels_reset_securely', 'panels_could_not_reset', 'locks_engaged', 'locks_did_not_engage',
]);
const PRODUCT_FACTORS = new Set([
  'same_product_available', 'same_product_unavailable', 'substitute_compatible', 'substitute_not_compatible',
]);
const MANUFACTURER_FACTORS = new Set(['manufacturer_supports_repair', 'manufacturer_does_not_support_repair']);
const LIMITATION_FACTORS = new Set([
  'same_product_unavailable', 'substitute_not_compatible', 'removal_caused_adjacent_damage',
  'shingles_could_not_reset', 'manufacturer_does_not_support_repair', 'repair_requires_disturbance',
  'panels_cracked_during_test', 'panels_could_not_reset', 'locks_did_not_engage',
  'repair_requires_additional_panels', 'no_natural_break', 'disturbs_wrb_flashing_trim', 'evidence_incomplete',
]);

function validateFlow(system: 'roof' | 'siding', flow: FlowState): string[] {
  const q = system === 'roof' ? 'RR' : 'SR';
  const label = system === 'roof' ? 'Roofing' : 'Siding';
  const a = flow.answers;
  const errors: string[] = [];
  const single = (id: string) => (typeof a[id] === 'string' ? (a[id] as string) : undefined);
  const multi = (id: string) => (Array.isArray(a[id]) ? (a[id] as string[]) : []);
  const hasEvidence = flow.evidencePhotoIds.length > 0 || flow.evidenceDocRefs.length > 0;

  for (const id of ['001', '003', '004', '010', '012', '020', '021', '040']) {
    if (!single(`${q}-${id}`)) errors.push(`${label}: answer ${q}-${id} — it is required.`);
  }
  if (single(`${q}-001`) === 'yes' && multi(`${q}-002`).length === 0) {
    errors.push(`${label}: select the affected area(s) being assessed.`);
  }
  if (
    (single(`${q}-001`) === 'no' || single(`${q}-001`) === 'unknown') &&
    flow.determination !== 'indeterminate'
  ) {
    errors.push(`${label}: without documented damage, the determination must be "Repairability cannot yet be determined".`);
  }
  const pid = single(`${q}-010`);
  if (pid && pid !== 'not_identified') {
    if (multi(`${q}-011`).length === 0) errors.push(`${label}: select what supports the product identification.`);
    if (!hasEvidence) errors.push(`${label}: product identification requires linked photo or document evidence.`);
  }
  const disc = single(`${q}-012`);
  if ((disc === 'manufacturer_confirmed' || disc === 'distributor_confirmed') && (multi(`${q}-012A`).length === 0 || !hasEvidence)) {
    errors.push(`${label}: confirmed discontinuation requires linked manufacturer/distributor evidence.`);
  }
  if (single(`${q}-020`) === 'no_sufficient_quantity' && multi(`${q}-020A`).length === 0) {
    errors.push(`${label}: "no sufficient quantity" requires the sources searched.`);
  }
  if (flow.basisFactors.includes('same_product_unavailable') && single(`${q}-020`) !== 'no_sufficient_quantity') {
    errors.push(`${label}: "same product unavailable" requires a documented search finding no sufficient quantity.`);
  }
  if (multi(`${q}-021B`).length > 0 && !hasEvidence) {
    errors.push(`${label}: documented substitute differences require linked evidence.`);
  }
  if (flow.basisFactors.includes('same_product_available') && single(`${q}-020`) !== 'sufficient_quantity') {
    errors.push(`${label}: "same product available" requires a documented sufficient-quantity finding.`);
  }
  if (
    (flow.basisFactors.includes('substitute_compatible') || flow.basisFactors.includes('substitute_not_compatible')) &&
    single(`${q}-021A`) !== 'yes'
  ) {
    errors.push(`${label}: substitute-compatibility factors require a completed physical comparison.`);
  }
  if (flow.determination && flow.determination !== 'indeterminate' && !hasEvidence) {
    errors.push(`${label}: a conclusive determination requires linked photo or document evidence.`);
  }

  const testPerformed = single(`${q}-040`) === 'yes';
  const testMediaLinked = system === 'roof' ? single('RR-048') === 'yes' : hasEvidence;
  const testFactors = flow.basisFactors.filter((f) => DIRECT_FACTORS.has(f));
  if (testFactors.length > 0) {
    if (!testPerformed) {
      errors.push(`${label}: test-derived basis factors require a controlled test (answer Yes to ${q}-040).`);
    } else if (!testMediaLinked || !hasEvidence) {
      errors.push(`${label}: a controlled test cannot support the determination unless test photos/video are linked.`);
    }
  }
  const couldNotReset = flow.basisFactors.includes('shingles_could_not_reset') || flow.basisFactors.includes('panels_could_not_reset');
  if (couldNotReset) {
    const mfrLimit = single(`${q}-032`) === 'does_not_support' && hasEvidence;
    if (!(testPerformed && testMediaLinked && hasEvidence) && !mfrLimit) {
      errors.push(`${label}: "could not be reset" requires a linked test record or documented manufacturer limitation.`);
    }
  }
  if (flow.basisFactors.some((f) => MANUFACTURER_FACTORS.has(f))) {
    const mfr = single(`${q}-032`);
    if ((mfr !== 'supports' && mfr !== 'does_not_support') || !hasEvidence) {
      errors.push(`${label}: manufacturer-guidance basis factors require a reviewed method with a linked document reference.`);
    }
  }

  if (flow.basisFactors.length === 0) errors.push(`${label}: select at least one documented basis factor.`);
  const direct = flow.basisFactors.some((f) => DIRECT_FACTORS.has(f));
  const product = flow.basisFactors.some((f) => PRODUCT_FACTORS.has(f));
  const manufacturer = flow.basisFactors.some((f) => MANUFACTURER_FACTORS.has(f));
  const supporting = flow.basisFactors.some((f) => f !== 'evidence_incomplete');
  const limitation = flow.basisFactors.some((f) => LIMITATION_FACTORS.has(f));
  switch (flow.determination) {
    case 'supported':
      if (!(direct || product || manufacturer)) {
        errors.push(`${label}: "supported" requires at least one direct-test, product, or manufacturer basis factor.`);
      }
      break;
    case 'conditionally_supported':
      if (!supporting || !limitation) {
        errors.push(`${label}: "conditionally supported" requires a supporting factor plus an unresolved limitation.`);
      }
      break;
    case 'not_supported':
      if (flow.basisFactors.length < 2 || !(direct || product)) {
        errors.push(`${label}: "does not support" requires at least two basis factors, including one direct-test or product-evidence factor.`);
      }
      break;
    case 'indeterminate':
      if (!flow.basisFactors.includes('evidence_incomplete')) {
        errors.push(`${label}: "cannot yet be determined" requires the "supporting evidence remains incomplete" factor.`);
      }
      break;
    default:
      errors.push(`${label}: select a determination.`);
  }
  if (!flow.nextStep) errors.push(`${label}: select the next step.`);
  return errors;
}

export default function InspectionRepairabilityScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.repairabilityAssessment ?? null;

  const [systems, setSystems] = React.useState<Array<'roof' | 'siding'>>([]);
  const [roofFlow, setRoofFlow] = React.useState<FlowState>(emptyFlow());
  const [sidingFlow, setSidingFlow] = React.useState<FlowState>(emptyFlow());
  const [docRefDraft, setDocRefDraft] = React.useState<{ roof: string; siding: string }>({ roof: '', siding: '' });
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (existing && !hydrated) {
      const ex = existing as unknown as {
        version?: number;
        systems?: Array<'roof' | 'siding'>;
        roof?: Partial<FlowState> & { determination?: string; nextStep?: string } | null;
        siding?: Partial<FlowState> & { determination?: string; nextStep?: string } | null;
      };
      if (ex.version === 2) {
        setSystems(ex.systems ?? []);
        const toState = (f: NonNullable<typeof ex.roof>): FlowState => ({
          answers: (f.answers as Answers) ?? {},
          determination: f.determination ?? null,
          basisFactors: f.basisFactors ?? [],
          nextStep: f.nextStep ?? null,
          evidencePhotoIds: f.evidencePhotoIds ?? [],
          evidenceDocRefs: f.evidenceDocRefs ?? [],
          notes: f.notes ?? '',
        });
        if (ex.roof) setRoofFlow(toState(ex.roof));
        if (ex.siding) setSidingFlow(toState(ex.siding));
      }
      // Legacy (v1) records are not hydrated into the new flow — the rep
      // re-records using the structured questions; the old record remains
      // until a valid new one is saved.
      setHydrated(true);
    }
  }, [existing, hydrated]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Repairability' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Repairability' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const photos = inspection.photos ?? [];
  const facetOptions: Opt[] = (inspection.slopes ?? []).map((s) => o(`facet:${s.id}`, s.label));

  function buildPayloadFlow(flow: FlowState) {
    return {
      answers: flow.answers,
      determination: flow.determination as 'supported' | 'conditionally_supported' | 'not_supported' | 'indeterminate',
      basisFactors: flow.basisFactors,
      nextStep: flow.nextStep ?? '',
      evidencePhotoIds: flow.evidencePhotoIds,
      evidenceDocRefs: flow.evidenceDocRefs,
      ...(flow.notes.trim() ? { notes: flow.notes.trim() } : {}),
    };
  }

  async function save() {
    if (saving) return;
    const allErrors: string[] = [];
    if (systems.length === 0) allErrors.push('Select at least one system (roof or siding) to assess.');
    if (systems.includes('roof')) allErrors.push(...validateFlow('roof', roofFlow));
    if (systems.includes('siding')) allErrors.push(...validateFlow('siding', sidingFlow));
    setErrors(allErrors);
    if (allErrors.length > 0) return;
    setSaving(true);
    try {
      await patchInspection(queryClient, id, {
        repairabilityAssessment: {
          version: 2,
          systems,
          ...(systems.includes('roof') ? { roof: buildPayloadFlow(roofFlow) } : { roof: null }),
          ...(systems.includes('siding') ? { siding: buildPayloadFlow(sidingFlow) } : { siding: null }),
          recordedAtUtc: new Date().toISOString(),
        },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function renderFlow(system: 'roof' | 'siding') {
    const flow = system === 'roof' ? roofFlow : sidingFlow;
    const setFlow = system === 'roof' ? setRoofFlow : setSidingFlow;
    const questions = system === 'roof' ? roofQuestions(facetOptions) : sidingQuestions();
    const basisOptions = system === 'roof' ? ROOF_BASIS_OPTIONS : SIDING_BASIS_OPTIONS;
    const nextSteps = system === 'roof' ? ROOF_NEXT_STEPS : SIDING_NEXT_STEPS;
    const title = system === 'roof' ? 'Roofing Repairability' : 'Siding Repairability';

    const setAnswer = (qid: string, v: string | string[] | undefined) =>
      setFlow((f) => {
        const answers = { ...f.answers };
        if (v === undefined || (Array.isArray(v) && v.length === 0)) delete answers[qid];
        else answers[qid] = v;
        return { ...f, answers };
      });

    return (
      <View key={system} style={[styles.flowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.flowTitle, { color: colors.foreground }]}>{title}</Text>

        {questions.map((qd) => {
          if (qd.visible && !qd.visible(flow.answers)) return null;
          const current = flow.answers[qd.id];
          return (
            <View key={qd.id} style={{ gap: 6 }}>
              <Text style={[styles.qLabel, { color: colors.foreground }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{qd.id}  </Text>
                {qd.label}
              </Text>
              <View style={styles.chipWrap}>
                {qd.options.map((opt) => {
                  const on =
                    qd.type === 'radio'
                      ? current === opt.value
                      : Array.isArray(current) && current.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        if (qd.type === 'radio') {
                          setAnswer(qd.id, on ? undefined : opt.value);
                        } else {
                          const arr = Array.isArray(current) ? [...current] : [];
                          setAnswer(
                            qd.id,
                            on ? arr.filter((v) => v !== opt.value) : [...arr, opt.value],
                          );
                        }
                      }}
                      style={[
                        styles.chip,
                        {
                          borderColor: on ? colors.primary : colors.border,
                          backgroundColor: on ? colors.primary + '22' : 'transparent',
                        },
                      ]}
                    >
                      <Text style={{ color: on ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '600' }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {qd.hint ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{qd.hint}</Text>
              ) : null}
            </View>
          );
        })}

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Linked evidence</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          Answers that support a conclusion must link a photo, measurement, sample, document, or
          test record. Tap photos to link them; add document references (letters, lab reports,
          supplier searches) below.
        </Text>
        {photos.length > 0 ? (
          <View style={styles.chipWrap}>
            {photos.map((p, pi) => {
              const on = flow.evidencePhotoIds.includes(p.id);
              const label = [p.zone, p.stage].filter(Boolean).join(' · ') || `Photo ${pi + 1}`;
              return (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    setFlow((f) => ({
                      ...f,
                      evidencePhotoIds: on
                        ? f.evidencePhotoIds.filter((x) => x !== p.id)
                        : [...f.evidencePhotoIds, p.id],
                    }))
                  }
                  style={[
                    styles.chip,
                    {
                      borderColor: on ? colors.secondary : colors.border,
                      backgroundColor: on ? colors.secondary + '22' : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: on ? colors.secondary : colors.mutedForeground, fontSize: 12, fontWeight: '600' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            No photos captured yet — capture inspection photos to link them here.
          </Text>
        )}
        {flow.evidenceDocRefs.map((ref, ri) => (
          <View key={ri} style={styles.docRefRow}>
            <Text style={{ color: colors.foreground, flex: 1, fontSize: 13 }}>{ref}</Text>
            <Pressable
              onPress={() =>
                setFlow((f) => ({ ...f, evidenceDocRefs: f.evidenceDocRefs.filter((_, i) => i !== ri) }))
              }
            >
              <Icon name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ))}
        <View style={styles.docRefRow}>
          <TextInput
            value={docRefDraft[system]}
            onChangeText={(t) => setDocRefDraft((d) => ({ ...d, [system]: t }))}
            placeholder="e.g. GAF discontinuation letter 6/12/2026"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <Pressable
            onPress={() => {
              const t = docRefDraft[system].trim();
              if (!t) return;
              setFlow((f) => ({ ...f, evidenceDocRefs: [...f.evidenceDocRefs, t] }));
              setDocRefDraft((d) => ({ ...d, [system]: '' }));
            }}
            style={[styles.addBtn, { borderColor: colors.border }]}
          >
            <Icon name="plus" size={16} color={colors.primary} />
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Determination — is a limited {system} repair technically supportable?
        </Text>
        <View style={{ gap: 8 }}>
          {DETERMINATION_OPTIONS.map((opt) => {
            const on = flow.determination === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setFlow((f) => ({ ...f, determination: on ? null : opt.value }))}
                style={[
                  styles.detRow,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary + '18' : 'transparent',
                  },
                ]}
              >
                <Icon name={on ? 'check-circle' : 'circle'} size={18} color={on ? colors.primary : colors.mutedForeground} />
                <Text style={{ color: on ? colors.primary : colors.foreground, fontSize: 13, fontWeight: '600', flex: 1 }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Documented basis factors</Text>
        <View style={styles.chipWrap}>
          {basisOptions.map((opt) => {
            const on = flow.basisFactors.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                onPress={() =>
                  setFlow((f) => ({
                    ...f,
                    basisFactors: on
                      ? f.basisFactors.filter((v) => v !== opt.value)
                      : [...f.basisFactors, opt.value],
                  }))
                }
                style={[
                  styles.chip,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary + '22' : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: on ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '600' }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Next step</Text>
        <View style={styles.chipWrap}>
          {nextSteps.map((opt) => {
            const on = flow.nextStep === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setFlow((f) => ({ ...f, nextStep: on ? null : opt.value }))}
                style={[
                  styles.chip,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary + '22' : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: on ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '600' }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Notes (optional)</Text>
        <TextInput
          value={flow.notes}
          onChangeText={(t) => setFlow((f) => ({ ...f, notes: t }))}
          placeholder="Additional documented observations"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[
            styles.input,
            styles.inputMultiline,
            { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
          ]}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Repairability' }} />

        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="tool" size={22} color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
            Structured repairability record. Each answer that supports a conclusion needs linked
            evidence, and the determination is gated by your documented basis factors. Your name
            and credentials are attached from your profile automatically.
          </Text>
        </View>

        <Text style={[styles.qLabel, { color: colors.foreground }]}>Repairability assessed on</Text>
        <View style={styles.chipWrap}>
          {(['roof', 'siding'] as const).map((sys) => {
            const on = systems.includes(sys);
            return (
              <Pressable
                key={sys}
                onPress={() =>
                  setSystems((s) => (on ? s.filter((x) => x !== sys) : [...s, sys]))
                }
                style={[
                  styles.sysToggle,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : colors.card,
                  },
                ]}
              >
                <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: '700' }}>
                  {sys === 'roof' ? 'Roof' : 'Siding'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {systems.length === 2 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            Complete each flow independently — one system's evidence never populates the other's
            determination.
          </Text>
        ) : null}

        {systems.includes('roof') ? renderFlow('roof') : null}
        {systems.includes('siding') ? renderFlow('siding') : null}

        {errors.length > 0 ? (
          <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
            {errors.map((e, i) => (
              <Text key={i} style={{ color: colors.destructive, fontSize: 13 }}>
                • {e}
              </Text>
            ))}
          </View>
        ) : null}

        {systems.length > 0 ? (
          <Pressable
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 15 }}>
                Record assessment
              </Text>
            )}
          </Pressable>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  flowCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 14 },
  flowTitle: { fontSize: 17, fontWeight: '700' },
  qLabel: { fontSize: 14, fontWeight: '600' },
  sectionLabel: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  sysToggle: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  detRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  docRefRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: { borderWidth: 1, borderRadius: 10, padding: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
});
