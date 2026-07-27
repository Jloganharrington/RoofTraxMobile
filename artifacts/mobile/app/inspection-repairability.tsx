import React from 'react';
import {
  ActivityIndicator,
  Image,
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
import {
  ProductMatchPickerModal,
  formatInches,
  storagePhotoUri,
  useStorageAuthHeaders,
} from '@/components/DiscontinuedProductsModal';

// Repairability Assessment v2 — structured question flow (2026-07-26 spec).
// Radio / yes-no-unknown selectors with conditional evidence requirements,
// so the record is defensible: a rep can never jump from "damage exists"
// straight to a replacement conclusion. The app only ever outputs one of
// four determinations; the server re-validates every gate on save.

type Answers = Record<string, string | string[]>;

interface ProductMatch {
  productId: string;
  name: string;
  photoPath?: string | null;
  widthInches?: number | null;
  exposureInches?: number | null;
}

interface FlowState {
  answers: Answers;
  determination: string | null;
  basisFactors: string[];
  nextStep: string | null;
  evidencePhotoIds: string[];
  evidenceDocRefs: string[];
  notes: string;
  // RR-010A: probable product match from the Known Product Catalog.
  productMatch: ProductMatch | null;
}

const emptyFlow = (): FlowState => ({
  answers: {},
  determination: null,
  basisFactors: [],
  nextStep: null,
  evidencePhotoIds: [],
  evidenceDocRefs: [],
  notes: '',
  productMatch: null,
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
  /** User-facing question number when it differs from the internal answer key. */
  displayId?: string;
}

/** Roof (asphalt) questions were renumbered for display; internal keys are stable. */
const ROOF_DISPLAY_ID: Record<string, string> = {
  'RR-002': 'RR-001',
  'RR-003': 'RR-002',
  'RR-003A': 'RR-002A',
  'RR-010': 'RR-005',
  'RR-011': 'RR-005A',
};
const roofDisplayId = (id: string) => ROOF_DISPLAY_ID[id] ?? id;

// TEMPORARY: set to false (or remove) after the question-wording review.
const SHOW_ALL_ROOF_QUESTIONS_FOR_REVIEW = false;

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
  o('safety', 'Safety limitation'),
  o('vegetation', 'Vegetation or site obstruction'),
];

function roofQuestions(facetOptions: Opt[]): QuestionDef[] {
  return [
    // RR-001 (damage documented) was removed from the UI — it is auto-answered
    // from the Facets section. Internal answer keys stay stable for the server
    // and older records; new user-facing numbers are shown via displayId.
    {
      id: 'RR-002',
      displayId: 'RR-001',
      label: 'Which roof facet(s) or area(s) are being assessed?',
      type: 'multi',
      options: [...facetOptions, o('other_area', 'Other documented roof area')],
      visible: (a) => a['RR-001'] === 'yes',
    },
    {
      id: 'RR-003',
      displayId: 'RR-002',
      label: 'Is the affected roofing area accessible for evaluation?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('limited', 'Yes, with limited access'), o('no', 'No')],
    },
    {
      id: 'RR-003A',
      displayId: 'RR-002A',
      label: 'What limits access?',
      type: 'multi',
      options: ACCESS_LIMITS,
      visible: (a) => a['RR-003'] === 'limited' || a['RR-003'] === 'no',
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
      ],
    },
    {
      id: 'RR-010',
      displayId: 'RR-005',
      label: 'Does the existing roof match a known roofing-product profile?',
      type: 'radio',
      options: [
        o('catalog_match', 'Yes — select from Known Product Catalog'),
        o('manufacturer_profile', 'No — NTS/ITEL Needed to Identify'),
      ],
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
    {
      id: 'RR-020',
      label: 'Has a sufficient quantity of the same roofing product been located?',
      type: 'radio',
      options: AVAILABILITY_OPTIONS,
      // Availability search is moot once discontinuation is confirmed by the
      // manufacturer or distributor.
      visible: (a) => a['RR-012'] !== 'manufacturer_confirmed' && a['RR-012'] !== 'distributor_confirmed',
    },
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
    {
      id: 'RR-021',
      label: 'Is there a compatible replacement shingle available?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('unknown_not_verified', 'Unknown / Not Verified')],
    },
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

// ---------------------------------------------------------------------------
// Roof material branching: the roof flow is selected by material. Asphalt
// shingle keeps the original RR-xxx flow unchanged; cedar shake (CS-xxx) and
// standing seam metal (SM-xxx) have their own question sets and vocabularies.
// ---------------------------------------------------------------------------

type RoofMaterial = 'asphalt_shingle' | 'cedar_shake' | 'standing_seam_metal';

const ROOF_MATERIAL_OPTIONS: Opt[] = [
  o('asphalt_shingle', 'Asphalt Shingle'),
  o('cedar_shake', 'Cedar Shake'),
  o('standing_seam_metal', 'Standing Seam Metal'),
];

const AVAILABILITY_STATUS_OPTIONS: Opt[] = [
  o('available', 'Current product available'),
  o('manufacturer_confirmed', 'Discontinued — manufacturer confirmed'),
  o('distributor_confirmed', 'Discontinued — distributor confirmed'),
  o('not_verified', 'Availability not verified'),
  o('unknown', 'Unknown / Not identified'),
];

function cedarQuestions(facetOptions: Opt[]): QuestionDef[] {
  return [
    { id: 'CS-001', label: 'Is direct physical cedar-shake damage documented?', type: 'radio', options: YNU },
    {
      id: 'CS-002',
      label: 'Which roof facet(s) or area(s) are being assessed?',
      type: 'multi',
      options: [...facetOptions, o('other_area', 'Other documented roof area')],
      visible: (a) => a['CS-001'] === 'yes',
    },
    {
      id: 'CS-003',
      label: 'Which documented damage conditions are present?',
      type: 'multi',
      options: [
        o('split_shake', 'Split shake'),
        o('cracked_shake', 'Cracked shake'),
        o('broken_shake', 'Broken shake'),
        o('missing_shake', 'Missing shake'),
        o('displaced_shake', 'Displaced shake'),
        o('fastener_damage', 'Fastener-related damage'),
        o('surface_puncture', 'Surface puncture'),
        o('edge_damage', 'Edge damage'),
        o('other', 'Other documented condition'),
      ],
      visible: (a) => a['CS-001'] === 'yes',
      hint: 'Each selected condition requires linked photo evidence below.',
    },
    {
      id: 'CS-004',
      label: 'Assessment type',
      type: 'radio',
      options: [
        o('visual_screening', 'Visual and documentary screening only'),
        o('non_destructive', 'Controlled non-destructive evaluation'),
        o('controlled_test', 'Controlled shake-removal test'),
        o('post_removal', 'Post-removal concealed-condition evaluation'),
      ],
    },
    {
      id: 'CS-010',
      label: 'Is the existing cedar shake product identified?',
      type: 'radio',
      options: [
        o('exact', 'Exact manufacturer and product identified'),
        o('species_profile', 'Cedar species and shake profile identified'),
        o('material_type_only', 'Cedar shake material type identified only'),
        o('not_identified', 'Not identified'),
      ],
    },
    {
      id: 'CS-011',
      label: 'What cedar shake type is documented?',
      type: 'multi',
      options: [
        o('tapersawn', 'Tapersawn shake'),
        o('handsplit_resawn', 'Hand-split and resawn shake'),
        o('heavy_handsplit_resawn', 'Heavy hand-split and resawn shake'),
        o('straight_split', 'Straight-split shake'),
        o('other_profile', 'Other documented profile'),
        o('unknown', 'Unknown / Not verified'),
      ],
      visible: (a) => !!a['CS-010'] && a['CS-010'] !== 'not_identified',
    },
    {
      id: 'CS-012',
      label: 'What product attributes are documented?',
      type: 'multi',
      options: [
        o('species', 'Wood species'),
        o('grade', 'Grade'),
        o('length', 'Length'),
        o('butt_thickness', 'Butt thickness'),
        o('exposure', 'Exposure'),
        o('treatment_status', 'Treatment status'),
        o('fire_retardant', 'Fire-retardant treatment'),
        o('preservative', 'Preservative treatment'),
        o('fastener_type', 'Fastener type'),
        o('interlayment_type', 'Interlayment type'),
        o('underlayment_type', 'Underlayment type'),
        o('other', 'Other documented attribute'),
      ],
      visible: (a) => !!a['CS-010'] && a['CS-010'] !== 'not_identified',
    },
    {
      id: 'CS-013',
      label: 'What supports the cedar shake identification?',
      type: 'multi',
      options: [
        o('physical_sample', 'Physical shake sample'),
        o('rear_marking', 'Rear marking or tag'),
        o('lab_identification', 'Laboratory identification'),
        o('manufacturer_documentation', 'Manufacturer documentation'),
        o('invoice_permit', 'Prior invoice or permit record'),
        o('field_measurement', 'Contractor field measurement'),
        o('other', 'Other documented source'),
      ],
      visible: (a) => !!a['CS-010'] && a['CS-010'] !== 'not_identified',
      hint: 'Requires linked evidence below.',
    },
    { id: 'CS-020', label: 'Is the existing cedar shake product documented as discontinued or unavailable?', type: 'radio', options: AVAILABILITY_STATUS_OPTIONS },
    { id: 'CS-021', label: 'Has a sufficient quantity of matching cedar shake material been located?', type: 'radio', options: AVAILABILITY_OPTIONS },
    { id: 'CS-022', label: 'Has a proposed replacement cedar shake been identified?', type: 'radio', options: YN_NA },
    {
      id: 'CS-022A',
      label: 'Has the proposed shake been compared to the existing shake?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('pending', 'Comparison pending')],
      visible: (a) => a['CS-022'] === 'yes',
    },
    {
      id: 'CS-022B',
      label: 'Which differences were documented?',
      type: 'multi',
      options: [
        o('species', 'Species'),
        o('grade', 'Grade'),
        o('shake_profile', 'Shake profile'),
        o('length', 'Length'),
        o('butt_thickness', 'Butt thickness'),
        o('exposure', 'Exposure'),
        o('split_texture', 'Split texture'),
        o('surface_appearance', 'Surface appearance'),
        o('color', 'Color'),
        o('treatment_status', 'Treatment status'),
        o('fire_classification', 'Fire classification'),
        o('fastener_requirements', 'Fastener requirements'),
        o('interlayment_compatibility', 'Interlayment compatibility'),
        o('other', 'Other documented difference'),
      ],
      visible: (a) => a['CS-022'] === 'yes' && a['CS-022A'] === 'yes',
      hint: 'Each selected difference requires linked measurement, sample photo, supplier data, or manufacturer document below.',
    },
    { id: 'CS-030', label: 'Would the proposed repair require removal or disturbance of adjacent undamaged shakes?', type: 'radio', options: YNU },
    { id: 'CS-031', label: 'Is the existing cedar shake course or overlap arrangement documented?', type: 'radio', options: YNU },
    {
      id: 'CS-032',
      label: 'Is interlayment, underlayment, or skip-sheathing condition relevant to the proposed repair?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('unknown', 'Unknown / Not verified'), o('not_applicable', 'Not applicable')],
    },
    {
      id: 'CS-032A',
      label: 'What condition is documented?',
      type: 'multi',
      options: [
        o('interlayment_present', 'Interlayment present'),
        o('interlayment_unknown', 'Interlayment condition unknown'),
        o('underlayment_exposed', 'Underlayment exposed'),
        o('underlayment_damaged', 'Underlayment damaged'),
        o('skip_sheathing', 'Skip sheathing present'),
        o('decking_limits_repair', 'Decking condition limits repair'),
        o('assembly_not_visible', 'Existing assembly not fully visible'),
        o('other', 'Other documented condition'),
      ],
      visible: (a) => a['CS-032'] === 'yes',
    },
    {
      id: 'CS-033',
      label: 'Is a manufacturer, CSSB, or product-specific repair method available for the identified shake system?',
      type: 'radio',
      options: [
        o('supports', 'Yes — supports proposed repair method'),
        o('does_not_support', 'Yes — does not support proposed repair method'),
        o('not_reviewed', 'Available but not reviewed'),
        o('not_available', 'Not available'),
        o('product_not_identified', 'Product not sufficiently identified'),
      ],
      hint: 'If "supports" or "does not support" is selected, link the document below.',
    },
    { id: 'CS-040', label: 'Was a controlled cedar-shake removal or repairability test performed?', type: 'radio', options: TEST_PERFORMED_OPTIONS },
    { id: 'CS-041', label: 'Was the test initiated at an already damaged shake?', type: 'radio', options: YN_NA, visible: (a) => a['CS-040'] === 'yes' },
    { id: 'CS-042', label: 'Did adjacent shakes split, crack, break, or become damaged during the test?', type: 'radio', options: YN_NA, visible: (a) => a['CS-040'] === 'yes' },
    { id: 'CS-043', label: 'Could adjacent shakes be reset into a secure, weather-resistant position?', type: 'radio', options: YN_UNK, visible: (a) => a['CS-040'] === 'yes' },
    {
      id: 'CS-044',
      label: 'Did the replacement shake fit the existing course, exposure, and overlap configuration?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('partially', 'Partially'), o('no_replacement_tested', 'No replacement shake tested')],
      visible: (a) => a['CS-040'] === 'yes',
    },
    { id: 'CS-045', label: 'Did the test expose or disturb interlayment, underlayment, or deck components?', type: 'radio', options: YN_UNK, visible: (a) => a['CS-040'] === 'yes' },
    {
      id: 'CS-046',
      label: 'Did the test create an exposed or non-weather-resistant condition?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No')],
      visible: (a) => a['CS-040'] === 'yes',
      hint: 'Test photos or video are required below before the test can support a determination.',
    },
    {
      id: 'CS-046A',
      label: 'Was temporary weather protection installed?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('not_needed', 'Not needed')],
      // Available only when emergency mitigation was required, or the
      // controlled test created an exposed condition.
      visible: (a) => (a['CS-040'] === 'yes' && a['CS-046'] === 'yes') || a['CS-040'] === 'no_emergency',
    },
    {
      id: 'CS-046B',
      label: 'Temporary protection type',
      type: 'multi',
      options: [
        o('tarp', 'Tarp'),
        o('membrane', 'Temporary membrane'),
        o('temporary_shake', 'Temporary shake'),
        o('other', 'Other documented protection'),
      ],
      visible: (a) =>
        ((a['CS-040'] === 'yes' && a['CS-046'] === 'yes') || a['CS-040'] === 'no_emergency') &&
        a['CS-046A'] === 'yes',
    },
  ];
}

function metalQuestions(facetOptions: Opt[]): QuestionDef[] {
  return [
    { id: 'SM-001', label: 'Is direct physical standing-seam metal damage documented?', type: 'radio', options: YNU },
    {
      id: 'SM-002',
      label: 'Which roof facet(s), panel(s), or area(s) are being assessed?',
      type: 'multi',
      options: [...facetOptions, o('other_area', 'Other documented panel or area')],
      visible: (a) => a['SM-001'] === 'yes',
    },
    {
      id: 'SM-003',
      label: 'Which documented damage conditions are present?',
      type: 'multi',
      options: [
        o('panel_puncture', 'Panel puncture'),
        o('panel_tear', 'Panel tear'),
        o('panel_deformation', 'Panel deformation'),
        o('seam_deformation', 'Seam deformation'),
        o('seam_separation', 'Seam separation'),
        o('clip_fastener_condition', 'Clip or fastener-related condition'),
        o('coating_damage', 'Coating damage'),
        o('corrosion', 'Corrosion'),
        o('flashing_damage', 'Flashing damage'),
        o('ridge_condition', 'Ridge condition'),
        o('eave_condition', 'Eave condition'),
        o('penetration_condition', 'Penetration condition'),
        o('other', 'Other documented condition'),
      ],
      visible: (a) => a['SM-001'] === 'yes',
      hint: 'Requires linked photo evidence below.',
    },
    {
      id: 'SM-004',
      label: 'Assessment type',
      type: 'radio',
      options: [
        o('visual_screening', 'Visual and documentary screening only'),
        o('non_destructive', 'Controlled non-destructive evaluation'),
        o('controlled_test', 'Controlled seam-release or panel-removal test'),
        o('post_removal', 'Post-removal concealed-condition evaluation'),
      ],
    },
    {
      id: 'SM-010',
      label: 'Is the standing seam system identified?',
      type: 'radio',
      options: [
        o('exact', 'Exact manufacturer and panel system identified'),
        o('manufacturer_profile', 'Manufacturer and panel profile identified'),
        o('metal_seam_only', 'Metal type and seam profile identified only'),
        o('not_identified', 'Not identified'),
      ],
    },
    {
      id: 'SM-011',
      label: 'What standing seam attributes are documented?',
      type: 'multi',
      options: [
        o('metal_type', 'Metal type'),
        o('panel_width', 'Panel width'),
        o('seam_height', 'Seam height'),
        o('seam_profile', 'Seam profile'),
        o('panel_gauge', 'Panel gauge'),
        o('coating_type', 'Coating type'),
        o('color', 'Color'),
        o('panel_length', 'Panel length'),
        o('clip_system', 'Clip system'),
        o('fastener_system', 'Fastener system'),
        o('underlayment_type', 'Underlayment type'),
        o('deck_type', 'Deck type'),
        o('panel_orientation', 'Panel orientation'),
        o('other', 'Other documented attribute'),
      ],
      visible: (a) => !!a['SM-010'] && a['SM-010'] !== 'not_identified',
    },
    {
      id: 'SM-012',
      label: 'What supports system identification?',
      type: 'multi',
      options: [
        o('panel_stamp', 'Panel stamp or marking'),
        o('physical_sample', 'Physical panel sample'),
        o('manufacturer_documentation', 'Manufacturer documentation'),
        o('installer_invoice', 'Installer invoice'),
        o('permit_record', 'Permit record'),
        o('field_measurement', 'Field measurement'),
        o('lab_identification', 'Laboratory identification'),
        o('other', 'Other documented source'),
      ],
      visible: (a) => !!a['SM-010'] && a['SM-010'] !== 'not_identified',
      hint: 'Requires linked evidence below.',
    },
    { id: 'SM-020', label: 'Is the existing standing seam panel system documented as discontinued or unavailable?', type: 'radio', options: AVAILABILITY_STATUS_OPTIONS },
    { id: 'SM-021', label: 'Has a sufficient quantity of matching replacement panels been located?', type: 'radio', options: AVAILABILITY_OPTIONS },
    { id: 'SM-022', label: 'Has a proposed replacement panel system been identified?', type: 'radio', options: YN_NA },
    {
      id: 'SM-022A',
      label: 'Has the replacement panel been compared to the existing panel system?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('pending', 'Comparison pending')],
      visible: (a) => a['SM-022'] === 'yes',
    },
    {
      id: 'SM-022B',
      label: 'Which differences were documented?',
      type: 'multi',
      options: [
        o('metal_type', 'Metal type'),
        o('panel_width', 'Panel width'),
        o('seam_height', 'Seam height'),
        o('seam_profile', 'Seam profile'),
        o('panel_gauge', 'Panel gauge'),
        o('coating_type', 'Coating type'),
        o('color', 'Color'),
        o('clip_system', 'Clip system'),
        o('fastener_system', 'Fastener system'),
        o('panel_length', 'Panel length'),
        o('underlayment_requirements', 'Underlayment requirements'),
        o('flashing_compatibility', 'Flashing compatibility'),
        o('warranty_requirements', 'Warranty requirements'),
        o('other', 'Other documented difference'),
      ],
      visible: (a) => a['SM-022'] === 'yes' && a['SM-022A'] === 'yes',
      hint: 'Requires linked comparison evidence below.',
    },
    { id: 'SM-030', label: 'Is the damaged panel part of a continuous panel running from ridge to eave?', type: 'radio', options: YNU },
    { id: 'SM-031', label: 'Does the proposed repair require releasing, unseaming, or removing adjacent panels?', type: 'radio', options: YNU },
    { id: 'SM-032', label: 'Is the panel-removal sequence documented for the identified system?', type: 'radio', options: YNU },
    {
      id: 'SM-033',
      label: 'Would the proposed repair disturb clips, fasteners, underlayment, ridge details, eave details, valleys, or flashing?',
      type: 'radio',
      options: YNU,
    },
    {
      id: 'SM-033A',
      label: 'Which components would be disturbed?',
      type: 'multi',
      options: [
        o('adjacent_panels', 'Adjacent panels'),
        o('clips', 'Clips'),
        o('concealed_fasteners', 'Concealed fasteners'),
        o('underlayment', 'Underlayment'),
        o('ridge_assembly', 'Ridge assembly'),
        o('eave_assembly', 'Eave assembly'),
        o('valley_flashing', 'Valley flashing'),
        o('sidewall_flashing', 'Sidewall flashing'),
        o('penetration_flashing', 'Penetration flashing'),
        o('snow_retention', 'Snow-retention system'),
        o('other', 'Other documented component'),
      ],
      visible: (a) => a['SM-033'] === 'yes',
    },
    {
      id: 'SM-034',
      label: 'Is a manufacturer repair or panel-replacement method available for the identified standing seam system?',
      type: 'radio',
      options: [
        o('supports', 'Yes — supports proposed repair method'),
        o('does_not_support', 'Yes — does not support proposed repair method'),
        o('not_reviewed', 'Available but not reviewed'),
        o('not_available', 'Not available'),
        o('product_not_identified', 'System not sufficiently identified'),
      ],
      hint: 'If "supports" or "does not support" is selected, link the document below.',
    },
    { id: 'SM-040', label: 'Was a controlled seam-release or panel-removal test performed?', type: 'radio', options: TEST_PERFORMED_OPTIONS },
    { id: 'SM-041', label: 'Was the test initiated at an already damaged panel or seam location?', type: 'radio', options: YN_NA, visible: (a) => a['SM-040'] === 'yes' },
    { id: 'SM-042', label: 'Could the identified seam be released without deforming adjacent panel seams?', type: 'radio', options: YN_UNK, visible: (a) => a['SM-040'] === 'yes' },
    { id: 'SM-043', label: 'Could adjacent panels be reseamed and restored to a secure, weather-resistant position?', type: 'radio', options: YN_UNK, visible: (a) => a['SM-040'] === 'yes' },
    { id: 'SM-044', label: 'Were clips, fasteners, underlayment, or flashing disturbed during the test?', type: 'radio', options: YN_UNK, visible: (a) => a['SM-040'] === 'yes' },
    {
      id: 'SM-045',
      label: 'Did the proposed replacement panel physically match and integrate with the existing system?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('partially', 'Partially'), o('no_replacement_tested', 'No replacement panel tested')],
      visible: (a) => a['SM-040'] === 'yes',
    },
    {
      id: 'SM-046',
      label: 'Did the test create an exposed or non-weather-resistant condition?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No')],
      visible: (a) => a['SM-040'] === 'yes',
      hint: 'Photo/video evidence is required below for all controlled-test outcomes.',
    },
    {
      id: 'SM-046A',
      label: 'Was temporary weather protection installed?',
      type: 'radio',
      options: [o('yes', 'Yes'), o('no', 'No'), o('not_needed', 'Not needed')],
      // Available only when emergency mitigation was required, or the
      // controlled test created an exposed condition.
      visible: (a) => (a['SM-040'] === 'yes' && a['SM-046'] === 'yes') || a['SM-040'] === 'no_emergency',
    },
    {
      id: 'SM-046B',
      label: 'Temporary protection type',
      type: 'multi',
      options: [
        o('tarp', 'Tarp'),
        o('membrane', 'Temporary membrane'),
        o('temporary_panel', 'Temporary metal panel'),
        o('flashing_protection', 'Temporary flashing protection'),
        o('other', 'Other documented protection'),
      ],
      visible: (a) =>
        ((a['SM-040'] === 'yes' && a['SM-046'] === 'yes') || a['SM-040'] === 'no_emergency') &&
        a['SM-046A'] === 'yes',
    },
  ];
}

