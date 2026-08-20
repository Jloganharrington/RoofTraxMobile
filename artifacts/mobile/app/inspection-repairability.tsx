import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { getApiBaseUrl } from '@/lib/api';
import {
  captureEvidencePhoto,
  CameraPermissionDeniedError,
  persistCapturedPhotoForOutbox,
  type CapturedEvidencePhoto,
} from '@/lib/inspectionPhoto';
import { appendOptimisticPhotos, patchInspection } from '@/lib/inspectionSync';
import { drainOutbox } from '@/lib/outbox/drain';
import { enqueueOutboxItem } from '@/lib/outbox/queue';
import type { InspectionPhotoOutboxPayload } from '@/lib/outbox/types';
import { useGetInspection, getGetInspectionQueryKey } from '@workspace/api-client-react';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';
import {
  useListDiscontinuedProducts,
  type DiscontinuedProduct,
} from '@/lib/discontinuedProductsApi';

// ---------------------------------------------------------------------------
// Repairability screen — Repair Attempt Protocol (v3 assessment).
//
// Flow: warranted/authorized gate → systems → roof type (asphalt shingle
// only for now) → Repair Attempt Protocol (RAP): marking instructions, RAP1
// photo, pull procedure, mat-transfer checks on shingles 1–2,
// collateral-damage questions 1–5 over shingles 3–8, and a live scorecard of
// unique newly damaged shingles.
//
// Saving is offline-first: new photos are persisted locally and queued in
// the outbox (client-generated ids for idempotency) BEFORE the assessment
// update is queued, so the FIFO drain lands the photo rows first and the
// server's photo-id verification passes. Reopening the screen rehydrates
// the saved v3 record; saved photos render from the record's photo rows.
// ---------------------------------------------------------------------------

type YesNo = 'yes' | 'no';
type ShingleNum = 3 | 4 | 5 | 6 | 7 | 8;
const SHINGLES_3_8: ShingleNum[] = [3, 4, 5, 6, 7, 8];

interface DamageQuestionDef {
  key: string;
  num: number;
  label: string;
  /** Scorecard line label for this damage category. */
  scoreLabel: string;
}

const DAMAGE_QUESTIONS: DamageQuestionDef[] = [
  {
    key: 'delamination',
    num: 1,
    label: 'Did any shingles sustain delamination?',
    scoreLabel: 'Delamination',
  },
  {
    key: 'creasing',
    num: 2,
    label: 'Did any shingles sustain creasing, cracking or fracturing?',
    scoreLabel: 'Creasing/cracking/fracture',
  },
  {
    key: 'nailZone',
    num: 3,
    label: 'Did any shingles sustain nail pull-through or nail-zone damage?',
    scoreLabel: 'Nail-zone damage',
  },
  {
    key: 'puncture',
    num: 4,
    label: 'Did any shingle sustain puncture, tearing or gouge while seals were being released?',
    scoreLabel: 'Puncture/tear/gouge',
  },
  {
    key: 'reseat',
    num: 5,
    label:
      'Did any manipulated shingle fail to re-seat flat or remain unable to be properly resecured after replacement of X?',
    scoreLabel: 'Reseating/seal-integration concerns',
  },
];

/** A protocol photo slot: a fresh local capture (pending upload) and/or the
 * saved inspection_photos row id from a previous save. A new capture
 * replaces the saved id on save. */
interface PhotoSlot {
  local: CapturedEvidencePhoto | null;
  photoId: string | null;
}

const emptyPhotoSlot = (): PhotoSlot => ({ local: null, photoId: null });

interface DamageAnswer {
  answer: YesNo | null;
  shingles: ShingleNum[];
  photo: PhotoSlot;
  note: string;
}

const emptyDamageAnswer = (): DamageAnswer => ({
  answer: null,
  shingles: [],
  photo: emptyPhotoSlot(),
  note: '',
});

// ── Vinyl Assessment Protocol (VAP) — vinyl siding ──────────────────────────
type VapComponent = '1' | '2' | '3' | '4' | 'T1' | 'T2' | 'T3' | 'T4';
const VAP_COMPONENTS: VapComponent[] = ['1', '2', '3', '4', 'T1', 'T2', 'T3', 'T4'];

interface VapDamageAnswer {
  answer: YesNo | null;
  components: VapComponent[];
  photo: PhotoSlot;
  note: string;
}

const emptyVapDamageAnswer = (): VapDamageAnswer => ({
  answer: null,
  components: [],
  photo: emptyPhotoSlot(),
  note: '',
});

// Question order 1–5 — also the scorecard display order. Example-photo
// priority for the report differs: locking edge first, then crack/split,
// then nail-hem/trim (mirrored in the server's vapScorecard lib).
const VAP_QUESTIONS: Array<{ key: string; num: number; label: string; scoreLabel: string }> = [
  {
    key: 'crackSplit',
    num: 1,
    label: 'Did any manipulated vinyl panel sustain a new crack, split, tear, puncture, or break?',
    scoreLabel: 'Cracked/split/torn/punctured panels',
  },
  {
    key: 'lockingEdge',
    num: 2,
    label: 'Did any manipulated panel sustain new locking-edge, lap-joint, or interlock damage?',
    scoreLabel: 'Locking-edge/lap-joint failures',
  },
  {
    key: 'nailHem',
    num: 3,
    label: 'Did any manipulated panel sustain new nail-hem or fastening-slot damage?',
    scoreLabel: 'Nail-hem/fastening-slot damage',
  },
  {
    key: 'trimInterface',
    num: 4,
    label:
      'Did any J-channel, corner post, utility block, window/door trim, or other siding interface sustain new damage or become unable to be properly resecured?',
    scoreLabel: 'Trim/interface damage',
  },
  {
    key: 'reseat',
    num: 5,
    label:
      'Did any manipulated panel fail to re-seat, align, lock, or retain normal movement after replacement of X?',
    scoreLabel: 'Reseating/alignment/movement concerns',
  },
];

const VAP_MARKING_STEPS = [
  'Identify an already damaged vinyl siding panel to be removed',
  'Mark the damaged panel with an "X"',
  'Mark the panel directly above X as 1',
  'Mark the panel directly below X as 2',
  'Mark any adjacent panel, lap, J-channel, corner post, or trim component that must be manipulated as 3, 4, T1, T2, as applicable',
];

const VAP_PROCEDURE_STEPS = [
  'Use a siding unlock/zip tool to release Panel 1 from Panel X',
  'Locate and gently remove all fasteners securing Panel X',
  'Release Panel X from the lower locking edge and applicable lap or trim interfaces',
  'Remove Panel X',
  "Install a compatible replacement panel in X's original location",
  'Re-engage the lower locking edge and Panel 1',
  'Refasten through the proper nailing hem only. Do not face-nail the replacement panel',
  'Confirm all manipulated panels and trim components are properly seated, aligned, locked, and able to move normally',
];

const MARKING_STEPS = [
  'Mark the selected target shingle with an "X"',
  'Mark the shingles directly below "X" as 1 & 2',
  'Mark the shingles left and right as 3 & 4',
  'Mark the two shingles above "X" as 5 & 6',
  'Mark the shingles above 5 & 6 as 7 & 8 (if needed)',
];

const PULL_STEPS = [
  'Break all seals using a standard flat bar or 5-in-1 painters tool',
  'Locate and gently remove all nails fastening shingle "X"',
  'Pull shingle "X"',
];

const RESET_STEPS = [
  'Replace "X" back to its original location',
  'Without overlifting the shingles, properly re-nail all fasteners removed in new hole locations (straight and flush)',
  'Tap the surface of all manipulated shingles every 6 inches with your hand (Do not use any tool)',
];

// ── RAP target-shingle selection confirmations ───────────────────────────────
interface RapSelection {
  targetShingle: 'damaged' | 'fallback' | null;
  fallbackNote: string;
  fullLength: boolean;
  twoCourses: boolean;
  oneLength: boolean;
  noPenetrations: boolean;
  representative: boolean;
}

const emptyRapSelection = (): RapSelection => ({
  targetShingle: 'damaged',
  fallbackNote: '',
  fullLength: false,
  twoCourses: false,
  oneLength: false,
  noPenetrations: false,
  representative: false,
});

// ── Aluminum Siding Protocol (ASP) ──────────────────────────────────────────
// Non-destructive. Records observed product/condition facts only; no simulated
// removal/reinstall. The protocol is warranted yes + siding + aluminum only.

type AspElevationDir = 'north' | 'south' | 'east' | 'west' | 'other';
const ASP_ELEVATION_DIRS: AspElevationDir[] = ['north', 'south', 'east', 'west', 'other'];

type AspProfile = 'single_8' | 'double_4' | 'double_5' | 'triple_3' | 'vertical' | 'other';
const ASP_PROFILES: AspProfile[] = ['single_8', 'double_4', 'double_5', 'triple_3', 'vertical', 'other'];
const ASP_PROFILE_LABELS: Record<AspProfile, string> = {
  single_8: 'Single 8"',
  double_4: 'Double 4"',
  double_5: 'Double 5"',
  triple_3: 'Triple 3"',
  vertical: 'Vertical',
  other: 'Other',
};

type AspLightingTechnique = 'raking_natural' | 'raking_supplemental' | 'diffuse_only';
const ASP_LIGHTING_TECHNIQUES: AspLightingTechnique[] = [
  'raking_natural',
  'raking_supplemental',
  'diffuse_only',
];
const ASP_LIGHTING_LABELS: Record<AspLightingTechnique, string> = {
  raking_natural: 'Raking — natural light',
  raking_supplemental: 'Raking — supplemental',
  diffuse_only: 'Diffuse only',
};

/** One surveyed elevation row in the ASP. */
interface AspElevationRow {
  id: string; // local-only row id for React key / dup detection
  elevation: AspElevationDir;
  label: string;
  profile: AspProfile | null;
  exposureInches: string; // free text → parsed as float on save
  gauge: string;
  finishColor: string;
  accessible: boolean;
  inaccessibleReason: string;
  wrb: 'present' | 'absent' | 'undetermined' | null;
  widePhoto: PhotoSlot;
  rakingPhoto: PhotoSlot;
}

