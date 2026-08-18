/**
 * /pp/new — New Package Pre-flight Flow
 *
 * Step 1: Damage type selection (Roof / Siding / both)
 * Step 2: Interactive pre-flight checklist, filtered to the selected types
 *
 * No API calls — all state is in-memory. On completion, navigates to
 * /pp/inspections?ready=1 so the user can pick an inspection to package.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  Home, Layers, CheckCircle2, Circle, ArrowLeft, ArrowRight, PackagePlus,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

type DamageType = 'roof' | 'siding';

interface ChecklistItem {
  id: string;
  /** Damage types that require this item */
  types: DamageType[];
  group: string;
  label: string;
  description: string;
}

// ── Checklist data ────────────────────────────────────────────────────────

const CHECKLIST: ChecklistItem[] = [
  // ── Photos & Evidence — Roof ──────────────────────────────────────────
  {
    id: 'roof-photos-damage',
    types: ['roof'],
    group: 'Photos & Evidence',
    label: 'Close-up field photos of roof damage',
    description:
      'Impact marks, granule loss, bruising, creases, or displacement on every documented slope.',
  },
  {
    id: 'roof-photos-aerial',
    types: ['roof'],
    group: 'Photos & Evidence',
    label: 'Aerial or satellite imagery',
    description:
      'Overhead view of the full property and roof from a drone, satellite, or aerial camera.',
  },
  {
    id: 'roof-photos-repairability',
    types: ['roof'],
    group: 'Photos & Evidence',
    label: 'Repairability assessment photos (if performed)',
    description:
      'Baseline and post-manipulation photos from the repairability protocol, including per-shingle detail images.',
  },

  // ── Photos & Evidence — Siding ────────────────────────────────────────
  {
    id: 'siding-photos-damage',
    types: ['siding'],
    group: 'Photos & Evidence',
    label: 'Close-up field photos of siding damage',
    description:
      'Impacts, cracks, unlocked panels, or displaced sections on each damaged elevation.',
  },
  {
    id: 'siding-photos-elevation',
    types: ['siding'],
    group: 'Photos & Evidence',
    label: 'Full-elevation photos of each damaged wall',
    description:
      'Full-height exterior photos showing every wall with documented damage.',
  },

  // ── Property & Claim — shared ─────────────────────────────────────────
  {
    id: 'claim-address',
    types: ['roof', 'siding'],
    group: 'Property & Claim',
    label: "Property address and insured's full name",
    description:
      "The exact loss-location address and the policy holder's name as it appears on the claim.",
  },
  {
    id: 'claim-date-of-loss',
    types: ['roof', 'siding'],
    group: 'Property & Claim',
    label: 'Date of loss',
    description: 'The storm event date — the day the damage-causing weather occurred.',
  },
  {
    id: 'claim-carrier',
    types: ['roof', 'siding'],
    group: 'Property & Claim',
    label: 'Insurance carrier name and claim number',
    description:
      'The insurance company handling the claim and the claim number assigned at first notice.',
  },
  {
    id: 'claim-adjuster',
    types: ['roof', 'siding'],
    group: 'Property & Claim',
    label: 'Adjuster name and contact information',
    description:
      "The assigned adjuster's name plus a phone number or email address.",
  },

  // ── Storm Documentation — shared ──────────────────────────────────────
  {
    id: 'storm-report',
    types: ['roof', 'siding'],
    group: 'Storm Documentation',
    label: 'Storm report (hail size and/or wind speed)',
    description:
      'NOAA storm data, Weather Underground records, or a paid storm report confirming the event at the property location.',
  },

  // ── Technical Details — Roof ──────────────────────────────────────────
  {
    id: 'roof-measurements',
    types: ['roof'],
    group: 'Technical Details',
    label: 'Roof measurements',
    description:
      'Total squares, individual slope areas, and pitch for each slope — from EagleView, Hover, or a manual takeoff.',
  },
  {
    id: 'roof-product',
    types: ['roof'],
    group: 'Technical Details',
    label: 'Roofing product identification (if known)',
    description:
      'Manufacturer and product line of the installed roofing, visible on intact shingles or available documentation.',
  },

  // ── Technical Details — Siding ────────────────────────────────────────
  {
    id: 'siding-measurements',
    types: ['siding'],
    group: 'Technical Details',
    label: 'Siding measurements',
    description:
      'Linear feet per elevation and total area, or total squares — from field measurements or a takeoff tool.',
  },
  {
    id: 'siding-product',
    types: ['siding'],
    group: 'Technical Details',
    label: 'Siding product identification (if known)',
    description:
      'Manufacturer and product line of the installed siding, visible on intact panels or product documentation.',
  },

  // ── Prior Damage — shared ─────────────────────────────────────────────
  {
    id: 'prior-damage',
    types: ['roof', 'siding'],
    group: 'Prior Damage',
    label: 'Prior damage documentation (if any exists)',
    description:
      'Photos or written notes of any pre-existing damage that pre-dates the loss event.',
  },
];

const GROUP_ORDER = [
  'Photos & Evidence',
  'Property & Claim',
  'Storm Documentation',
  'Technical Details',
  'Prior Damage',
];