const CEDAR_BASIS_OPTIONS: Opt[] = [
  o('matching_cedar_available', 'Matching cedar material available in sufficient quantity'),
  o('matching_cedar_unavailable', 'Matching cedar material unavailable in sufficient quantity'),
  o('proposed_shake_compatible', 'Proposed shake is compatible with existing shake system'),
  o('proposed_shake_not_compatible', 'Proposed shake is not compatible with existing shake system'),
  o('adjacent_shakes_removed_without_damage', 'Adjacent shakes removed without damage'),
  o('adjacent_shakes_damaged_during_test', 'Adjacent shakes split, cracked, or broke during testing'),
  o('shakes_reset_securely', 'Existing shakes reset securely'),
  o('shakes_could_not_reset', 'Existing shakes could not be reset securely'),
  o('replacement_shake_fit', 'Replacement shake fit existing course and overlap geometry'),
  o('replacement_shake_did_not_fit', 'Replacement shake did not fit existing course and overlap geometry'),
  o('repair_disturbs_interlayment_deck', 'Repair disturbs interlayment, underlayment, or deck components'),
  o('guidance_supports_repair', 'Manufacturer or technical guidance supports repair'),
  o('guidance_does_not_support_repair', 'Manufacturer or technical guidance does not support repair'),
  o('evidence_incomplete', 'Supporting evidence remains incomplete'),
];

