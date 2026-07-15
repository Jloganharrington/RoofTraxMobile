import type { PreliminaryPhotoRole } from '@workspace/api-client-react';

// Phase 1 light damage-type vocabulary (P2). Stored as free text on the
// inspection row (inspections.damageType) so the choice set can evolve without
// a schema migration; these are just the values the mobile flow offers.
export const DAMAGE_TYPE_OPTIONS = [
  { value: 'hail', label: 'Hail' },
  { value: 'wind', label: 'Wind' },
  { value: 'wind_and_hail', label: 'Wind & Hail' },
  { value: 'other', label: 'Other' },
] as const;

export const DAMAGE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DAMAGE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

// The 4 single-shot Phase 1 evidence slots (P2). `damage_closeup` is captured
// twice, so the slot list carries a stable key per shot for the capture UI.
export interface PreliminaryPhotoSlot {
  key: string;
  role: PreliminaryPhotoRole;
  title: string;
  hint: string;
}

export const PRELIMINARY_PHOTO_SLOTS: PreliminaryPhotoSlot[] = [
  {
    key: 'front_of_home',
    role: 'front_of_home',
    title: 'Front of home',
    hint: 'Frame the full front elevation of the house.',
  },
  {
    key: 'roof_overview',
    role: 'roof_overview',
    title: 'Roof overview',
    hint: 'Capture the overall roof from the ground.',
  },
  {
    key: 'damage_closeup_1',
    role: 'damage_closeup',
    title: 'Damage close-up 1',
    hint: 'Get close to the clearest area of damage.',
  },
  {
    key: 'damage_closeup_2',
    role: 'damage_closeup',
    title: 'Damage close-up 2',
    hint: 'A second close-up of the damage from another angle.',
  },
];
