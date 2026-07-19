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

// Phase 1 damage SURFACES — orthogonal to the damage type above (that's the
// peril; this is the surface). Written straight onto the inspection row's
// three existing booleans because they drive which measurement report gets
// ordered and how the forensic is scoped, both of which happen between
// Phase 1 and Phase 2.
export type DamageSurface = 'roof' | 'siding' | 'collateral' | 'interior';

export const DAMAGE_SURFACE_OPTIONS: Array<{ value: DamageSurface; label: string }> = [
  { value: 'roof', label: 'Roof' },
  { value: 'siding', label: 'Siding' },
  { value: 'collateral', label: 'Collateral' },
  { value: 'interior', label: 'Interior' },
];

export const SURFACE_CLOSEUP_ROLE: Record<DamageSurface, PreliminaryPhotoRole> = {
  roof: 'damage_closeup_roof',
  siding: 'damage_closeup_siding',
  collateral: 'damage_closeup_collateral',
  interior: 'damage_closeup_interior',
};

export function selectedSurfaces(inspection: {
  roofDamageFound?: boolean;
  sidingDamageFound?: boolean;
  collateralDamageFound?: boolean;
  interiorDamageFound?: boolean;
}): DamageSurface[] {
  const out: DamageSurface[] = [];
  if (inspection.roofDamageFound) out.push('roof');
  if (inspection.sidingDamageFound) out.push('siding');
  if (inspection.collateralDamageFound) out.push('collateral');
  if (inspection.interiorDamageFound) out.push('interior');
  return out;
}

// A photo satisfies a surface's close-up requirement if it carries that
// surface's tagged role — or, for ROOF only, the legacy generic
// `damage_closeup` role (pre-tagging records were roof-oriented, so old
// records stay green).
export function closeupRolesFor(surface: DamageSurface): PreliminaryPhotoRole[] {
  return surface === 'roof'
    ? ['damage_closeup_roof', 'damage_closeup']
    : [SURFACE_CLOSEUP_ROLE[surface]];
}

// The single-shot Phase 1 evidence slots (P2). Front + roof overview are
// always required; damage close-ups are surface-tagged — one slot per
// selected surface (two when a single surface is selected, matching the
// original two-close-up flow).
export interface PreliminaryPhotoSlot {
  key: string;
  role: PreliminaryPhotoRole;
  title: string;
  hint: string;
}

const SURFACE_LABEL: Record<DamageSurface, string> = {
  roof: 'roof',
  siding: 'siding',
  collateral: 'collateral',
  interior: 'interior',
};

export function preliminaryPhotoSlots(surfaces: DamageSurface[]): PreliminaryPhotoSlot[] {
  const slots: PreliminaryPhotoSlot[] = [
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
  ];
  if (surfaces.length === 1) {
    const s = surfaces[0];
    slots.push(
      {
        key: `damage_closeup_${s}_1`,
        role: SURFACE_CLOSEUP_ROLE[s],
        title: `${capitalize(SURFACE_LABEL[s])} damage close-up 1`,
        hint: `Get close to the clearest area of ${SURFACE_LABEL[s]} damage.`,
      },
      {
        key: `damage_closeup_${s}_2`,
        role: SURFACE_CLOSEUP_ROLE[s],
        title: `${capitalize(SURFACE_LABEL[s])} damage close-up 2`,
        hint: `A second ${SURFACE_LABEL[s]} close-up from another angle.`,
      },
    );
  } else {
    for (const s of surfaces) {
      slots.push({
        key: `damage_closeup_${s}`,
        role: SURFACE_CLOSEUP_ROLE[s],
        title: `${capitalize(SURFACE_LABEL[s])} damage close-up`,
        hint: `Get close to the clearest area of ${SURFACE_LABEL[s]} damage.`,
      });
    }
  }
  return slots;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