const METAL_BASIS_OPTIONS: Opt[] = [
  o('matching_panel_available', 'Matching panel system available in sufficient quantity'),
  o('matching_panel_unavailable', 'Matching panel system unavailable in sufficient quantity'),
  o('replacement_panel_compatible', 'Proposed replacement panel is compatible'),
  o('replacement_panel_not_compatible', 'Proposed replacement panel is not compatible'),
  o('seam_released_without_deformation', 'Panel seam released without deformation'),
  o('adjacent_seam_deformed_during_test', 'Adjacent seam or panel deformed during testing'),
  o('panels_reseamed_securely', 'Existing panels could be reseamed securely'),
  o('panels_could_not_reseam', 'Existing panels could not be reseamed securely'),
  o('replacement_panel_integrated', 'Replacement panel integrated with existing system'),
  o('replacement_panel_did_not_integrate', 'Replacement panel did not integrate with existing system'),
  o('repair_disturbs_attachment_or_flashing', 'Repair requires disturbance of clips, fasteners, underlayment, or flashing'),
  o('manufacturer_supports_repair', 'Manufacturer guidance supports repair'),
  o('manufacturer_does_not_support_repair', 'Manufacturer guidance does not support repair'),
  o('evidence_incomplete', 'Supporting evidence remains incomplete'),
];