// ── Sub-components ────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: 1 | 2 }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      {/* Step 1 */}
      <div className={`flex items-center gap-2 ${current >= 1 ? 'text-orange-400' : 'text-zinc-600'}`}>
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 flex-shrink-0 ${
            current > 1
              ? 'bg-orange-500 border-orange-500 text-white'
              : 'border-orange-500 text-orange-400'
          }`}
        >
          {current > 1 ? '✓' : '1'}
        </div>
        <span className="text-sm font-semibold hidden sm:block">Damage Type</span>
      </div>

      {/* Connector */}
      <div className={`flex-1 h-px max-w-16 ${current > 1 ? 'bg-orange-500' : 'bg-zinc-700'}`} />

      {/* Step 2 */}
      <div className={`flex items-center gap-2 ${current === 2 ? 'text-orange-400' : 'text-zinc-600'}`}>
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 flex-shrink-0 ${
            current === 2
              ? 'border-orange-500 text-orange-400'
              : 'border-zinc-700 text-zinc-600'
          }`}
        >
          2
        </div>
        <span className="text-sm font-semibold hidden sm:block">Pre-flight Checklist</span>
      </div>
    </div>
  );
}

function DamageTypeCard({
  icon: Icon,
  title,
  description,
  selected,
  onToggle,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex-1 min-w-0 flex flex-col items-center gap-4 p-6 rounded-xl border-2 transition-all text-center cursor-pointer ${
        selected
          ? 'border-orange-500 bg-orange-500/10'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
      }`}
    >
      <div
        className={`h-14 w-14 rounded-xl flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-orange-500/20' : 'bg-zinc-800'
        }`}
      >
        <Icon className={`h-7 w-7 ${selected ? 'text-orange-400' : 'text-zinc-500'}`} />
      </div>
      <div>
        <p className={`text-base font-bold mb-1.5 ${selected ? 'text-white' : 'text-zinc-200'}`}>
          {title}
        </p>
        <p className={`text-sm leading-snug ${selected ? 'text-zinc-300' : 'text-zinc-500'}`}>
          {description}
        </p>
      </div>
      {selected && (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Selected
        </div>
      )}
    </button>
  );
}

function ChecklistRow({
  item,
  checked,
  onToggle,
}: {
  item: ChecklistItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
        checked
          ? 'border-orange-800/50 bg-orange-950/25'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {checked ? (
          <CheckCircle2 className="h-5 w-5 text-orange-400" />
        ) : (
          <Circle className="h-5 w-5 text-zinc-600" />
        )}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold leading-tight ${checked ? 'text-zinc-200' : 'text-zinc-300'}`}>
          {item.label}
        </p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{item.description}</p>
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function NewPackagePage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTypes, setSelectedTypes] = useState<Set<DamageType>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Filter checklist to the selected damage types
  const filteredItems = CHECKLIST.filter((item) =>
    item.types.some((t) => selectedTypes.has(t)),
  );

  // Group the filtered items, preserving GROUP_ORDER
  const grouped: Record<string, ChecklistItem[]> = {};
  for (const group of GROUP_ORDER) {
    const items = filteredItems.filter((i) => i.group === group);
    if (items.length > 0) grouped[group] = items;
  }

  const totalItems = filteredItems.length;
  const checkedCount = filteredItems.filter((i) => checked.has(i.id)).length;
  const allChecked = totalItems > 0 && checkedCount === totalItems;

  const toggleType = (type: DamageType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    // Reset checklist when type selection changes so de-selected items don't ghost as checked
    setChecked(new Set());
  };

  const toggleItem = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Create New Package</h1>
        <p className="text-sm text-zinc-400 mt-1">
          {step === 1
            ? "Tell us what type of damage you're documenting."
            : 'Confirm you have everything ready before you start.'}
        </p>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Damage type ─────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <DamageTypeCard
              icon={Home}
              title="Roof Damage"
              description="Hail impacts, wind damage, displacement, or any event-related damage to the roof covering."
              selected={selectedTypes.has('roof')}
              onToggle={() => toggleType('roof')}
            />
            <DamageTypeCard
              icon={Layers}
              title="Siding Damage"
              description="Impact fractures, cracks, displaced panels, or unlocked siding from hail or wind."
              selected={selectedTypes.has('siding')}
              onToggle={() => toggleType('siding')}
            />
          </div>

          {selectedTypes.size > 0 && (
            <p className="text-xs text-zinc-500 text-center">
              You can select both if the claim covers roof and siding damage.
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => navigate('/pp/inspections')}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={selectedTypes.size === 0}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Checklist ───────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Progress summary card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-200">Items confirmed</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Check each item to confirm you have it ready to go.
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-3xl font-black tabular-nums leading-none text-white">
                {checkedCount}
                <span className="text-zinc-600 text-xl">/{totalItems}</span>
              </p>
              {allChecked && (
                <p className="text-xs font-semibold text-orange-400 flex items-center gap-1 justify-end mt-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Ready to go
                </p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden -mt-4">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-300 ease-out"
              style={{ width: totalItems ? `${(checkedCount / totalItems) * 100}%` : '0%' }}
            />
          </div>

          {/* Grouped checklist */}
          <div className="space-y-6">
            {GROUP_ORDER.map((group) => {
              const items = grouped[group];
              if (!items) return null;
              return (
                <div key={group}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-2.5">
                    {group}
                  </p>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <ChecklistRow
                        key={item.id}
                        item={item}
                        checked={checked.has(item.id)}
                        onToggle={() => toggleItem(item.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => navigate(`/pp/new/intake?types=${[...selectedTypes].join(',')}`)}
              disabled={!allChecked}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <PackagePlus className="h-4 w-4" />
              Start Building
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