const emptyAspElevationRow = (): AspElevationRow => ({
  id: Crypto.randomUUID(),
  elevation: 'north',
  label: '',
  profile: null,
  exposureInches: '',
  gauge: '',
  finishColor: '',
  accessible: true,
  inaccessibleReason: '',
  wrb: null,
  widePhoto: emptyPhotoSlot(),
  rakingPhoto: emptyPhotoSlot(),
});

/** One test-square row in the ASP. */
interface AspTestSquareRow {
  id: string; // local key
  elevation: AspElevationDir;
  impactCount: string; // free text → parsed as integer on save
  photo: PhotoSlot;
  note: string;
}

const emptyAspTestSquareRow = (): AspTestSquareRow => ({
  id: Crypto.randomUUID(),
  elevation: 'north',
  impactCount: '',
  photo: emptyPhotoSlot(),
  note: '',
});

/** Assessment conditions for the ASP. */
interface AspConditions {
  airTempF: string;       // free text → number | null
  skyCondition: string;
  lightingTechnique: AspLightingTechnique | null;
}

const emptyAspConditions = (): AspConditions => ({
  airTempF: '',
  skyCondition: '',
  lightingTechnique: null,
});

/** One yes/no condition finding for the ASP (ten categories). */
interface AspFindingState {
  answer: YesNo | null;
  elevations: AspElevationDir[];
  photo: PhotoSlot;
  note: string;
}

const emptyAspFinding = (): AspFindingState => ({
  answer: null,
  elevations: [],
  photo: emptyPhotoSlot(),
  note: '',
});

interface AspConditionQuestionDef {
  key: string;
  label: string;
  description: string;
}

const ASP_CONDITION_QUESTIONS: AspConditionQuestionDef[] = [
  {
    key: 'impactDeformation',
    label: 'Impact Deformation',
    description: 'Are there dents, dings, dimples, or other mechanical deformation consistent with impact?',
  },
  {
    key: 'coatingBreach',
    label: 'Coating Breach',
    description: 'Is the factory finish coating cracked, chipped, or punctured?',
  },
  {
    key: 'substrateExposure',
    label: 'Substrate Exposure',
    description: 'Is bare aluminum substrate exposed through the coating layer?',
  },
  {
    key: 'nailHemCondition',
    label: 'Nail-Hem Condition',
    description: 'Is the nailing hem bent, torn, or deformed?',
  },
  {
    key: 'interlockDisplacement',
    label: 'Interlock Displacement',
    description: 'Is any panel interlock displaced, separated, or unable to seat?',
  },
  {
    key: 'chalking',
    label: 'Chalking / Oxidation',
    description: 'Is there visible oxidation or chalking of the coating surface?',
  },
  {
    key: 'finishVariance',
    label: 'Finish / Color Variance',
    description: 'Is there visible color, gloss, or finish variance between panels or elevations?',
  },
  {
    key: 'priorRepair',
    label: 'Prior Repair Evidence',
    description: 'Is there evidence of a prior panel repair, patch, or replacement?',
  },
  {
    key: 'coatingAdhesion',
    label: 'Coating Adhesion',
    description: 'Is the coating peeling, lifting, or showing adhesion failure?',
  },
  {
    key: 'collateralSoftMetal',
    label: 'Collateral Soft-Metal Damage',
    description: 'Are aluminum trim, soffit, fascia, gutters, or downspouts damaged consistent with the event?',
  },
];

type AspCompatKey =
  | 'profileExposure'
  | 'interlockEngagement'
  | 'gauge'
  | 'finishColorGloss'
  | 'embossedTexture'
  | 'panelLengthLayout'
  | 'fasteningMovement';

type AspCompatValue = 'matched' | 'not_matched' | 'not_assessed';

const ASP_COMPAT_OPTIONS: AspCompatValue[] = ['matched', 'not_matched', 'not_assessed'];
const ASP_COMPAT_LABELS: Record<AspCompatValue, string> = {
  matched: 'Matched',
  not_matched: 'Not matched',
  not_assessed: 'Not assessed',
};

interface AspCompatQuestionDef {
  key: AspCompatKey;
  label: string;
}

const ASP_COMPAT_QUESTIONS: AspCompatQuestionDef[] = [
  { key: 'profileExposure', label: 'Profile / Exposure' },
  { key: 'interlockEngagement', label: 'Interlock Engagement' },
  { key: 'gauge', label: 'Gauge' },
  { key: 'finishColorGloss', label: 'Finish / Color / Gloss' },
  { key: 'embossedTexture', label: 'Embossed Texture' },
  { key: 'panelLengthLayout', label: 'Panel Length / Layout' },
  { key: 'fasteningMovement', label: 'Fastening / Movement' },
];

type AspConclusion =
  | 'repair_supported'
  | 'repair_not_supported_product'
  | 'repair_not_supported_condition'
  | 'undetermined_lab_recommended'
  | 'undetermined_access_limited';

const ASP_CONCLUSION_LABELS: Record<AspConclusion, string> = {
  repair_supported: 'Repair supported by documented evidence',
  repair_not_supported_product: 'Repair not supported — product unavailable / incompatible',
  repair_not_supported_condition: 'Repair not supported — condition findings',
  undetermined_lab_recommended: 'Undetermined — laboratory analysis recommended',
  undetermined_access_limited: 'Undetermined — access limited',
};

const ASP_CONCLUSION_VALUES: AspConclusion[] = [
  'repair_supported',
  'repair_not_supported_product',
  'repair_not_supported_condition',
  'undetermined_lab_recommended',
  'undetermined_access_limited',
];