const CEDAR_NEXT_STEPS: Opt[] = [
  o('prepare_repair_scope', 'Prepare limited cedar shake repair scope'),
  o('obtain_identification', 'Obtain shake sample or laboratory identification'),
  o('obtain_availability', 'Obtain supplier availability documentation'),
  o('obtain_substitute_comparison', 'Obtain substitute-material comparison'),
  o('obtain_guidance', 'Obtain manufacturer or CSSB repair guidance'),
  o('conduct_test', 'Conduct controlled shake-removal test'),
  o('maintain_protection', 'Maintain temporary weather protection'),
  o('document_concealed', 'Document concealed conditions after removal'),
  o('prepare_summary', 'Prepare repairability summary from current record'),
];

const METAL_NEXT_STEPS: Opt[] = [
  o('prepare_repair_scope', 'Prepare limited standing seam repair scope'),
  o('obtain_identification', 'Obtain panel-system identification'),
  o('obtain_availability', 'Obtain supplier availability documentation'),
  o('obtain_substitute_comparison', 'Obtain replacement-panel comparison'),
  o('obtain_guidance', 'Obtain manufacturer repair instructions'),
  o('conduct_test', 'Conduct controlled seam-release test'),
  o('maintain_protection', 'Maintain temporary weather protection'),
  o('document_concealed', 'Document concealed conditions after removal'),
  o('prepare_summary', 'Prepare repairability summary from current record'),
];

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

  const discConfirmed =
    single(`${q}-012`) === 'manufacturer_confirmed' || single(`${q}-012`) === 'distributor_confirmed';
  const disp = (id: string) => (system === 'roof' ? roofDisplayId(id) : id);
  for (const id of ['001', '003', '004', '010', '012', '020', '021', '040']) {
    // RR-020 (availability search) is skipped when discontinuation is confirmed.
    if (id === '020' && system === 'roof' && discConfirmed) continue;
    if (!single(`${q}-${id}`)) errors.push(`${label}: answer ${disp(`${q}-${id}`)} — it is required.`);
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
    if (system === 'siding' && multi(`${q}-011`).length === 0) {
      errors.push(`${label}: select what supports the product identification.`);
    }
    if (!hasEvidence) errors.push(`${label}: product identification requires linked photo or document evidence.`);
  }
  if (system === 'roof' && pid === 'catalog_match' && !flow.productMatch) {
    errors.push(`${label}: select the probable product match from the Known Product Catalog (RR-005A).`);
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

// Client-side mirror of the server's cedar/standing-seam validation gates
// (the server re-checks everything on save).
const MATERIAL_VALIDATION = {
  cedar_shake: {
    prefix: 'CS' as const,
    label: 'Cedar Shake',
    requiredRoot: ['001', '004', '010', '020', '021', '022', '030', '031', '032', '033', '040'],
    identificationSupport: ['011', '013'],
    guidanceQ: '033',
    availableFactor: 'matching_cedar_available',
    unavailableFactor: 'matching_cedar_unavailable',
    compatibleFactor: 'proposed_shake_compatible',
    notCompatibleFactor: 'proposed_shake_not_compatible',
    couldNotResetFactor: 'shakes_could_not_reset',
    directFactors: [
      'adjacent_shakes_removed_without_damage', 'adjacent_shakes_damaged_during_test',
      'shakes_reset_securely', 'shakes_could_not_reset', 'replacement_shake_fit', 'replacement_shake_did_not_fit',
    ],
    productFactors: ['matching_cedar_available', 'matching_cedar_unavailable', 'proposed_shake_compatible', 'proposed_shake_not_compatible'],
    manufacturerFactors: ['guidance_supports_repair', 'guidance_does_not_support_repair'],
    limitationFactors: [
      'matching_cedar_unavailable', 'proposed_shake_not_compatible', 'adjacent_shakes_damaged_during_test',
      'shakes_could_not_reset', 'replacement_shake_did_not_fit', 'repair_disturbs_interlayment_deck',
      'guidance_does_not_support_repair', 'evidence_incomplete',
    ],
  },
  standing_seam_metal: {
    prefix: 'SM' as const,
    label: 'Standing Seam Metal',
    requiredRoot: ['001', '004', '010', '020', '021', '022', '030', '031', '032', '033', '034', '040'],
    identificationSupport: ['011', '012'],
    guidanceQ: '034',
    availableFactor: 'matching_panel_available',
    unavailableFactor: 'matching_panel_unavailable',
    compatibleFactor: 'replacement_panel_compatible',
    notCompatibleFactor: 'replacement_panel_not_compatible',
    couldNotResetFactor: 'panels_could_not_reseam',
    directFactors: [
      'seam_released_without_deformation', 'adjacent_seam_deformed_during_test', 'panels_reseamed_securely',
      'panels_could_not_reseam', 'replacement_panel_integrated', 'replacement_panel_did_not_integrate',
    ],
    productFactors: ['matching_panel_available', 'matching_panel_unavailable', 'replacement_panel_compatible', 'replacement_panel_not_compatible'],
    manufacturerFactors: ['manufacturer_supports_repair', 'manufacturer_does_not_support_repair'],
    limitationFactors: [
      'matching_panel_unavailable', 'replacement_panel_not_compatible', 'adjacent_seam_deformed_during_test',
      'panels_could_not_reseam', 'replacement_panel_did_not_integrate', 'repair_disturbs_attachment_or_flashing',
      'manufacturer_does_not_support_repair', 'evidence_incomplete',
    ],
  },
};

function validateMaterialFlowClient(material: 'cedar_shake' | 'standing_seam_metal', flow: FlowState): string[] {
  const cfg = MATERIAL_VALIDATION[material];
  const q = cfg.prefix;
  const label = cfg.label;
  const a = flow.answers;
  const errors: string[] = [];
  const single = (id: string) => (typeof a[id] === 'string' ? (a[id] as string) : undefined);
  const multi = (id: string) => (Array.isArray(a[id]) ? (a[id] as string[]) : []);
  const hasEvidence = flow.evidencePhotoIds.length > 0 || flow.evidenceDocRefs.length > 0;

  for (const suffix of cfg.requiredRoot) {
    if (!single(`${q}-${suffix}`)) errors.push(`${label}: answer ${q}-${suffix} — it is required.`);
  }
  const damage = single(`${q}-001`);
  if (damage === 'yes' && multi(`${q}-002`).length === 0) {
    errors.push(`${label}: select the affected area(s) being assessed.`);
  }
  if (multi(`${q}-003`).length > 0 && !hasEvidence) {
    errors.push(`${label}: documented damage conditions require linked photo evidence.`);
  }
  if ((damage === 'no' || damage === 'unknown') && flow.determination !== 'indeterminate') {
    errors.push(`${label}: without documented damage, the determination must be "Repairability cannot yet be determined".`);
  }
  const pid = single(`${q}-010`);
  if (pid && pid !== 'not_identified') {
    for (const suffix of cfg.identificationSupport) {
      if (multi(`${q}-${suffix}`).length === 0) {
        errors.push(`${label}: complete ${q}-${suffix} — identification support is required.`);
      }
    }
    if (!hasEvidence) errors.push(`${label}: identification requires linked photo, sample, or document evidence.`);
  }
  const disc = single(`${q}-020`);
  if ((disc === 'manufacturer_confirmed' || disc === 'distributor_confirmed') && !hasEvidence) {
    errors.push(`${label}: confirmed discontinuation requires linked manufacturer/distributor evidence.`);
  }
  const availability = single(`${q}-021`);
  if (availability === 'no_sufficient_quantity' && !hasEvidence) {
    errors.push(`${label}: "no sufficient quantity located" requires documented availability-search evidence.`);
  }
  if (flow.basisFactors.includes(cfg.unavailableFactor) && availability !== 'no_sufficient_quantity') {
    errors.push(`${label}: the unavailable-material factor requires a documented search finding no sufficient quantity.`);
  }
  if (flow.basisFactors.includes(cfg.availableFactor) && availability !== 'sufficient_quantity') {
    errors.push(`${label}: the available-material factor requires a documented sufficient-quantity finding.`);
  }
  if (multi(`${q}-022B`).length > 0 && !hasEvidence) {
    errors.push(`${label}: documented substitute differences require linked comparison evidence.`);
  }
  if (
    (flow.basisFactors.includes(cfg.compatibleFactor) || flow.basisFactors.includes(cfg.notCompatibleFactor)) &&
    single(`${q}-022A`) !== 'yes'
  ) {
    errors.push(`${label}: substitute-compatibility factors require a completed documented comparison.`);
  }
  const testPerformed = single(`${q}-040`) === 'yes';
  const usedDirect = flow.basisFactors.filter((f) => cfg.directFactors.includes(f));
  if (usedDirect.length > 0) {
    if (!testPerformed) errors.push(`${label}: test-derived basis factors require a controlled test (answer Yes to ${q}-040).`);
    else if (!hasEvidence) errors.push(`${label}: a controlled test cannot support the determination unless test photos/video are linked.`);
  }
  if (flow.basisFactors.includes(cfg.couldNotResetFactor)) {
    const guidanceLimit = single(`${q}-${cfg.guidanceQ}`) === 'does_not_support' && hasEvidence;
    if (!(testPerformed && hasEvidence) && !guidanceLimit) {
      errors.push(`${label}: "could not be reset/reseamed" requires a linked test record or documented manufacturer limitation.`);
    }
  }
  if (flow.basisFactors.some((f) => cfg.manufacturerFactors.includes(f))) {
    const g = single(`${q}-${cfg.guidanceQ}`);
    if ((g !== 'supports' && g !== 'does_not_support') || !hasEvidence) {
      errors.push(`${label}: guidance basis factors require a reviewed repair method with a linked document reference.`);
    }
  }
  if (flow.determination && flow.determination !== 'indeterminate' && !hasEvidence) {
    errors.push(`${label}: a conclusive determination requires linked photo or document evidence.`);
  }
  const emergency = single(`${q}-040`) === 'no_emergency';
  const testExposed = testPerformed && single(`${q}-046`) === 'yes';
  if ((single(`${q}-046A`) !== undefined || multi(`${q}-046B`).length > 0) && !emergency && !testExposed) {
    errors.push(`${label}: temporary weather protection only applies to emergency mitigation or an exposed test condition.`);
  }
  if (testExposed && !single(`${q}-046A`)) {
    errors.push(`${label}: an exposed test condition requires the temporary-protection answer.`);
  }
  if (flow.basisFactors.length === 0) errors.push(`${label}: select at least one documented basis factor.`);
  const direct = flow.basisFactors.some((f) => cfg.directFactors.includes(f));
  const product = flow.basisFactors.some((f) => cfg.productFactors.includes(f));
  const manufacturer = flow.basisFactors.some((f) => cfg.manufacturerFactors.includes(f));
  const supporting = flow.basisFactors.some((f) => f !== 'evidence_incomplete');
  const limitation = flow.basisFactors.some((f) => cfg.limitationFactors.includes(f));
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
  const [roofMaterial, setRoofMaterial] = React.useState<RoofMaterial | null>(null);
  const [roofFlow, setRoofFlow] = React.useState<FlowState>(emptyFlow());
  const [sidingFlow, setSidingFlow] = React.useState<FlowState>(emptyFlow());
  const [docRefDraft, setDocRefDraft] = React.useState<{ roof: string; siding: string }>({ roof: '', siding: '' });
  const [productPickerOpen, setProductPickerOpen] = React.useState(false);
  const storageAuthHeaders = useStorageAuthHeaders();
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
          productMatch: ((f as { productMatch?: ProductMatch | null }).productMatch ?? null),
        });
        if (ex.roof) {
          setRoofFlow(toState(ex.roof));
          // Roof flows saved before material branching are asphalt shingle.
          setRoofMaterial(
            ((ex.roof as { roofMaterial?: RoofMaterial | null }).roofMaterial ?? 'asphalt_shingle') as RoofMaterial,
          );
        }
        if (ex.siding) setSidingFlow(toState(ex.siding));
      }
      // Legacy (v1) records are not hydrated into the new flow — the rep
      // re-records using the structured questions; the old record remains
      // until a valid new one is saved.
      setHydrated(true);
    }
  }, [existing, hydrated]);

  // New assessments: pre-select the systems that already have marked damage
  // in the Facets / elevation sections. Editable by the rep.
  const autoSystemsApplied = React.useRef(false);
  React.useEffect(() => {
    if (!inspection || existing || autoSystemsApplied.current) return;
    autoSystemsApplied.current = true;
    const auto: Array<'roof' | 'siding'> = [];
    if ((inspection.slopes ?? []).some((s) => s.damagePresent)) auto.push('roof');
    if ((inspection.sidingFacets ?? []).some((f) => f.damaged)) auto.push('siding');
    if (auto.length > 0) setSystems(auto);
  }, [inspection, existing]);

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
  // The asphalt flow's facet question only offers facets with marked damage.
  const damagedFacetOptions: Opt[] = (inspection.slopes ?? [])
    .filter((s) => s.damagePresent)
    .map((s) => o(`facet:${s.id}`, s.label));

  function buildPayloadFlow(flow: FlowState, material?: RoofMaterial | null) {
    return {
      ...(material ? { roofMaterial: material } : {}),
      ...(flow.productMatch ? { productMatch: flow.productMatch } : {}),
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
    if (systems.includes('roof')) {
      if (!roofMaterial) {
        allErrors.push('Select the roofing material assessed (asphalt shingle, cedar shake, or standing seam metal).');
      } else if (roofMaterial === 'asphalt_shingle') {
        allErrors.push(...validateFlow('roof', roofFlow));
      } else {
        allErrors.push(...validateMaterialFlowClient(roofMaterial, roofFlow));
      }
    }
    if (systems.includes('siding')) allErrors.push(...validateFlow('siding', sidingFlow));
    setErrors(allErrors);
    if (allErrors.length > 0) return;
    setSaving(true);
    try {
      await patchInspection(queryClient, id, {
        repairabilityAssessment: {
          version: 2,
          systems,
          ...(systems.includes('roof') ? { roof: buildPayloadFlow(roofFlow, roofMaterial) } : { roof: null }),
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
    let questions: QuestionDef[];
    let basisOptions: Opt[];
    let nextSteps: Opt[];
    let title: string;
    if (system === 'siding') {
      questions = sidingQuestions();
      basisOptions = SIDING_BASIS_OPTIONS;
      nextSteps = SIDING_NEXT_STEPS;
      title = 'Siding Repairability Assessment';
    } else if (roofMaterial === 'cedar_shake') {
      questions = cedarQuestions(facetOptions);
      basisOptions = CEDAR_BASIS_OPTIONS;
      nextSteps = CEDAR_NEXT_STEPS;
      title = 'Cedar Shake Repairability Assessment';
    } else if (roofMaterial === 'standing_seam_metal') {
      questions = metalQuestions(facetOptions);
      basisOptions = METAL_BASIS_OPTIONS;
      nextSteps = METAL_NEXT_STEPS;
      title = 'Standing Seam Metal Roof Repairability Assessment';
    } else {
      questions = roofQuestions(damagedFacetOptions);
      basisOptions = ROOF_BASIS_OPTIONS;
      nextSteps = ROOF_NEXT_STEPS;
      title = 'Asphalt Shingle Repairability Assessment';
    }

    const setAnswer = (qid: string, v: string | string[] | undefined) =>
      setFlow((f) => {
        const answers = { ...f.answers };
        if (v === undefined || (Array.isArray(v) && v.length === 0)) delete answers[qid];
        else answers[qid] = v;
        // Leaving the catalog-match identification path drops the picked product.
        const productMatch = qid === 'RR-010' && v !== 'catalog_match' ? null : f.productMatch;
        // Confirmed discontinuation hides the availability search (RR-020).
        if (qid === 'RR-012' && (v === 'manufacturer_confirmed' || v === 'distributor_confirmed')) {
          delete answers['RR-020'];
          delete answers['RR-020A'];
        }
        return { ...f, answers, productMatch };
      });

    return (
      <View key={system} style={[styles.flowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.flowTitle, { color: colors.foreground }]}>{title}</Text>

        {questions.map((qd) => {
          // TEMPORARY (review): show all roof questions regardless of their
          // conditional visibility so the full question set can be reviewed.
          // Remove SHOW_ALL_ROOF_QUESTIONS_FOR_REVIEW to restore normal flow.
          const forceVisible = SHOW_ALL_ROOF_QUESTIONS_FOR_REVIEW && system === 'roof';
          if (!forceVisible && qd.visible && !qd.visible(flow.answers)) return null;
          const current = flow.answers[qd.id];
          return (
            <View key={qd.id} style={{ gap: 6 }}>
              <Text style={[styles.qLabel, { color: colors.foreground }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{qd.displayId ?? qd.id}  </Text>
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
              {/* RR-011: probable product match from the Known Product Catalog */}
              {system === 'roof' &&
              roofMaterial === 'asphalt_shingle' &&
              qd.id === 'RR-010' &&
              current === 'catalog_match' ? (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.qLabel, { color: colors.foreground }]}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>RR-005A  </Text>
                    Select Probable Product Match
                  </Text>
                  {flow.productMatch ? (
                    <View style={[styles.productCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      {flow.productMatch.photoPath && storageAuthHeaders ? (
                        <Image
                          source={{ uri: storagePhotoUri(flow.productMatch.photoPath), headers: storageAuthHeaders }}
                          style={styles.productThumb}
                          resizeMode="cover"
                        />
                      ) : null}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.foreground, fontWeight: '700' }} numberOfLines={2}>
                          {flow.productMatch.name}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                          Width {formatInches(flow.productMatch.widthInches)} · Exposure{' '}
                          {formatInches(flow.productMatch.exposureInches)}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => setProductPickerOpen(true)}
                    style={[styles.chip, { borderColor: colors.primary, alignSelf: 'flex-start' }]}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>
                      {flow.productMatch ? 'Change product match' : 'Open Known Product Catalog'}
                    </Text>
                  </Pressable>
                </View>
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

        {systems.includes('roof') ? (
          <View style={{ gap: 10 }}>
            <Text style={[styles.qLabel, { color: colors.foreground }]}>Roofing material assessed</Text>
            <View style={styles.chipWrap}>
              {ROOF_MATERIAL_OPTIONS.map((opt) => {
                const on = roofMaterial === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      if (on) return;
                      setRoofMaterial(opt.value as RoofMaterial);
                      // Each material has its own question flow and factor
                      // vocabulary — switching starts a fresh roof record.
                      const fresh = emptyFlow();
                      // Damage documentation is auto-answered from the facets
                      // section (RR-001 has no UI question anymore); the facet
                      // selection prefills from damaged facets, still editable.
                      if (opt.value === 'asphalt_shingle') {
                        const slopes = inspection.slopes ?? [];
                        const damaged = slopes.filter((s) => s.damagePresent);
                        fresh.answers['RR-001'] = damaged.length > 0 ? 'yes' : 'no';
                        if (damaged.length > 0) {
                          fresh.answers['RR-002'] = damaged.map((s) => `facet:${s.id}`);
                        }
                      }
                      setRoofFlow(fresh);
                    }}
                    style={[
                      styles.sysToggle,
                      {
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primary : colors.card,
                      },
                    ]}
                  >
                    <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: '700' }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {roofMaterial ? renderFlow('roof') : (
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                Select the roofing material to open its question flow.
              </Text>
            )}
          </View>
        ) : null}
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
      <ProductMatchPickerModal
        visible={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        onSelect={(p) => {
          setRoofFlow((f) => ({
            ...f,
            productMatch: {
              productId: p.id,
              name: p.name,
              photoPath: p.photoPath,
              widthInches: p.widthInches,
              exposureInches: p.exposureInches,
            },
          }));
          setProductPickerOpen(false);
        }}
      />
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
  productCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
  productThumb: { width: 64, height: 64, borderRadius: 8 },
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
