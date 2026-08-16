/**
 * /pp/settings — Account Settings
 *
 * Lets the company admin update company name, contact info, logo, work type,
 * contractor credentials (licenses + qualifications), and jurisdiction packs.
 * Shows a readiness banner when required compile prerequisites are missing.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { PPUser, PPCompany } from '@/components/layout/PPProtectedRoute';

// ── Constants ────────────────────────────────────────────────────────────────

type MarketType = 'retail' | 'insurance' | 'retail_insurance';

const MARKET_OPTIONS: { value: MarketType; label: string; description: string }[] = [
  {
    value: 'retail',
    label: 'Retail',
    description: 'Homeowner-pay projects — storm damage, aging systems, upgrades',
  },
  {
    value: 'insurance',
    label: 'Insurance',
    description: 'Insurance-carrier claims — supplements, line-item negotiations',
  },
  {
    value: 'retail_insurance',
    label: 'Retail & Insurance',
    description: 'Both retail and insurance work',
  },
];

const TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: 'roofing', label: 'Roofing' },
  { value: 'siding', label: 'Siding' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

// ── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  companyName: string;
  firstName: string;
  lastName: string;
  billingEmail: string;
  workType: MarketType | null;
  tradeTypes: string[];
}

interface LicenseRow {
  state: string;
  number: string;
  classification: string;
}

interface OpeningStatementRow {
  title: string;
  body: string;
}

interface CitationRow {
  key: string;
  element: string;
  title: string;
  cite: string;
  body: string;
}

interface PackEditState {
  id: string | null; // null = new (unsaved)
  jurisdiction: string;
  state: string;
  openingStatements: OpeningStatementRow[];
  uppaLaw: string;
  uppaStatement: string;
  generalCodeCitations: CitationRow[];
  roofingCodeCitations: CitationRow[];
  sidingCodeCitations: CitationRow[];
}

interface ServerPack {
  id: string;
  jurisdiction: string;
  state: string;
  openingStatements: OpeningStatementRow[];
  uppaLaw: string | null;
  uppaStatement: string | null;
  generalCodeCitations: CitationRow[];
  roofingCodeCitations: CitationRow[];
  sidingCodeCitations: CitationRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function packToEditState(pack: ServerPack): PackEditState {
  return {
    id: pack.id,
    jurisdiction: pack.jurisdiction,
    state: pack.state,
    openingStatements: pack.openingStatements ?? [],
    uppaLaw: pack.uppaLaw ?? '',
    uppaStatement: pack.uppaStatement ?? '',
    generalCodeCitations: pack.generalCodeCitations ?? [],
    roofingCodeCitations: pack.roofingCodeCitations ?? [],
    sidingCodeCitations: pack.sidingCodeCitations ?? [],
  };
}

function emptyPackState(): PackEditState {
  return {
    id: null,
    jurisdiction: '',
    state: '',
    openingStatements: [],
    uppaLaw: '',
    uppaStatement: '',
    generalCodeCitations: [],
    roofingCodeCitations: [],
    sidingCodeCitations: [],
  };
}

function emptyCitation(): CitationRow {
  return { key: '', element: '', title: '', cite: '', body: '' };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function input(
  value: string,
  onChange: (v: string) => void,
  placeholder?: string,
  className?: string,
) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${className ?? ''}`}
    />
  );
}

function textarea(
  value: string,
  onChange: (v: string) => void,
  placeholder?: string,
  rows = 3,
) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-y"
    />
  );
}

// Citation section editor (general / roofing / siding)
function CitationSectionEditor({
  label,
  citations,
  onChange,
}: {
  label: string;
  citations: CitationRow[];
  onChange: (rows: CitationRow[]) => void;
}) {
  function updateRow(i: number, patch: Partial<CitationRow>) {
    const next = [...citations];
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  }
  function removeRow(i: number) {
    onChange(citations.filter((_, idx) => idx !== i));
  }
  function addRow() {
    onChange([...citations, emptyCitation()]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</p>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus className="h-3 w-3" /> Add Citation
        </button>
      </div>
      {citations.length === 0 && (
        <p className="text-xs text-zinc-600 italic">No citations yet. Add one above.</p>
      )}
      {citations.map((row, i) => (
        <div key={i} className="relative border border-zinc-700/60 rounded-lg p-3 space-y-2 bg-zinc-800/40">
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="absolute top-2 right-2 text-zinc-600 hover:text-red-400"
            title="Remove citation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <div className="grid grid-cols-2 gap-2 pr-6">
            {input(row.key, (v) => updateRow(i, { key: v }), 'Key (e.g. roof_covering)')}
            {input(row.element, (v) => updateRow(i, { element: v }), 'Element (e.g. Roof Covering)')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {input(row.title, (v) => updateRow(i, { title: v }), 'Title (e.g. IRC R905.2)')}
            {input(row.cite, (v) => updateRow(i, { cite: v }), 'Code reference')}
          </div>
          {textarea(row.body, (v) => updateRow(i, { body: v }), 'Citation body text…', 2)}
        </div>
      ))}
    </div>
  );
}

// Opening statements editor
function OpeningStatementsEditor({
  statements,
  onChange,
}: {
  statements: OpeningStatementRow[];
  onChange: (rows: OpeningStatementRow[]) => void;
}) {
  function updateRow(i: number, patch: Partial<OpeningStatementRow>) {
    const next = [...statements];
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  }
  function removeRow(i: number) {
    onChange(statements.filter((_, idx) => idx !== i));
  }
  function addRow() {
    onChange([...statements, { title: '', body: '' }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Opening Statements</p>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus className="h-3 w-3" /> Add Statement
        </button>
      </div>
      {statements.length === 0 && (
        <p className="text-xs text-zinc-600 italic">No opening statements yet.</p>
      )}
      {statements.map((row, i) => (
        <div key={i} className="relative border border-zinc-700/60 rounded-lg p-3 space-y-2 bg-zinc-800/40">
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="absolute top-2 right-2 text-zinc-600 hover:text-red-400"
            title="Remove statement"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <div className="pr-6">
            {input(row.title, (v) => updateRow(i, { title: v }), 'Code book title (e.g. 2021 IRC)')}
          </div>
          {textarea(row.body, (v) => updateRow(i, { body: v }), 'Statement text…', 3)}
        </div>
      ))}
    </div>
  );
}

// Pack editor card (existing or new)
function PackEditor({
  form,
  saving,
  saveSuccess,
  saveError,
  onChange,
  onSave,
  onDiscard,
  isNew,
}: {
  form: PackEditState;
  saving: boolean;
  saveSuccess: boolean;
  saveError: string | null;
  onChange: (patch: Partial<PackEditState>) => void;
  onSave: () => void;
  onDiscard?: () => void;
  isNew: boolean;
}) {
  const [expanded, setExpanded] = useState(isNew);

  return (
    <div className="border border-zinc-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/60 hover:bg-zinc-800 text-left transition-colors"
      >
        <div>
          <p className="text-sm font-semibold text-zinc-200">
            {form.jurisdiction.trim() || <span className="text-zinc-500 italic">New Jurisdiction Pack</span>}
          </p>
          {form.state && (
            <p className="text-xs text-zinc-500 mt-0.5">State: {form.state.toUpperCase()}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && <CheckCircle2 className="h-4 w-4 text-green-400" />}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-5 bg-zinc-900">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-400">Jurisdiction Name</label>
              {input(form.jurisdiction, (v) => onChange({ jurisdiction: v }), 'e.g. Dallas County, TX')}
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-400">State Code</label>
              <select
                value={form.state}
                onChange={(e) => onChange({ state: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              >
                <option value="">— Select —</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Opening statements */}
          <OpeningStatementsEditor
            statements={form.openingStatements}
            onChange={(v) => onChange({ openingStatements: v })}
          />

          {/* UPPA */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">UPPA (optional)</p>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-500">Governing law reference</label>
              {input(form.uppaLaw, (v) => onChange({ uppaLaw: v }), 'e.g. Va. Code § 55.1-2900')}
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-500">UPPA statement</label>
              {textarea(form.uppaStatement, (v) => onChange({ uppaStatement: v }), 'Printed in the Proof Package…', 3)}
            </div>
          </div>

          {/* Citations */}
          <CitationSectionEditor
            label="General Code Citations"
            citations={form.generalCodeCitations}
            onChange={(v) => onChange({ generalCodeCitations: v })}
          />
          <CitationSectionEditor
            label="Roofing Code Citations"
            citations={form.roofingCodeCitations}
            onChange={(v) => onChange({ roofingCodeCitations: v })}
          />
          <CitationSectionEditor
            label="Siding Code Citations"
            citations={form.sidingCodeCitations}
            onChange={(v) => onChange({ sidingCodeCitations: v })}
          />

          {/* Feedback */}
          {saveError && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {saveError}
            </div>
          )}
          {saveSuccess && (
            <div className="flex items-center gap-2 bg-green-900/20 border border-green-800 text-green-400 rounded-lg px-4 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Jurisdiction pack saved.
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save Pack'}
            </button>
            {isNew && onDiscard && (
              <button
                type="button"
                onClick={onDiscard}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Discard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PPSettingsPage() {
  const [user, setUser] = useState<PPUser | null>(null);
  const [company, setCompany] = useState<PPCompany | null>(null);
  const [loading, setLoading] = useState(true);

  // Company info form
  const [form, setForm] = useState<FormState>({
    companyName: '',
    firstName: '',
    lastName: '',
    billingEmail: '',
    workType: null,
    tradeTypes: [],
  });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Logo
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Credentials (report-settings)
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [qualificationsText, setQualificationsText] = useState('');
  const [pricingBasisStatement, setPricingBasisStatement] = useState('');
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsSaveSuccess, setCredsSaveSuccess] = useState(false);
  const [credsSaveError, setCredsSaveError] = useState<string | null>(null);

  // Jurisdiction packs
  const [packForms, setPackForms] = useState<PackEditState[]>([]);
  const [packSaving, setPackSaving] = useState<Set<number>>(new Set());
  const [packSaveSuccess, setPackSaveSuccess] = useState<Set<number>>(new Set());
  const [packSaveErrors, setPackSaveErrors] = useState<Map<number, string>>(new Map());
  const [newPackForm, setNewPackForm] = useState<PackEditState | null>(null);
  const [newPackSaving, setNewPackSaving] = useState(false);
  const [newPackSaveSuccess, setNewPackSaveSuccess] = useState(false);
  const [newPackSaveError, setNewPackSaveError] = useState<string | null>(null);
  const [packsLoaded, setPacksLoaded] = useState(false);

  // Readiness banner
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [missingItems, setMissingItems] = useState<string[]>([]);

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/pp/me', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return;
        const body = await r.json() as { user: PPUser; company: PPCompany };
        setUser(body.user);
        setCompany(body.company);
        setLogoUrl(body.company.logoSignedUrl ?? null);
        setForm({
          companyName: body.company.name,
          firstName: body.user.firstName ?? '',
          lastName: body.user.lastName ?? '',
          billingEmail: body.user.email ?? '',
          workType: (body.company.workType as MarketType | null) ?? null,
          tradeTypes: body.company.tradeTypes ?? [],
        });

        const companyId = body.company.id;

        // Load report-settings and jurisdiction-packs in parallel
        const [settingsRes, packsRes] = await Promise.all([
          fetch(`/api/companies/${companyId}/report-settings`, { credentials: 'include' }),
          fetch(`/api/companies/${companyId}/jurisdiction-packs`, { credentials: 'include' }),
        ]);

        let loadedLicenses: LicenseRow[] = [];
        let loadedQuals = '';
        if (settingsRes.ok) {
          const s = (await settingsRes.json() as { settings: { licenses: LicenseRow[]; qualificationsText: string | null; pricingBasisStatement: string | null } }).settings;
          loadedLicenses = s.licenses ?? [];
          loadedQuals = s.qualificationsText ?? '';
          setLicenses(loadedLicenses);
          setQualificationsText(loadedQuals);
          setPricingBasisStatement(s.pricingBasisStatement ?? '');
        }

        let loadedPacks: ServerPack[] = [];
        if (packsRes.ok) {
          const p = await packsRes.json() as { packs: ServerPack[] };
          loadedPacks = p.packs ?? [];
          setPackForms(loadedPacks.map(packToEditState));
        }
        setPacksLoaded(true);

        // Compute readiness from loaded data (avoid re-reading consumed responses)
        const missing: string[] = [];
        if (!loadedLicenses.length) missing.push('Contractor license(s)');
        if (!loadedQuals.trim()) missing.push('Statement of Qualifications');
        if (loadedPacks.length === 0) missing.push('Building Regulation Jurisdiction Pack');
        setMissingItems(missing);
      })
      .finally(() => setLoading(false));
  }, []);

  // Recompute readiness whenever credentials or packs change
  // Readiness is based exclusively on server-persisted data.
  // An unsaved newPackForm draft does NOT satisfy the pack prerequisite.
  function recomputeReadiness(
    currentLicenses: LicenseRow[],
    currentQuals: string,
    savedPackCount: number,
  ) {
    const missing: string[] = [];
    if (currentLicenses.length === 0) missing.push('Contractor license(s)');
    if (!currentQuals.trim()) missing.push('Statement of Qualifications');
    if (savedPackCount === 0) missing.push('Building Regulation Jurisdiction Pack');
    setMissingItems(missing);
  }

  // ── Company info save ──────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      const res = await fetch('/api/pp/company', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName.trim() || undefined,
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
          billingEmail: form.billingEmail.trim() || undefined,
          workType: form.workType ?? undefined,
          tradeTypes: form.tradeTypes.length > 0 ? form.tradeTypes : undefined,
        }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to save');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // ── Logo upload ────────────────────────────────────────────────────────────

  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    try {
      const urlRes = await fetch('/api/pp/upload-url', { credentials: 'include' });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };
      const putRes = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      if (!putRes.ok) throw new Error('File upload failed');
      const patchRes = await fetch('/api/pp/company/logo', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectPath }),
      });
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to update logo');
      }
      const meRes = await fetch('/api/pp/me', { credentials: 'include' });
      if (meRes.ok) {
        const meBody = await meRes.json() as { user: PPUser; company: PPCompany };
        setLogoUrl(meBody.company.logoSignedUrl ?? null);
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  // ── Credentials save ───────────────────────────────────────────────────────

  const handleCredentialsSave = async () => {
    if (!company) return;
    setCredsSaving(true);
    setCredsSaveSuccess(false);
    setCredsSaveError(null);
    try {
      const res = await fetch(`/api/companies/${company.id}/report-settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            licenses: licenses.map((l) => ({
              state: l.state.trim().toUpperCase(),
              number: l.number.trim(),
              classification: l.classification.trim(),
            })),
            qualificationsText: qualificationsText.trim() || null,
            pricingBasisStatement: pricingBasisStatement.trim() || null,
          },
        }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to save credentials');
      setCredsSaveSuccess(true);
      setBannerDismissed(false);
      recomputeReadiness(licenses, qualificationsText, packForms.length);
      setTimeout(() => setCredsSaveSuccess(false), 4000);
    } catch (err: unknown) {
      setCredsSaveError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setCredsSaving(false);
    }
  };

  // ── Pack save ──────────────────────────────────────────────────────────────

  const handlePackSave = async (index: number) => {
    if (!company) return;
    const packForm = packForms[index]!;
    setPackSaving((prev) => new Set(prev).add(index));
    setPackSaveErrors((prev) => { const m = new Map(prev); m.delete(index); return m; });
    setPackSaveSuccess((prev) => { const s = new Set(prev); s.delete(index); return s; });
    try {
      const res = await fetch(`/api/companies/${company.id}/jurisdiction-packs/upsert`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pack: {
            id: packForm.id,
            jurisdiction: packForm.jurisdiction.trim(),
            state: packForm.state.trim().toUpperCase(),
            openingStatements: packForm.openingStatements,
            uppaLaw: packForm.uppaLaw.trim() || null,
            uppaStatement: packForm.uppaStatement.trim() || null,
            generalCodeCitations: packForm.generalCodeCitations,
            roofingCodeCitations: packForm.roofingCodeCitations,
            sidingCodeCitations: packForm.sidingCodeCitations,
          },
        }),
      });
      const body = await res.json() as { pack?: ServerPack; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to save pack');
      // Update the saved pack state (captures the server-assigned id)
      if (body.pack) {
        setPackForms((prev) => {
          const next = [...prev];
          next[index] = packToEditState(body.pack!);
          return next;
        });
      }
      setPackSaveSuccess((prev) => { const s = new Set(prev); s.add(index); return s; });
      setBannerDismissed(false);
      recomputeReadiness(licenses, qualificationsText, packForms.length);
      setTimeout(() => {
        setPackSaveSuccess((prev) => { const s = new Set(prev); s.delete(index); return s; });
      }, 4000);
    } catch (err: unknown) {
      setPackSaveErrors((prev) => {
        const m = new Map(prev);
        m.set(index, err instanceof Error ? err.message : 'Failed to save pack');
        return m;
      });
    } finally {
      setPackSaving((prev) => { const s = new Set(prev); s.delete(index); return s; });
    }
  };

  const handleNewPackSave = async () => {
    if (!company || !newPackForm) return;
    setNewPackSaving(true);
    setNewPackSaveSuccess(false);
    setNewPackSaveError(null);
    try {
      const res = await fetch(`/api/companies/${company.id}/jurisdiction-packs/upsert`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pack: {
            jurisdiction: newPackForm.jurisdiction.trim(),
            state: newPackForm.state.trim().toUpperCase(),
            openingStatements: newPackForm.openingStatements,
            uppaLaw: newPackForm.uppaLaw.trim() || null,
            uppaStatement: newPackForm.uppaStatement.trim() || null,
            generalCodeCitations: newPackForm.generalCodeCitations,
            roofingCodeCitations: newPackForm.roofingCodeCitations,
            sidingCodeCitations: newPackForm.sidingCodeCitations,
          },
        }),
      });
      const body = await res.json() as { pack?: ServerPack; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to save pack');
      if (body.pack) {
        setPackForms((prev) => [...prev, packToEditState(body.pack!)]);
      }
      setNewPackForm(null);
      setBannerDismissed(false);
      // packForms.length + 1: the new pack was just appended via setPackForms above,
      // but React state is async — use the pre-update length plus one for the count.
      recomputeReadiness(licenses, qualificationsText, packForms.length + 1);
    } catch (err: unknown) {
      setNewPackSaveError(err instanceof Error ? err.message : 'Failed to save pack');
    } finally {
      setNewPackSaving(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const handleCopyId = () => {
    if (company?.id) {
      void navigator.clipboard.writeText(company.id).then(() => {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      });
    }
  };

  function toggleTrade(trade: string) {
    setForm((f) => ({
      ...f,
      tradeTypes: f.tradeTypes.includes(trade)
        ? f.tradeTypes.filter((t) => t !== trade)
        : [...f.tradeTypes, trade],
    }));
  }

  function updateLicense(i: number, patch: Partial<LicenseRow>) {
    setLicenses((prev) => {
      const next = [...prev];
      next[i] = { ...next[i]!, ...patch };
      return next;
    });
  }

  function removeLicense(i: number) {
    setLicenses((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Account Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage your company details, credentials, and report settings.</p>
      </div>

      {/* ── Readiness banner ─────────────────────────────────────────────── */}
      {!bannerDismissed && missingItems.length > 0 && (
        <div className="relative bg-amber-950/30 border border-amber-700/50 rounded-xl p-4">
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="absolute top-3 right-3 text-amber-700 hover:text-amber-400"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">
                Proof Package not ready to compile
              </p>
              <p className="text-xs text-amber-400/80 mt-1">
                Complete the following before generating your first package:
              </p>
              <ul className="mt-2 space-y-1">
                {missingItems.map((item) => (
                  <li key={item} className="text-xs text-amber-400 flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-amber-400 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Company ID ───────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Company ID</p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-orange-400 tracking-wider">{company?.id}</span>
          <button
            onClick={handleCopyId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            {copiedId ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> Copied</>
            ) : (
              <><Copy className="h-3.5 w-3.5" /> Copy</>
            )}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Share this ID with your field reps so they can link to your company in the mobile app.
        </p>
      </div>

      {/* ── Company Information ───────────────────────────────────────────── */}
      <form onSubmit={handleSave} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
        <p className="text-sm font-semibold text-zinc-200">Company Information</p>

        {saveError && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="flex items-center gap-2 bg-green-900/20 border border-green-800 text-green-400 rounded-lg px-4 py-3 text-sm">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Settings saved successfully.
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-company-name">
            Company Name
          </label>
          <input
            id="pp-company-name"
            type="text"
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            placeholder="Your company name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-first-name">First Name</label>
            <input
              id="pp-first-name"
              type="text"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="First"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-last-name">Last Name</label>
            <input
              id="pp-last-name"
              type="text"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="Last"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-billing-email">Billing Email</label>
          <input
            id="pp-billing-email"
            type="email"
            value={form.billingEmail}
            onChange={(e) => setForm((f) => ({ ...f, billingEmail: e.target.value }))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            placeholder="billing@yourcompany.com"
          />
          <p className="text-[11px] text-zinc-600">This is also your login email.</p>
        </div>

        {/* Work Type */}
        <div className="border-t border-zinc-800 pt-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-200">Work Type</p>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-400">Market</label>
            <div className="space-y-2">
              {MARKET_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, workType: opt.value }))}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors
                    ${form.workType === opt.value
                      ? 'border-orange-500 bg-orange-500/10 text-white'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'}`}
                >
                  <p className="text-sm font-semibold">{opt.label}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-400">
              Trade(s) <span className="text-zinc-600">(select all that apply)</span>
            </label>
            <div className="flex gap-2">
              {TRADE_OPTIONS.map((opt) => {
                const selected = form.tradeTypes.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleTrade(opt.value)}
                    className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors
                      ${selected
                        ? 'border-orange-500 bg-orange-500/10 text-white'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      {/* ── Company Logo ─────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-zinc-200">Company Logo</p>
        <p className="text-xs text-zinc-500">
          Uploaded to your Proof Package letterhead. PNG or JPG, max 4 MB.
        </p>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <div className="h-16 w-16 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 flex-shrink-0">
              <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="h-16 w-16 rounded-lg border border-dashed border-zinc-700 bg-zinc-800 flex-shrink-0 flex items-center justify-center">
              <Upload className="h-6 w-6 text-zinc-600" />
            </div>
          )}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLogoUpload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoUploading}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {logoUploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> {logoUrl ? 'Replace Logo' : 'Upload Logo'}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Contractor Credentials ────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
        <div>
          <p className="text-sm font-semibold text-zinc-200">Contractor Credentials</p>
          <p className="text-xs text-zinc-500 mt-1">
            Licenses and qualifications printed in the Proof Package. At least one license and
            a Statement of Qualifications are required before you can compile.
          </p>
        </div>

        {/* Licenses */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Contractor Licenses <span className="text-amber-400">*</span>
            </label>
            <button
              type="button"
              onClick={() => setLicenses((prev) => [...prev, { state: '', number: '', classification: '' }])}
              className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300"
            >
              <Plus className="h-3 w-3" /> Add License
            </button>
          </div>
          {licenses.length === 0 && (
            <p className="text-xs text-zinc-600 italic">No licenses yet. Add at least one to enable compile.</p>
          )}
          {licenses.map((lic, i) => (
            <div key={i} className="relative border border-zinc-700/60 rounded-lg p-3 bg-zinc-800/40">
              <button
                type="button"
                onClick={() => removeLicense(i)}
                className="absolute top-2 right-2 text-zinc-600 hover:text-red-400"
                title="Remove license"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="grid grid-cols-3 gap-2 pr-6">
                <div className="space-y-1">
                  <label className="block text-[11px] text-zinc-500">State</label>
                  <select
                    value={lic.state}
                    onChange={(e) => updateLicense(i, { state: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  >
                    <option value="">—</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-zinc-500">License #</label>
                  <input
                    type="text"
                    value={lic.number}
                    onChange={(e) => updateLicense(i, { number: e.target.value })}
                    placeholder="e.g. RC-12345"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-zinc-500">Classification</label>
                  <input
                    type="text"
                    value={lic.classification}
                    onChange={(e) => updateLicense(i, { classification: e.target.value })}
                    placeholder="e.g. Roofing Contractor"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Qualifications */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide">
            Statement of Qualifications <span className="text-amber-400">*</span>
          </label>
          <p className="text-xs text-zinc-600">
            Your company's experience, certifications, and expertise. Printed in the Proof Package.
          </p>
          <textarea
            value={qualificationsText}
            onChange={(e) => setQualificationsText(e.target.value)}
            placeholder="Describe your company's credentials, certifications, years of experience, manufacturer authorizations, etc."
            rows={5}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-y"
          />
        </div>

        {/* Pricing Basis (optional) */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide">
            Pricing Basis Statement <span className="text-zinc-600 normal-case font-normal">(optional)</span>
          </label>
          <p className="text-xs text-zinc-600">
            How your pricing is determined — Xactimate, market rate, etc. Informational only; does not affect compile.
          </p>
          <textarea
            value={pricingBasisStatement}
            onChange={(e) => setPricingBasisStatement(e.target.value)}
            placeholder="e.g. All pricing is based on current Xactimate market pricing for the applicable zip code…"
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-y"
          />
        </div>

        {/* Credentials save feedback */}
        {credsSaveError && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {credsSaveError}
          </div>
        )}
        {credsSaveSuccess && (
          <div className="flex items-center gap-2 bg-green-900/20 border border-green-800 text-green-400 rounded-lg px-4 py-3 text-sm">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Credentials saved.
          </div>
        )}

        <button
          type="button"
          disabled={credsSaving}
          onClick={() => void handleCredentialsSave()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {credsSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          {credsSaving ? 'Saving…' : 'Save Credentials'}
        </button>
      </div>

      {/* ── Jurisdiction Packs ────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-zinc-200">Building Regulation Jurisdiction Pack</p>
          <p className="text-xs text-zinc-500 mt-1">
            Code citations and opening statements printed in Section I of the Proof Package.
            At least one pack is required. The pack's state must match the inspection property state.
          </p>
        </div>

        {!packsLoaded && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading packs…
          </div>
        )}

        {packsLoaded && packForms.length === 0 && !newPackForm && (
          <p className="text-xs text-zinc-600 italic">No jurisdiction packs yet. Add one below.</p>
        )}

        {/* Existing packs */}
        <div className="space-y-3">
          {packForms.map((packForm, i) => (
            <PackEditor
              key={packForm.id ?? `pack-${i}`}
              form={packForm}
              saving={packSaving.has(i)}
              saveSuccess={packSaveSuccess.has(i)}
              saveError={packSaveErrors.get(i) ?? null}
              onChange={(patch) =>
                setPackForms((prev) => {
                  const next = [...prev];
                  next[i] = { ...next[i]!, ...patch };
                  return next;
                })
              }
              onSave={() => void handlePackSave(i)}
              isNew={false}
            />
          ))}
        </div>

        {/* New pack form */}
        {newPackForm && (
          <PackEditor
            form={newPackForm}
            saving={newPackSaving}
            saveSuccess={newPackSaveSuccess}
            saveError={newPackSaveError}
            onChange={(patch) => setNewPackForm((prev) => prev ? { ...prev, ...patch } : prev)}
            onSave={() => void handleNewPackSave()}
            onDiscard={() => {
              setNewPackForm(null);
              setNewPackSaveError(null);
            }}
            isNew
          />
        )}

        {/* Add pack button */}
        {!newPackForm && (
          <button
            type="button"
            onClick={() => setNewPackForm(emptyPackState())}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-dashed border-zinc-600 hover:border-orange-500/50 text-zinc-400 hover:text-orange-400 rounded-lg transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Jurisdiction Pack
          </button>
        )}
      </div>

      {/* ── Upgrade CTA ───────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-200">Upgrade to Full CRM</p>
            <p className="text-xs text-zinc-500 mt-1">
              Get access to the full RoofTrax CRM — lead pipelines, team management, insurance
              workflows, and more.
            </p>
          </div>
        </div>
        <a
          href="/rooftrax-web/pp/upgrade"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
        >
          Upgrade to Full CRM →
        </a>
      </div>
    </div>
  );
}