export default function InspectionRepairabilityScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'repairability');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.repairabilityAssessment ?? null;

  // Gate question: the systems selection only opens when an assessment is
  // warranted and authorized.
  const [warranted, setWarranted] = React.useState<
    'yes' | 'not_warranted_discontinued' | 'not_authorized' | null
  >(null);
  const [systems, setSystems] = React.useState<Array<'roof' | 'siding'>>([]);
  // Type of roof — shown when Roof is selected. More types will be added later.
  const [roofType, setRoofType] = React.useState<'asphalt_shingle' | null>(null);
  // Type of siding — shown when Siding is selected. Vinyl runs the VAP;
  // aluminum routes to the Product ID–supported determination.
  const [sidingType, setSidingType] = React.useState<'vinyl' | 'aluminum' | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  // Repairability Assessment Protocol state — asphalt shingle.
  const [rapSelection, setRapSelection] = React.useState<RapSelection>(emptyRapSelection);
  // Supplies the "Manipulated shingles" scorecard count.
  const [manipulatedCount, setManipulatedCount] = React.useState<6 | 7 | 8 | null>(null);
  const [rap1Photo, setRap1Photo] = React.useState<PhotoSlot>(emptyPhotoSlot());
  const [matTransfer, setMatTransfer] = React.useState<{ 1: YesNo | null; 2: YesNo | null }>({
    1: null,
    2: null,
  });
  const [damage, setDamage] = React.useState<Record<string, DamageAnswer>>(() =>
    Object.fromEntries(DAMAGE_QUESTIONS.map((q) => [q.key, emptyDamageAnswer()])),
  );
  // Vinyl Assessment Protocol state — vinyl siding.
  const [panelsManipulated, setPanelsManipulated] = React.useState<2 | 3 | 4 | 5 | 6 | null>(null);
  const [trimManipulated, setTrimManipulated] = React.useState<0 | 1 | 2 | 3 | 4 | null>(null);
  const [vap1Photo, setVap1Photo] = React.useState<PhotoSlot>(emptyPhotoSlot());
  const [vapFinalPhoto, setVapFinalPhoto] = React.useState<PhotoSlot>(emptyPhotoSlot());
  const [vapDamage, setVapDamage] = React.useState<Record<string, VapDamageAnswer>>(() =>
    Object.fromEntries(VAP_QUESTIONS.map((q) => [q.key, emptyVapDamageAnswer()])),
  );

  // ── Aluminum Siding Protocol (ASP) state ─────────────────────────────────
  const [aspConditions, setAspConditions] = React.useState<AspConditions>(emptyAspConditions);
  const [aspElevations, setAspElevations] = React.useState<AspElevationRow[]>([]);
  const [aspReferencePhoto, setAspReferencePhoto] = React.useState<PhotoSlot>(emptyPhotoSlot());
  const [aspTestSquares, setAspTestSquares] = React.useState<AspTestSquareRow[]>([]);
  const [aspFindings, setAspFindings] = React.useState<Record<string, AspFindingState>>(() =>
    Object.fromEntries(ASP_CONDITION_QUESTIONS.map((q) => [q.key, emptyAspFinding()])),
  );
  const [aspProductRecordId, setAspProductRecordId] = React.useState<string | null>(null);
  const [aspCatalogProductId, setAspCatalogProductId] = React.useState<string | null>(null);
  const [aspVintage, setAspVintage] = React.useState<'yes' | 'no' | 'undetermined' | null>(null);
  const [aspVintageBasis, setAspVintageBasis] = React.useState('');
  const [aspLockBehaviorBasis, setAspLockBehaviorBasis] = React.useState('');
  const [aspCompat, setAspCompat] = React.useState<Partial<Record<AspCompatKey, AspCompatValue>>>({});
  const [aspCompatibilityBasis, setAspCompatibilityBasis] = React.useState('');
  const [aspConclusion, setAspConclusion] = React.useState<AspConclusion | null>(null);
  const [aspConclusionBasis, setAspConclusionBasis] = React.useState('');

  const [capturing, setCapturing] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const queryClient = useQueryClient();

  // Discontinued products for the ASP product picker.
  const discontinuedProductsQuery = useListDiscontinuedProducts();

  // xA follow-ups only offer the shingles that were actually manipulated:
  // 3 through the answered manipulation count (e.g. 7 chosen → no 8).
  const selectableShingles = SHINGLES_3_8.filter((s) => s <= (manipulatedCount ?? 8));

  // If the count is lowered after selections were made, drop now-invalid picks.
  React.useEffect(() => {
    const max = manipulatedCount ?? 8;
    setDamage((d) => {
      let changed = false;
      const next: Record<string, DamageAnswer> = {};
      for (const [k, a] of Object.entries(d)) {
        const kept = a.shingles.filter((s) => s <= max);
        if (kept.length !== a.shingles.length) {
          changed = true;
          next[k] = { ...a, shingles: kept };
        } else {
          next[k] = a;
        }
      }
      return changed ? next : d;
    });
  }, [manipulatedCount]);

  // Existing record: rehydrate every answer so reopening never loses work.
  React.useEffect(() => {
    if (existing && !hydrated) {
      const ex = existing as unknown as {
        version?: number;
        systems?: Array<'roof' | 'siding'>;
        warranted?: 'yes' | 'not_warranted_discontinued' | 'not_authorized';
        roofType?: 'asphalt_shingle' | null;
        sidingType?: 'vinyl' | 'aluminum' | null;
        vap?: {
          panelsManipulated?: 2 | 3 | 4 | 5 | 6 | null;
          trimManipulated?: 0 | 1 | 2 | 3 | 4 | null;
          vap1PhotoId?: string | null;
          finalPhotoId?: string | null;
          damage?: Record<
            string,
            { answer?: YesNo; components?: string[]; photoId?: string | null; note?: string | null }
          >;
        } | null;
        rap?: {
          selection?: {
            mode?: 'damaged_target' | 'fallback_slope' | null;
            note?: string | null;
            criteria?: {
              fullLengthUncut?: boolean;
              twoCoursesAboveEave?: boolean;
              fullShingleLengthFromEdges?: boolean;
              freeOfPenetrations?: boolean;
              representativeExposure?: boolean;
            } | null;
          } | null;
          manipulatedCount?: 6 | 7 | 8 | null;
          rap1PhotoId?: string | null;
          matTransfer?: { shingle1?: YesNo | null; shingle2?: YesNo | null };
          damage?: Record<
            string,
            { answer?: YesNo; shingles?: number[]; photoId?: string | null; note?: string | null }
          >;
        } | null;
        asp?: {
          assessmentConditions?: {
            airTempF?: number | null;
            skyCondition?: string | null;
            lightingTechnique?: string | null;
            capturedAtUtc?: string | null;
          } | null;
          elevations?: Array<{
            elevation?: string;
            label?: string | null;
            profile?: string | null;
            exposureInches?: number | null;
            gauge?: string | null;
            finishColor?: string | null;
            accessible?: boolean;
            inaccessibleReason?: string | null;
            widePhotoId?: string | null;
            rakingPhotoId?: string | null;
            wrb?: 'present' | 'absent' | 'undetermined' | null;
          }>;
          referencePhotoId?: string | null;
          testSquares?: Array<{
            elevation?: string;
            impactCount?: number;
            photoId?: string | null;
            note?: string | null;
          }>;
          findings?: Record<
            string,
            {
              answer?: YesNo;
              elevations?: string[];
              photoId?: string | null;
              note?: string | null;
            }
          >;
          productRecordId?: string | null;
          catalogProductId?: string | null;
          vintage?: { preNineteenNinety?: 'yes' | 'no' | 'undetermined' | null; basis?: string | null } | null;
          lockBehaviorBasis?: string | null;
          compatibility?: Record<string, string>;
          compatibilityBasis?: string | null;
          conclusion?: string | null;
          conclusionBasis?: string | null;
        } | null;
      };
      if (ex.version === 3) {
        setWarranted(ex.warranted ?? null);
        setSystems(ex.systems ?? []);
        setRoofType(ex.roofType ?? null);
        setSidingType(ex.sidingType ?? null);
        const vap = ex.vap;
        if (vap) {
          setPanelsManipulated(vap.panelsManipulated ?? null);
          setTrimManipulated(vap.trimManipulated ?? null);
          setVap1Photo({ local: null, photoId: vap.vap1PhotoId ?? null });
          setVapFinalPhoto({ local: null, photoId: vap.finalPhotoId ?? null });
          setVapDamage(
            Object.fromEntries(
              VAP_QUESTIONS.map((q) => {
                const f = vap.damage?.[q.key];
                return [
                  q.key,
                  f
                    ? {
                        answer: f.answer ?? null,
                        components: (f.components ?? []).filter((c): c is VapComponent =>
                          (VAP_COMPONENTS as string[]).includes(c),
                        ),
                        photo: { local: null, photoId: f.photoId ?? null },
                        note: f.note ?? '',
                      }
                    : emptyVapDamageAnswer(),
                ];
              }),
            ),
          );
        }
        const rap = ex.rap;
        if (rap) {
          if (rap.selection) {
            const s = rap.selection;
            const c = s.criteria ?? {};
            setRapSelection({
              targetShingle: s.mode === 'fallback_slope' ? 'fallback' : 'damaged',
              fallbackNote: s.note ?? '',
              fullLength: c.fullLengthUncut ?? false,
              twoCourses: c.twoCoursesAboveEave ?? false,
              oneLength: c.fullShingleLengthFromEdges ?? false,
              noPenetrations: c.freeOfPenetrations ?? false,
              representative: c.representativeExposure ?? false,
            });
          }
          setManipulatedCount(rap.manipulatedCount ?? null);
          setRap1Photo({ local: null, photoId: rap.rap1PhotoId ?? null });
          setMatTransfer({
            1: rap.matTransfer?.shingle1 ?? null,
            2: rap.matTransfer?.shingle2 ?? null,
          });
          setDamage(
            Object.fromEntries(
              DAMAGE_QUESTIONS.map((q) => {
                const f = rap.damage?.[q.key];
                return [
                  q.key,
                  f
                    ? {
                        answer: f.answer ?? null,
                        shingles: (f.shingles ?? []).filter(
                          (s): s is ShingleNum => s >= 3 && s <= 8,
                        ),
                        photo: { local: null, photoId: f.photoId ?? null },
                        note: f.note ?? '',
                      }
                    : emptyDamageAnswer(),
                ];
              }),
            ),
          );
        }
        // Hydrate ASP state.
        const asp = ex.asp;
        if (asp) {
          const cond = asp.assessmentConditions;
          if (cond) {
            setAspConditions({
              airTempF: cond.airTempF != null ? String(cond.airTempF) : '',
              skyCondition: cond.skyCondition ?? '',
              lightingTechnique: (ASP_LIGHTING_TECHNIQUES as string[]).includes(cond.lightingTechnique ?? '')
                ? (cond.lightingTechnique as AspLightingTechnique)
                : null,
            });
          }
          setAspElevations(
            (asp.elevations ?? []).map((e) => ({
              id: Crypto.randomUUID(),
              elevation: (ASP_ELEVATION_DIRS as string[]).includes(e.elevation ?? '')
                ? (e.elevation as AspElevationDir)
                : 'north',
              label: e.label ?? '',
              profile: (ASP_PROFILES as string[]).includes(e.profile ?? '')
                ? (e.profile as AspProfile)
                : null,
              exposureInches: e.exposureInches != null ? String(e.exposureInches) : '',
              gauge: e.gauge ?? '',
              finishColor: e.finishColor ?? '',
              accessible: e.accessible ?? true,
              inaccessibleReason: e.inaccessibleReason ?? '',
              wrb: e.wrb ?? null,
              widePhoto: { local: null, photoId: e.widePhotoId ?? null },
              rakingPhoto: { local: null, photoId: e.rakingPhotoId ?? null },
            })),
          );
          setAspReferencePhoto({ local: null, photoId: asp.referencePhotoId ?? null });
          setAspTestSquares(
            (asp.testSquares ?? []).map((ts) => ({
              id: Crypto.randomUUID(),
              elevation: (ASP_ELEVATION_DIRS as string[]).includes(ts.elevation ?? '')
                ? (ts.elevation as AspElevationDir)
                : 'north',
              impactCount: ts.impactCount != null ? String(ts.impactCount) : '',
              photo: { local: null, photoId: ts.photoId ?? null },
              note: ts.note ?? '',
            })),
          );
          setAspFindings(
            Object.fromEntries(
              ASP_CONDITION_QUESTIONS.map((q) => {
                const f = asp.findings?.[q.key];
                return [
                  q.key,
                  f
                    ? {
                        answer: f.answer ?? null,
                        elevations: (f.elevations ?? []).filter((e): e is AspElevationDir =>
                          (ASP_ELEVATION_DIRS as string[]).includes(e),
                        ),
                        photo: { local: null, photoId: f.photoId ?? null },
                        note: f.note ?? '',
                      }
                    : emptyAspFinding(),
                ];
              }),
            ),
          );
          setAspProductRecordId(asp.productRecordId ?? null);
          setAspCatalogProductId(asp.catalogProductId ?? null);
          setAspVintage(asp.vintage?.preNineteenNinety ?? null);
          setAspVintageBasis(asp.vintage?.basis ?? '');
          setAspLockBehaviorBasis(asp.lockBehaviorBasis ?? '');
          const compat = asp.compatibility ?? {};
          const hydCompat: Partial<Record<AspCompatKey, AspCompatValue>> = {};
          for (const q of ASP_COMPAT_QUESTIONS) {
            const v = compat[q.key];
            if ((ASP_COMPAT_OPTIONS as string[]).includes(v)) {
              hydCompat[q.key] = v as AspCompatValue;
            }
          }
          setAspCompat(hydCompat);
          setAspCompatibilityBasis(asp.compatibilityBasis ?? '');
          const savedConclusion = asp.conclusion;
          setAspConclusion(
            (ASP_CONCLUSION_VALUES as string[]).includes(savedConclusion ?? '')
              ? (savedConclusion as AspConclusion)
              : null,
          );
          setAspConclusionBasis(asp.conclusionBasis ?? '');
        }
      } else if (ex.version === 2) {
        setSystems(ex.systems ?? []);
      }
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

  // Saved photos render from the record's photo rows (object-storage paths
  // are relative and served through the API's storage proxy).
  const photoUrlById = React.useMemo(() => {
    const map = new Map<string, string>();
    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    for (const p of inspection?.photos ?? []) {
      const url = (p as { url?: string | null }).url;
      if (!url) continue;
      map.set(p.id, url.startsWith('/objects/') ? `${apiBase}/storage${url}` : url);
    }
    return map;
  }, [inspection?.photos]);

  const slotUri = (slot: PhotoSlot): string | null =>
    slot.local?.localUri ?? (slot.photoId ? (photoUrlById.get(slot.photoId) ?? null) : null);

  const takePhoto = async (slot: string, assign: (p: CapturedEvidencePhoto) => void) => {
    if (capturing) return;
    setCapturing(slot);
    try {
      const photo = await captureEvidencePhoto();
      if (photo) assign(photo);
    } catch (err) {
      if (err instanceof CameraPermissionDeniedError) {
        Alert.alert(
          'Camera access needed',
          'Enable camera access for AxiomRestore in your device settings to take protocol photos.',
        );
      } else {
        Alert.alert('Photo failed', 'Could not capture the photo. Please try again.');
      }
    } finally {
      setCapturing(null);
    }
  };

  // ------ Scorecard math ------
  // A shingle counts once no matter how many damage types it recorded.
  const collateralSet = new Set<number>();
  if (matTransfer[1] === 'yes') collateralSet.add(1);
  if (matTransfer[2] === 'yes') collateralSet.add(2);
  for (const q of DAMAGE_QUESTIONS) {
    const a = damage[q.key];
    if (a.answer === 'yes') for (const s of a.shingles) collateralSet.add(s);
  }
  const matTransferCount = (matTransfer[1] === 'yes' ? 1 : 0) + (matTransfer[2] === 'yes' ? 1 : 0);
  const categoryCount = (key: string) =>
    damage[key].answer === 'yes' ? damage[key].shingles.length : 0;

  // VAP scorecard math — count unique newly affected panels or components,
  // not each damage label (a component counts once across all questions).
  const vapCollateralSet = new Set<string>();
  for (const q of VAP_QUESTIONS) {
    const a = vapDamage[q.key];
    if (a.answer === 'yes') for (const c of a.components) vapCollateralSet.add(c);
  }
  const vapCategoryCount = (key: string) =>
    vapDamage[key].answer === 'yes' ? vapDamage[key].components.length : 0;

  const chipStyle = (on: boolean) => [
    styles.sysToggle,
    {
      borderColor: on ? colors.primary : colors.border,
      backgroundColor: on ? colors.primary : colors.card,
    },
  ];
  const chipText = (on: boolean) => ({
    color: on ? colors.primaryForeground : colors.foreground,
    fontWeight: '700' as const,
  });

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

  const renderInstructionCard = (title: string, steps: string[]) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
      {steps.map((step, i) => (
        <View key={i} style={styles.stepRow}>
          <Icon name="chevron-right" size={16} color={colors.primary} />
          <Text style={{ color: colors.foreground, flex: 1, fontSize: 14, lineHeight: 20 }}>
            {step}
          </Text>
        </View>
      ))}
    </View>
  );

  const renderPhotoButton = (
    slot: string,
    photo: PhotoSlot,
    assign: (p: CapturedEvidencePhoto) => void,
    label: string,
  ) => {
    const uri = slotUri(photo);
    return (
      <View style={styles.photoRow}>
        {uri ? <Image source={{ uri }} style={styles.photoThumb} /> : null}
        <Pressable
          onPress={() => takePhoto(slot, assign)}
          style={[styles.photoBtn, { borderColor: colors.primary, backgroundColor: colors.card }]}
        >
          {capturing === slot ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Icon name="camera" size={18} color={colors.primary} />
          )}
          <Text style={{ color: colors.primary, fontWeight: '700' }}>
            {uri ? 'Retake' : label}
          </Text>
        </Pressable>
      </View>
    );
  };

  const showRap = warranted === 'yes' && systems.includes('roof') && roofType === 'asphalt_shingle';
  const showVap = warranted === 'yes' && systems.includes('siding') && sidingType === 'vinyl';

  // All six selection items must be confirmed before the Marking section unlocks.
  const selectionComplete =
    showRap &&
    (rapSelection.targetShingle === 'damaged' ||
      (rapSelection.targetShingle === 'fallback' &&
        rapSelection.fallbackNote.trim().length > 0)) &&
    rapSelection.fullLength &&
    rapSelection.twoCourses &&
    rapSelection.oneLength &&
    rapSelection.noPenetrations &&
    rapSelection.representative;
  const showAluminumRoute =
    warranted === 'yes' && systems.includes('siding') && sidingType === 'aluminum';

  // Save gating: the gate question is always required; a warranted
  // assessment needs at least one system, and a roof/siding selection needs
  // its type. Partial protocol answers are savable by design (never lose
  // field work).
  const canSave =
    warranted != null &&
    (warranted !== 'yes' ||
      (systems.length > 0 &&
        (!systems.includes('roof') || roofType != null) &&
        (!systems.includes('siding') || sidingType != null)));

  // Persist + queue one locally captured protocol photo, mirroring the
  // preliminary-photos path: durable local copy, client-generated id, outbox
  // enqueue, optimistic cache row. RAP photos are generic inspection photos
  // (no stage/roles) — the assessment references them by id.
  const queueProtocolPhoto = async (shot: CapturedEvidencePhoto): Promise<string> => {
    const persisted = await persistCapturedPhotoForOutbox(shot);
    const photoId = Crypto.randomUUID();
    const payload: InspectionPhotoOutboxPayload = {
      id: photoId,
      inspectionId: id,
      subjectType: 'inspection',
      subjectId: null,
      stage: null,
      triadRole: null,
      preliminaryRole: null,
      localFilePath: persisted.localFilePath,
      mimeType: shot.mimeType,
      sha256: persisted.sha256,
      exifJson: persisted.exifJson,
      overlayJson: persisted.overlayJson,
      capturedAtUtc: persisted.capturedAtUtc,
      latitude: persisted.latitude,
      longitude: persisted.longitude,
    };
    await enqueueOutboxItem('inspection.photo', payload);
    appendOptimisticPhotos(queryClient, id, [
      {
        id: photoId,
        subjectType: 'inspection',
        subjectId: null,
        stage: null,
        triadRole: null,
        preliminaryRole: null,
        sha256: persisted.sha256,
      },
    ]);
    return photoId;
  };

  const handleSave = async () => {
    if (!canSave || saving || !warranted) return;
    setSaving(true);
    try {
      const rapIncluded = showRap;
      const vapIncluded = showVap;
      const aspIncluded = showAluminumRoute;

      // Local validation for ASP: inaccessible reason, duplicate elevation,
      // non-integer impact counts, conclusion requires basis.
      if (aspIncluded) {
        const seenElevations = new Set<string>();
        for (const elev of aspElevations) {
          if (!elev.accessible && !elev.inaccessibleReason.trim()) {
            Alert.alert(
              'Inaccessible reason required',
              `Elevation "${elev.elevation}" is marked inaccessible — add a reason before saving.`,
            );
            setSaving(false);
            return;
          }
          const key = `${elev.elevation}:${elev.label.trim()}`;
          if (seenElevations.has(key)) {
            Alert.alert(
              'Duplicate elevation',
              `Elevation "${elev.elevation}"${elev.label.trim() ? ` (${elev.label.trim()})` : ''} appears more than once. Use the label field to distinguish sides.`,
            );
            setSaving(false);
            return;
          }
          seenElevations.add(key);
        }
        for (const ts of aspTestSquares) {
          const raw = ts.impactCount.trim();
          if (raw !== '' && (!/^\d+$/.test(raw) || !Number.isInteger(Number(raw)))) {
            Alert.alert(
              'Invalid impact count',
              'Impact counts must be whole numbers. Correct the test-square entries before saving.',
            );
            setSaving(false);
            return;
          }
        }
        if (aspConclusion != null && !aspConclusionBasis.trim()) {
          Alert.alert(
            'Conclusion basis required',
            'Add a conclusion basis before saving when a conclusion is selected.',
          );
          setSaving(false);
          return;
        }
      }

      // 1) Queue any NEW local captures first — the outbox drains FIFO, so
      //    the photo rows exist before the assessment update replays and the
      //    server verifies the referenced ids.
      let rap1PhotoId = rap1Photo.photoId;
      const damagePhotoIds: Record<string, string | null> = {};
      if (rapIncluded) {
        if (rap1Photo.local) {
          rap1PhotoId = await queueProtocolPhoto(rap1Photo.local);
          setRap1Photo({ local: null, photoId: rap1PhotoId });
        }
        for (const q of DAMAGE_QUESTIONS) {
          const a = damage[q.key];
          if (a.answer === 'yes' && a.photo.local) {
            const pid = await queueProtocolPhoto(a.photo.local);
            damagePhotoIds[q.key] = pid;
            setDamage((d) => ({
              ...d,
              [q.key]: { ...d[q.key], photo: { local: null, photoId: pid } },
            }));
          } else {
            damagePhotoIds[q.key] = a.photo.photoId;
          }
        }
      }
      let vap1PhotoId = vap1Photo.photoId;
      let vapFinalPhotoId = vapFinalPhoto.photoId;
      const vapDamagePhotoIds: Record<string, string | null> = {};
      if (vapIncluded) {
        if (vap1Photo.local) {
          vap1PhotoId = await queueProtocolPhoto(vap1Photo.local);
          setVap1Photo({ local: null, photoId: vap1PhotoId });
        }
        if (vapFinalPhoto.local) {
          vapFinalPhotoId = await queueProtocolPhoto(vapFinalPhoto.local);
          setVapFinalPhoto({ local: null, photoId: vapFinalPhotoId });
        }
        for (const q of VAP_QUESTIONS) {
          const a = vapDamage[q.key];
          if (a.answer === 'yes' && a.photo.local) {
            const pid = await queueProtocolPhoto(a.photo.local);
            vapDamagePhotoIds[q.key] = pid;
            setVapDamage((d) => ({
              ...d,
              [q.key]: { ...d[q.key], photo: { local: null, photoId: pid } },
            }));
          } else {
            vapDamagePhotoIds[q.key] = a.photo.photoId;
          }
        }
      }

      // Queue ASP photos before the assessment save.
      let aspRefPhotoId = aspReferencePhoto.photoId;
      const aspElevationWideIds: string[] = [];
      const aspElevationRakingIds: string[] = [];
      const aspTestSquarePhotoIds: string[] = [];
      const aspFindingPhotoIds: Record<string, string | null> = {};
      if (aspIncluded) {
        if (aspReferencePhoto.local) {
          aspRefPhotoId = await queueProtocolPhoto(aspReferencePhoto.local);
          setAspReferencePhoto({ local: null, photoId: aspRefPhotoId });
        }
        for (let i = 0; i < aspElevations.length; i++) {
          const elev = aspElevations[i];
          let wid = elev.widePhoto.photoId;
          let rid = elev.rakingPhoto.photoId;
          if (elev.widePhoto.local) {
            wid = await queueProtocolPhoto(elev.widePhoto.local);
          }
          if (elev.rakingPhoto.local) {
            rid = await queueProtocolPhoto(elev.rakingPhoto.local);
          }
          aspElevationWideIds.push(wid ?? '');
          aspElevationRakingIds.push(rid ?? '');
          if (elev.widePhoto.local || elev.rakingPhoto.local) {
            const newWide = elev.widePhoto.local ? { local: null, photoId: wid } : elev.widePhoto;
            const newRaking = elev.rakingPhoto.local ? { local: null, photoId: rid } : elev.rakingPhoto;
            setAspElevations((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, widePhoto: newWide, rakingPhoto: newRaking } : r,
              ),
            );
          }
        }
        // Map test-square photos before filtering blank rows.
        for (let i = 0; i < aspTestSquares.length; i++) {
          const ts = aspTestSquares[i];
          let pid = ts.photo.photoId;
          if (ts.photo.local) {
            pid = await queueProtocolPhoto(ts.photo.local);
            setAspTestSquares((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, photo: { local: null, photoId: pid } } : r,
              ),
            );
          }
          aspTestSquarePhotoIds.push(pid ?? '');
        }
        for (const q of ASP_CONDITION_QUESTIONS) {
          const f = aspFindings[q.key];
          if (f.answer === 'yes' && f.photo.local) {
            const pid = await queueProtocolPhoto(f.photo.local);
            aspFindingPhotoIds[q.key] = pid;
            setAspFindings((prev) => ({
              ...prev,
              [q.key]: { ...prev[q.key], photo: { local: null, photoId: pid } },
            }));
          } else {
            aspFindingPhotoIds[q.key] = f.photo.photoId;
          }
        }
      }

      // 2) Queue the assessment itself (v3 shape). Assessor identity is
      //    stamped server-side from the inspector's profile.
      const assessment =
        warranted === 'yes'
          ? {
              version: 3 as const,
              warranted,
              systems,
              roofType: systems.includes('roof') ? roofType : null,
              sidingType: systems.includes('siding') ? sidingType : null,
              vap: vapIncluded
                ? {
                    panelsManipulated,
                    trimManipulated,
                    vap1PhotoId,
                    finalPhotoId: vapFinalPhotoId,
                    damage: Object.fromEntries(
                      VAP_QUESTIONS.filter((q) => vapDamage[q.key].answer != null).map((q) => {
                        const a = vapDamage[q.key];
                        const isYes = a.answer === 'yes';
                        return [
                          q.key,
                          {
                            answer: a.answer,
                            components: isYes ? a.components : [],
                            photoId: isYes ? vapDamagePhotoIds[q.key] : null,
                            note: isYes && a.note.trim() ? a.note.trim() : null,
                          },
                        ];
                      }),
                    ),
                  }
                : null,
              rap: rapIncluded
                ? {
                    selection: rapSelection.targetShingle != null
                      ? {
                          mode: rapSelection.targetShingle === 'fallback'
                            ? ('fallback_slope' as const)
                            : ('damaged_target' as const),
                          ...(rapSelection.targetShingle === 'fallback' &&
                          rapSelection.fallbackNote.trim()
                            ? { note: rapSelection.fallbackNote.trim() }
                            : {}),
                          criteria: {
                            fullLengthUncut: rapSelection.fullLength,
                            twoCoursesAboveEave: rapSelection.twoCourses,
                            fullShingleLengthFromEdges: rapSelection.oneLength,
                            freeOfPenetrations: rapSelection.noPenetrations,
                            representativeExposure: rapSelection.representative,
                          },
                        }
                      : null,
                    manipulatedCount,
                    rap1PhotoId,
                    matTransfer: { shingle1: matTransfer[1], shingle2: matTransfer[2] },
                    damage: Object.fromEntries(
                      DAMAGE_QUESTIONS.filter((q) => damage[q.key].answer != null).map((q) => {
                        const a = damage[q.key];
                        const isYes = a.answer === 'yes';
                        return [
                          q.key,
                          {
                            answer: a.answer,
                            shingles: isYes ? a.shingles : [],
                            photoId: isYes ? damagePhotoIds[q.key] : null,
                            note: isYes && a.note.trim() ? a.note.trim() : null,
                          },
                        ];
                      }),
                    ),
                  }
                : null,
              asp: aspIncluded
                ? (() => {
                    const cond = aspConditions;
                    const airTempRaw = cond.airTempF.trim();
                    const airTempNum = airTempRaw !== '' && !isNaN(Number(airTempRaw)) ? Number(airTempRaw) : null;
                    return {
                      assessmentConditions: {
                        airTempF: airTempNum,
                        skyCondition: cond.skyCondition.trim() || null,
                        lightingTechnique: cond.lightingTechnique ?? null,
                        capturedAtUtc: new Date().toISOString(),
                      },
                      elevations: aspElevations.map((elev, i) => ({
                        elevation: elev.elevation,
                        label: elev.label.trim() || null,
                        profile: elev.profile ?? null,
                        exposureInches: elev.exposureInches.trim() !== '' && !isNaN(Number(elev.exposureInches))
                          ? Number(elev.exposureInches)
                          : null,
                        gauge: elev.gauge.trim() || null,
                        finishColor: elev.finishColor.trim() || null,
                        accessible: elev.accessible,
                        inaccessibleReason: !elev.accessible && elev.inaccessibleReason.trim()
                          ? elev.inaccessibleReason.trim()
                          : null,
                        wrb: elev.wrb ?? null,
                        widePhotoId: aspElevationWideIds[i] || null,
                        rakingPhotoId: aspElevationRakingIds[i] || null,
                      })),
                      referencePhotoId: aspRefPhotoId ?? null,
                      // Map photos then filter blank rows (elevation and impactCount blank = skip).
                      testSquares: aspTestSquares
                        .map((ts, i) => ({
                          elevation: ts.elevation,
                          impactCount: ts.impactCount.trim() !== '' ? Number(ts.impactCount.trim()) : null,
                          photoId: aspTestSquarePhotoIds[i] || null,
                          note: ts.note.trim() || null,
                        }))
                        .filter((ts) => ts.impactCount !== null),
                      findings: Object.fromEntries(
                        ASP_CONDITION_QUESTIONS.filter((q) => aspFindings[q.key].answer != null).map((q) => {
                          const f = aspFindings[q.key];
                          const isYes = f.answer === 'yes';
                          return [
                            q.key,
                            {
                              answer: f.answer,
                              elevations: isYes ? f.elevations : [],
                              photoId: isYes ? aspFindingPhotoIds[q.key] ?? null : null,
                              note: isYes && f.note.trim() ? f.note.trim() : null,
                            },
                          ];
                        }),
                      ),
                      productRecordId: aspProductRecordId ?? null,
                      catalogProductId: aspCatalogProductId ?? null,
                      vintage: {
                        preNineteenNinety: aspVintage ?? null,
                        basis: aspVintageBasis.trim() || null,
                      },
                      lockBehaviorBasis: aspLockBehaviorBasis.trim() || null,
                      compatibility: Object.fromEntries(
                        ASP_COMPAT_QUESTIONS.filter((q) => aspCompat[q.key] != null).map((q) => [q.key, aspCompat[q.key]]),
                      ),
                      compatibilityBasis: aspCompatibilityBasis.trim() || null,
                      conclusion: aspConclusion ?? null,
                      conclusionBasis: aspConclusionBasis.trim() || null,
                    };
                  })()
                : null,
              recordedAtUtc: new Date().toISOString(),
            }
          : {
              version: 3 as const,
              warranted,
              systems: [],
              roofType: null,
              sidingType: null,
              rap: null,
              vap: null,
              asp: null,
              recordedAtUtc: new Date().toISOString(),
            };

      await patchInspection(queryClient, id, {
        repairabilityAssessment: assessment,
      } as Parameters<typeof patchInspection>[2]);
      drainOutbox();
      router.back();
    } catch {
      Alert.alert('Could not save', 'Something went wrong saving the assessment. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Repairability' }} />

      <Text style={[styles.qLabel, { color: colors.foreground }]}>
        Is a Repairability Assessment warranted and authorized at this time?
      </Text>
      <View style={styles.chipWrap}>
        {(
          [
            { value: 'yes', label: 'Yes' },
            { value: 'not_warranted_discontinued', label: 'Not Warranted - Discontinued' },
            { value: 'not_authorized', label: 'Not Authorized' },
          ] as const
        ).map((opt) => {
          const on = warranted === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setWarranted(on ? null : opt.value)}
              style={chipStyle(on)}
            >
              <Text style={chipText(on)}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {warranted === 'yes' ? (
        <>
          <Text style={[styles.qLabel, { color: colors.foreground }]}>Repairability assessed on</Text>
          <View style={styles.chipWrap}>
            {(['roof', 'siding'] as const).map((sys) => {
              const on = systems.includes(sys);
              return (
                <Pressable
                  key={sys}
                  onPress={() => setSystems((s) => (on ? s.filter((x) => x !== sys) : [...s, sys]))}
                  style={chipStyle(on)}
                >
                  <Text style={chipText(on)}>{sys === 'roof' ? 'Roof' : 'Siding'}</Text>
                </Pressable>
              );
            })}
          </View>

          {systems.includes('roof') ? (
            <>
              <Text style={[styles.qLabel, { color: colors.foreground }]}>Type of Roof</Text>
              <View style={styles.chipWrap}>
                {([{ value: 'asphalt_shingle', label: 'Asphalt Shingle' }] as const).map((opt) => {
                  const on = roofType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setRoofType(on ? null : opt.value)}
                      style={chipStyle(on)}
                    >
                      <Text style={chipText(on)}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {systems.includes('siding') ? (
            <>
              <Text style={[styles.qLabel, { color: colors.foreground }]}>Type of Siding</Text>
              <View style={styles.chipWrap}>
                {(
                  [
                    { value: 'vinyl', label: 'Vinyl Siding' },
                    { value: 'aluminum', label: 'Aluminum Siding' },
                  ] as const
                ).map((opt) => {
                  const on = sidingType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setSidingType(on ? null : opt.value)}
                      style={chipStyle(on)}
                    >
                      <Text style={chipText(on)}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {showAluminumRoute ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Aluminum Siding Forensic Inspection Protocol (ASP)
          </Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>
              Non-destructive. Records observed product and condition facts only — no simulated panel
              removal, fastener manipulation, interlock testing, or coating breach.
            </Text>
          </View>

          {/* ── Assessment Conditions ───────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Assessment Conditions</Text>
            <Text style={[styles.qLabel, { color: colors.foreground }]}>Air Temperature (°F)</Text>
            <TextInput
              value={aspConditions.airTempF}
              onChangeText={(t) => setAspConditions((c) => ({ ...c, airTempF: t }))}
              placeholder="e.g. 72"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[
                styles.noteInput,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 40 },
              ]}
            />
            <Text style={[styles.qLabel, { color: colors.foreground }]}>Sky Condition</Text>
            <TextInput
              value={aspConditions.skyCondition}
              onChangeText={(t) => setAspConditions((c) => ({ ...c, skyCondition: t }))}
              placeholder="e.g. Clear, partly cloudy…"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.noteInput,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 40 },
              ]}
            />
            <Text style={[styles.qLabel, { color: colors.foreground }]}>Lighting Technique</Text>
            <View style={styles.chipWrap}>
              {ASP_LIGHTING_TECHNIQUES.map((lt) => {
                const on = aspConditions.lightingTechnique === lt;
                return (
                  <Pressable
                    key={lt}
                    onPress={() => setAspConditions((c) => ({ ...c, lightingTechnique: on ? null : lt }))}
                    style={chipStyle(on)}
                  >
                    <Text style={chipText(on)}>{ASP_LIGHTING_LABELS[lt]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── Elevation Survey ─────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Elevation Survey</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Add one row per surveyed face. Mark inaccessible faces with a reason.
            </Text>
            {aspElevations.map((elev, idx) => {
              const setElev = (patch: Partial<AspElevationRow>) =>
                setAspElevations((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
              return (
                <View
                  key={elev.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      marginTop: 6,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 13 }}>
                      Elevation {idx + 1}
                    </Text>
                    <Pressable
                      onPress={() => setAspElevations((prev) => prev.filter((_, i) => i !== idx))}
                      hitSlop={8}
                    >
                      <Icon name="x" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Direction</Text>
                  <View style={styles.chipWrap}>
                    {ASP_ELEVATION_DIRS.map((d) => {
                      const on = elev.elevation === d;
                      return (
                        <Pressable key={d} onPress={() => setElev({ elevation: d })} style={chipStyle(on)}>
                          <Text style={chipText(on)}>{d.charAt(0).toUpperCase() + d.slice(1)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
                    Label (optional, e.g. "East — garage wall")
                  </Text>
                  <TextInput
                    value={elev.label}
                    onChangeText={(t) => setElev({ label: t })}
                    placeholder="Optional label…"
                    placeholderTextColor={colors.mutedForeground}
                    style={[
                      styles.noteInput,
                      { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
                    ]}
                  />
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>Profile</Text>
                  <View style={styles.chipWrap}>
                    {ASP_PROFILES.map((p) => {
                      const on = elev.profile === p;
                      return (
                        <Pressable key={p} onPress={() => setElev({ profile: on ? null : p })} style={chipStyle(on)}>
                          <Text style={chipText(on)}>{ASP_PROFILE_LABELS[p]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Exposure (inches)</Text>
                      <TextInput
                        value={elev.exposureInches}
                        onChangeText={(t) => setElev({ exposureInches: t })}
                        placeholder="e.g. 4"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="numeric"
                        style={[
                          styles.noteInput,
                          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
                        ]}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Gauge</Text>
                      <TextInput
                        value={elev.gauge}
                        onChangeText={(t) => setElev({ gauge: t })}
                        placeholder='e.g. .024"'
                        placeholderTextColor={colors.mutedForeground}
                        style={[
                          styles.noteInput,
                          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>Finish / Color</Text>
                  <TextInput
                    value={elev.finishColor}
                    onChangeText={(t) => setElev({ finishColor: t })}
                    placeholder="e.g. White, almond…"
                    placeholderTextColor={colors.mutedForeground}
                    style={[
                      styles.noteInput,
                      { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
                    ]}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <Pressable
                      onPress={() => setElev({ accessible: !elev.accessible })}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    >
                      <View
                        style={[
                          styles.selectionCheckbox,
                          {
                            borderColor: elev.accessible ? colors.primary : colors.border,
                            backgroundColor: elev.accessible ? colors.primary : 'transparent',
                          },
                        ]}
                      >
                        {elev.accessible ? (
                          <Icon name="check" size={13} color={colors.primaryForeground} />
                        ) : null}
                      </View>
                      <Text style={{ color: colors.foreground, fontSize: 13 }}>Accessible</Text>
                    </Pressable>
                  </View>
                  {!elev.accessible ? (
                    <TextInput
                      value={elev.inaccessibleReason}
                      onChangeText={(t) => setElev({ inaccessibleReason: t })}
                      placeholder="Reason inaccessible (required)…"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      style={[
                        styles.noteInput,
                        { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
                      ]}
                    />
                  ) : null}
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
                    WRB behind cladding (Rule 45)
                  </Text>
                  <View style={styles.chipWrap}>
                    {(['present', 'absent', 'undetermined'] as const).map((wrb) => {
                      const on = elev.wrb === wrb;
                      return (
                        <Pressable key={wrb} onPress={() => setElev({ wrb: on ? null : wrb })} style={chipStyle(on)}>
                          <Text style={chipText(on)}>{wrb.charAt(0).toUpperCase() + wrb.slice(1)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Wide photo</Text>
                      {renderPhotoButton(
                        `asp-elev-wide-${elev.id}`,
                        elev.widePhoto,
                        (p) => setElev({ widePhoto: { ...elev.widePhoto, local: p } }),
                        'Take Wide',
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Raking / grazing photo</Text>
                      {renderPhotoButton(
                        `asp-elev-raking-${elev.id}`,
                        elev.rakingPhoto,
                        (p) => setElev({ rakingPhoto: { ...elev.rakingPhoto, local: p } }),
                        'Take Raking',
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
            <Pressable
              onPress={() => setAspElevations((prev) => [...prev, emptyAspElevationRow()])}
              style={[styles.photoBtn, { borderColor: colors.primary, backgroundColor: colors.card, marginTop: 8 }]}
            >
              <Icon name="plus" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Add Elevation</Text>
            </Pressable>
          </View>

          {/* ── Reference Photo ──────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Reference Photo</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Representative overall view of the aluminum siding in best available lighting.
            </Text>
            {renderPhotoButton(
              'asp-reference',
              aspReferencePhoto,
              (p) => setAspReferencePhoto((prev) => ({ ...prev, local: p })),
              'Take Reference Photo',
            )}
          </View>

          {/* ── Test Squares ─────────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Test Squares</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Add one row per counted test area. Blank rows are dropped on save.
            </Text>
            {aspTestSquares.map((ts, idx) => {
              const setTs = (patch: Partial<AspTestSquareRow>) =>
                setAspTestSquares((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
              return (
                <View
                  key={ts.id}
                  style={[
                    styles.card,
                    { backgroundColor: colors.background, borderColor: colors.border, marginTop: 6 },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 13 }}>
                      Test Square {idx + 1}
                    </Text>
                    <Pressable
                      onPress={() => setAspTestSquares((prev) => prev.filter((_, i) => i !== idx))}
                      hitSlop={8}
                    >
                      <Icon name="x" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Elevation</Text>
                  <View style={styles.chipWrap}>
                    {ASP_ELEVATION_DIRS.map((d) => {
                      const on = ts.elevation === d;
                      return (
                        <Pressable key={d} onPress={() => setTs({ elevation: d })} style={chipStyle(on)}>
                          <Text style={chipText(on)}>{d.charAt(0).toUpperCase() + d.slice(1)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Impact Count</Text>
                      <TextInput
                        value={ts.impactCount}
                        onChangeText={(t) => setTs({ impactCount: t })}
                        placeholder="0"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="number-pad"
                        style={[
                          styles.noteInput,
                          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
                        ]}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Note</Text>
                      <TextInput
                        value={ts.note}
                        onChangeText={(t) => setTs({ note: t })}
                        placeholder="Optional…"
                        placeholderTextColor={colors.mutedForeground}
                        style={[
                          styles.noteInput,
                          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
                        ]}
                      />
                    </View>
                  </View>
                  {renderPhotoButton(
                    `asp-ts-${ts.id}`,
                    ts.photo,
                    (p) => setTs({ photo: { ...ts.photo, local: p } }),
                    'Take Photo',
                  )}
                </View>
              );
            })}
            <Pressable
              onPress={() => setAspTestSquares((prev) => [...prev, emptyAspTestSquareRow()])}
              style={[styles.photoBtn, { borderColor: colors.primary, backgroundColor: colors.card, marginTop: 8 }]}
            >
              <Icon name="plus" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Add Test Square</Text>
            </Pressable>
          </View>

          {/* ── Condition Findings (10 questions) ───────────────────────── */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Condition Findings</Text>
          {ASP_CONDITION_QUESTIONS.map((q, qIdx) => {
            const f = aspFindings[q.key];
            const setF = (patch: Partial<AspFindingState>) =>
              setAspFindings((prev) => ({ ...prev, [q.key]: { ...prev[q.key], ...patch } }));
            return (
              <View key={q.key} style={{ gap: 8 }}>
                <Text style={[styles.qLabel, { color: colors.foreground }]}>
                  {qIdx + 1}. {q.label}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{q.description}</Text>
                <View style={styles.chipWrap}>
                  {(['yes', 'no'] as const).map((v) => {
                    const on = f.answer === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setF({ answer: on ? null : v })}
                        style={chipStyle(on)}
                      >
                        <Text style={chipText(on)}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {f.answer === 'yes' ? (
                  <View
                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                      Affected Elevations
                    </Text>
                    <View style={styles.chipWrap}>
                      {ASP_ELEVATION_DIRS.map((d) => {
                        const on = f.elevations.includes(d);
                        return (
                          <Pressable
                            key={d}
                            onPress={() =>
                              setF({
                                elevations: on
                                  ? f.elevations.filter((x) => x !== d)
                                  : [...f.elevations, d],
                              })
                            }
                            style={chipStyle(on)}
                          >
                            <Text style={chipText(on)}>
                              {d.charAt(0).toUpperCase() + d.slice(1)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      Photograph one representative example.
                    </Text>
                    {renderPhotoButton(
                      `asp-finding-${q.key}`,
                      f.photo,
                      (p) => setF({ photo: { ...f.photo, local: p } }),
                      'Take Example Photo',
                    )}
                    <TextInput
                      value={f.note}
                      onChangeText={(t) => setF({ note: t })}
                      placeholder="Observation note (panel location, what you see)…"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      style={[
                        styles.noteInput,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}

          {/* ── Product Picker ───────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Product Records</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Link the inspection-specific determination and, when applicable, the company catalog record.
            </Text>
            <Text style={[styles.qLabel, { color: colors.foreground, marginTop: 8 }]}>Inspection product determination</Text>
            <View style={styles.chipWrap}>
              {(inspection?.products ?? []).map((prod) => {
                const on = aspProductRecordId === prod.id;
                const label = [prod.brand, prod.productLine].filter(Boolean).join(' — ') || 'Unlabeled inspection product';
                return (
                  <Pressable key={prod.id} onPress={() => setAspProductRecordId(on ? null : prod.id)} style={chipStyle(on)}>
                    <Text style={chipText(on)}>{label}</Text>
                  </Pressable>
                );
              })}
              {(inspection?.products ?? []).length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No product determinations are recorded on this inspection yet.</Text>
              ) : null}
            </View>
            <Text style={[styles.qLabel, { color: colors.foreground, marginTop: 8 }]}>Known Product Catalog match</Text>
            {discontinuedProductsQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <View style={styles.chipWrap}>
                {(discontinuedProductsQuery.data?.products ?? []).map((prod: DiscontinuedProduct) => {
                  const on = aspCatalogProductId === prod.id;
                  return (
                    <Pressable
                      key={prod.id}
                      onPress={() => setAspCatalogProductId(on ? null : prod.id)}
                      style={chipStyle(on)}
                    >
                      <Text style={chipText(on)}>{prod.name}</Text>
                    </Pressable>
                  );
                })}
                {(discontinuedProductsQuery.data?.products ?? []).length === 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    No products in catalog. Add products via Profile → Known Product Catalog.
                  </Text>
                ) : null}
              </View>
            )}
          </View>

          {/* ── Compatibility Criteria ───────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Compatibility Criteria
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Rate each replacement-panel compatibility dimension.
            </Text>
            {ASP_COMPAT_QUESTIONS.map((q) => {
              const val = aspCompat[q.key];
              return (
                <View key={q.key} style={{ gap: 4, marginTop: 6 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
                    {q.label}
                  </Text>
                  <View style={styles.chipWrap}>
                    {ASP_COMPAT_OPTIONS.map((opt) => {
                      const on = val === opt;
                      return (
                        <Pressable
                          key={opt}
                          onPress={() =>
                            setAspCompat((prev) => ({ ...prev, [q.key]: on ? undefined : opt }))
                          }
                          style={chipStyle(on)}
                        >
                          <Text style={chipText(on)}>{ASP_COMPAT_LABELS[opt]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
            <Text style={[styles.qLabel, { color: colors.foreground, marginTop: 8 }]}>
              Compatibility Basis
            </Text>
            <TextInput
              value={aspCompatibilityBasis}
              onChangeText={setAspCompatibilityBasis}
              placeholder="Describe the basis for your compatibility ratings…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.noteInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>

          {/* ── Conclusion ───────────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Conclusion</Text>
            <View style={styles.chipWrap}>
              {ASP_CONCLUSION_VALUES.map((c) => {
                const on = aspConclusion === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setAspConclusion(on ? null : c)}
                    style={chipStyle(on)}
                  >
                    <Text style={chipText(on)}>{ASP_CONCLUSION_LABELS[c]}</Text>
                  </Pressable>
                );
              })}
            </View>
            {aspConclusion === 'repair_not_supported_product' ? (
              <>
                <Text style={[styles.qLabel, { color: colors.foreground, marginTop: 8 }]}>Pre-1990 vintage documented?</Text>
                <View style={styles.chipWrap}>
                  {(['yes', 'no', 'undetermined'] as const).map((value) => {
                    const on = aspVintage === value;
                    return (
                      <Pressable key={value} onPress={() => setAspVintage(on ? null : value)} style={chipStyle(on)}>
                        <Text style={chipText(on)}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={aspVintageBasis}
                  onChangeText={setAspVintageBasis}
                  placeholder="Vintage basis (required when pre-1990 is Yes)…"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[styles.noteInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
                <TextInput
                  value={aspLockBehaviorBasis}
                  onChangeText={setAspLockBehaviorBasis}
                  placeholder="Lock-condition basis (required unless interlock displacement is Yes)…"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[styles.noteInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </>
            ) : null}
            <Text style={[styles.qLabel, { color: colors.foreground, marginTop: 8 }]}>
              Conclusion Basis {aspConclusion != null ? '(required)' : '(optional)'}
            </Text>
            <TextInput
              value={aspConclusionBasis}
              onChangeText={setAspConclusionBasis}
              placeholder="Summarize the documented findings that support this conclusion…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.noteInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>
        </>
      ) : null}

      {showRap ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Repairability Assessment Protocol
          </Text>

          {/* ── Instructions — Selection ───────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Instructions — Selection
            </Text>

            {/* 1. Target shingle (radio) */}
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '700', marginTop: 2 }}>
              1. Target shingle
            </Text>
            {(
              [
                {
                  value: 'damaged' as const,
                  label:
                    'Target shingle has documented damage attributed to the reported event',
                },
                {
                  value: 'fallback' as const,
                  label:
                    'No damaged shingle usable — assessment performed on a slope with identified damage',
                },
              ]
            ).map((opt) => {
              const on = rapSelection.targetShingle === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setRapSelection((s) => ({ ...s, targetShingle: opt.value }))}
                  style={[
                    styles.selectionRadio,
                    {
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary + '18' : 'transparent',
                    },
                  ]}
                  hitSlop={4}
                >
                  <View
                    style={[styles.radioCircle, { borderColor: on ? colors.primary : colors.border }]}
                  >
                    {on ? (
                      <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />
                    ) : null}
                  </View>
                  <Text style={{ color: colors.foreground, flex: 1, fontSize: 13, lineHeight: 18 }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
            {rapSelection.targetShingle === 'fallback' ? (
              <TextInput
                value={rapSelection.fallbackNote}
                onChangeText={(t) => setRapSelection((s) => ({ ...s, fallbackNote: t }))}
                placeholder="Describe the slope and the identified damage basis…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[
                  styles.noteInput,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />
            ) : null}

            {/* 2–6: confirmation checkboxes */}
            {(
              [
                {
                  key: 'fullLength' as const,
                  label: 'Target shingle is full length and uncut',
                },
                {
                  key: 'twoCourses' as const,
                  label: 'Target shingle is at least 2 courses up from any eave',
                },
                {
                  key: 'oneLength' as const,
                  label:
                    'Target shingle is at least one full shingle length from any rake, valley, or hip',
                },
                {
                  key: 'noPenetrations' as const,
                  label: 'Repairability assessment area is free of any roof penetrations',
                },
                {
                  key: 'representative' as const,
                  label:
                    'Assessment area is representative of the overall roof exposure (not sheltered by trees or adjacent structures)',
                },
              ]
            ).map((item, idx) => {
              const checked = rapSelection[item.key];
              return (
                <Pressable
                  key={item.key}
                  onPress={() =>
                    setRapSelection((s) => ({ ...s, [item.key]: !s[item.key] }))
                  }
                  style={styles.selectionCheck}
                  hitSlop={4}
                >
                  <View
                    style={[
                      styles.selectionCheckbox,
                      {
                        borderColor: checked ? colors.primary : colors.border,
                        backgroundColor: checked ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    {checked ? (
                      <Icon name="check" size={13} color={colors.primaryForeground} />
                    ) : null}
                  </View>
                  <Text
                    style={{ color: colors.foreground, flex: 1, fontSize: 13, lineHeight: 18 }}
                  >
                    {idx + 2}. {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Everything from Marking onward is locked until Selection is complete. */}
          {selectionComplete ? (
            <>
              {renderInstructionCard('Instructions — Marking', MARKING_STEPS)}

              <Text style={[styles.qLabel, { color: colors.foreground }]}>
                How many shingles require manipulation to complete the protocol?
              </Text>
              <View style={styles.chipWrap}>
                {([6, 7, 8] as const).map((n) => {
                  const on = manipulatedCount === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setManipulatedCount(on ? null : n)}
                      style={chipStyle(on)}
                    >
                      <Text style={chipText(on)}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Take Photograph (RAP1)
                </Text>
                {renderPhotoButton(
                  'rap1',
                  rap1Photo,
                  (p) => setRap1Photo((prev) => ({ ...prev, local: p })),
                  'Take RAP1 Photo',
                )}
              </View>

              {renderInstructionCard('Instructions — Pull', PULL_STEPS)}

              {([1, 2] as const).map((n) => (
                <View key={n}>
                  <Text style={[styles.qLabel, { color: colors.foreground }]}>
                    Did Shingle {n} sustain Mat Transfer during the removal process?
                  </Text>
                  <View style={[styles.chipWrap, { marginTop: 8 }]}>
                    {(['yes', 'no'] as const).map((v) => {
                      const on = matTransfer[n] === v;
                      return (
                        <Pressable
                          key={v}
                          onPress={() => setMatTransfer((m) => ({ ...m, [n]: on ? null : v }))}
                          style={chipStyle(on)}
                        >
                          <Text style={chipText(on)}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}

              {renderInstructionCard('Instructions — Replace & Re-secure', RESET_STEPS)}

              {DAMAGE_QUESTIONS.map((q) => {
                const a = damage[q.key];
                const setA = (patch: Partial<DamageAnswer>) =>
                  setDamage((d) => ({ ...d, [q.key]: { ...d[q.key], ...patch } }));
                return (
                  <View key={q.key} style={{ gap: 8 }}>
                    <Text style={[styles.qLabel, { color: colors.foreground }]}>
                      {q.num}: {q.label}
                    </Text>
                    <View style={styles.chipWrap}>
                      {(['yes', 'no'] as const).map((v) => {
                        const on = a.answer === v;
                        return (
                          <Pressable
                            key={v}
                            onPress={() => setA({ answer: on ? null : v })}
                            style={chipStyle(on)}
                          >
                            <Text style={chipText(on)}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {a.answer === 'yes' ? (
                      <View
                        style={[
                          styles.card,
                          { backgroundColor: colors.card, borderColor: colors.border },
                        ]}
                      >
                        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                          {q.num}A: Select all affected shingles
                        </Text>
                        <View style={styles.chipWrap}>
                          {selectableShingles.map((s) => {
                            const on = a.shingles.includes(s);
                            return (
                              <Pressable
                                key={s}
                                onPress={() =>
                                  setA({
                                    shingles: on
                                      ? a.shingles.filter((x) => x !== s)
                                      : [...a.shingles, s].sort((x, y) => x - y),
                                  })
                                }
                                style={chipStyle(on)}
                              >
                                <Text style={chipText(on)}>{s}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                          Photograph one example with a note.
                        </Text>
                        {renderPhotoButton(
                          q.key,
                          a.photo,
                          (p) => setA({ photo: { ...a.photo, local: p } }),
                          'Take Example Photo',
                        )}
                        <TextInput
                          value={a.note}
                          onChangeText={(t) => setA({ note: t })}
                          placeholder="Photo note (which shingle, what you see)…"
                          placeholderTextColor={colors.mutedForeground}
                          multiline
                          style={[
                            styles.noteInput,
                            {
                              color: colors.foreground,
                              borderColor: colors.border,
                              backgroundColor: colors.background,
                            },
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}

              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Scorecard</Text>
                {(
                  [
                    ['Manipulated shingles', manipulatedCount ?? 0],
                    ['New collateral-damaged shingles', collateralSet.size],
                    ['Mat-transfer findings on 1–2', matTransferCount],
                    ['Delamination', categoryCount('delamination')],
                    ['Creasing/cracking/fracture', categoryCount('creasing')],
                    ['Nail-zone damage', categoryCount('nailZone')],
                    ['Puncture/tear/gouge', categoryCount('puncture')],
                    ['Reseating/seal-integration concerns', categoryCount('reseat')],
                  ] as Array<[string, number]>
                ).map(([label, count]) => (
                  <View key={label} style={styles.scoreRow}>
                    <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>
                      {label}
                    </Text>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>
                      {count}
                    </Text>
                  </View>
                ))}
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
                  This scorecard, the RAP1 photo, and up to 2 newly-damaged-shingle photos go to
                  the report — priority to 1 delamination and 1 creased/cracked/fractured example.
                </Text>
              </View>
            </>
          ) : (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.stepRow, { alignItems: 'center' }]}>
                <Icon name="alert-circle" size={15} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  Complete all selection confirmations above to unlock the protocol steps.
                </Text>
              </View>
            </View>
          )}
        </>
      ) : null}

      {showVap ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Vinyl Siding Repairability Assessment
          </Text>

          {renderInstructionCard('Instructions — Marking', VAP_MARKING_STEPS)}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Take Photograph (VAP1)
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Clear photograph of the complete marked repair zone — VAP1: Marked Vinyl Repair Zone /
              Pre-Manipulation Baseline.
            </Text>
            {renderPhotoButton(
              'vap1',
              vap1Photo,
              (p) => setVap1Photo((prev) => ({ ...prev, local: p })),
              'Take VAP1 Photo',
            )}
          </View>

          {renderInstructionCard('Simulated Repair Procedure', VAP_PROCEDURE_STEPS)}

          <Text style={[styles.qLabel, { color: colors.foreground }]}>
            How many panels (beyond X) were manipulated to complete the protocol?
          </Text>
          <View style={styles.chipWrap}>
            {([2, 3, 4, 5, 6] as const).map((n) => {
              const on = panelsManipulated === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setPanelsManipulated(on ? null : n)}
                  style={chipStyle(on)}
                >
                  <Text style={chipText(on)}>{n}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.qLabel, { color: colors.foreground }]}>
            How many trim/interface components were manipulated?
          </Text>
          <View style={styles.chipWrap}>
            {([0, 1, 2, 3, 4] as const).map((n) => {
              const on = trimManipulated === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setTrimManipulated(on ? null : n)}
                  style={chipStyle(on)}
                >
                  <Text style={chipText(on)}>{n}</Text>
                </Pressable>
              );
            })}
          </View>

          {VAP_QUESTIONS.map((q) => {
            const a = vapDamage[q.key];
            const setA = (patch: Partial<VapDamageAnswer>) =>
              setVapDamage((d) => ({ ...d, [q.key]: { ...d[q.key], ...patch } }));
            return (
              <View key={q.key} style={{ gap: 8 }}>
                <Text style={[styles.qLabel, { color: colors.foreground }]}>
                  {q.num}: {q.label}
                </Text>
                <View style={styles.chipWrap}>
                  {(['yes', 'no'] as const).map((v) => {
                    const on = a.answer === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setA({ answer: on ? null : v })}
                        style={chipStyle(on)}
                      >
                        <Text style={chipText(on)}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {a.answer === 'yes' ? (
                  <View
                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                      {q.num}A: Select all affected panels/components
                    </Text>
                    <View style={styles.chipWrap}>
                      {VAP_COMPONENTS.map((c) => {
                        const on = a.components.includes(c);
                        return (
                          <Pressable
                            key={c}
                            onPress={() =>
                              setA({
                                components: on
                                  ? a.components.filter((x) => x !== c)
                                  : VAP_COMPONENTS.filter(
                                      (x) => a.components.includes(x) || x === c,
                                    ),
                              })
                            }
                            style={chipStyle(on)}
                          >
                            <Text style={chipText(on)}>{c}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      Photograph one example with a factual note.
                    </Text>
                    {renderPhotoButton(
                      `vap-${q.key}`,
                      a.photo,
                      (p) => setA({ photo: { ...a.photo, local: p } }),
                      'Take Example Photo',
                    )}
                    <TextInput
                      value={a.note}
                      onChangeText={(t) => setA({ note: t })}
                      placeholder="Photo note (which panel/component, what you see)…"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      style={[
                        styles.noteInput,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Required Final Archive Photo
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Final marked photo of the repaired zone — annotate X and all panels/components with
              newly documented collateral damage. Kept in the full inspection archive.
            </Text>
            {renderPhotoButton(
              'vapFinal',
              vapFinalPhoto,
              (p) => setVapFinalPhoto((prev) => ({ ...prev, local: p })),
              'Take Final Archive Photo',
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Vinyl Repairability Scorecard</Text>
            {(
              [
                ['Target panels removed', 1],
                ['Panels manipulated', panelsManipulated ?? 0],
                ['Trim/interface components manipulated', trimManipulated ?? 0],
                // Unique newly affected panels or components, not each damage label.
                ['New collateral-damaged panels', vapCollateralSet.size],
                ['Cracked/split/torn/punctured panels', vapCategoryCount('crackSplit')],
                ['Locking-edge/lap-joint failures', vapCategoryCount('lockingEdge')],
                ['Nail-hem/fastening-slot damage', vapCategoryCount('nailHem')],
                ['Trim/interface damage', vapCategoryCount('trimInterface')],
                ['Reseating/alignment/movement concerns', vapCategoryCount('reseat')],
              ] as Array<[string, number]>
            ).map(([label, count]) => (
              <View key={label} style={styles.scoreRow}>
                <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>{label}</Text>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>
                  {count}
                </Text>
              </View>
            ))}
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
              This scorecard, the VAP1 photo, and up to 2 newly-damaged photos go to the report —
              priority to a locking-edge/lap-joint failure, then a cracked/split panel, then a
              trim-interface or nail-hem failure.
            </Text>
          </View>
        </>
      ) : null}

      <Pressable
        onPress={handleSave}
        disabled={!canSave || saving}
        style={[
          styles.saveBtn,
          {
            backgroundColor: canSave && !saving ? colors.primary : colors.border,
          },
        ]}
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Icon
            name="check"
            size={18}
            color={canSave ? colors.primaryForeground : colors.mutedForeground}
          />
        )}
        <Text
          style={{
            color: canSave && !saving ? colors.primaryForeground : colors.mutedForeground,
            fontWeight: '800',
            fontSize: 15,
          }}
        >
          Save Repairability Assessment
        </Text>
      </Pressable>
      {!canSave ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'center' }}>
          {warranted == null
            ? 'Answer whether an assessment is warranted and authorized to save.'
            : systems.length === 0
              ? 'Select at least one system to save.'
              : systems.includes('roof') && roofType == null
                ? 'Select the type of roof to save.'
                : 'Select the type of siding to save.'}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  qLabel: { fontSize: 14, fontWeight: '600' },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sysToggle: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoThumb: { width: 56, height: 56, borderRadius: 8 },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  selectionRadio: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  selectionCheck: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  selectionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
  },
});
