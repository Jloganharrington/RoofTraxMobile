/**
 * ProofPackageBuilderPage — /proof-packages
 *
 * Single builder page for both audiences:
 *  • PP-only subscribers  (session cookie, /api/pp/* endpoints)
 *  • CRM users            (Bearer JWT, /api/builder/* endpoints)
 *
 * Auth is detected via GET /api/pp/me on mount (same pattern as PPUpgradePage).
 * If neither auth is valid the user is redirected to their login page.
 *
 * Groups inspections into three buckets using readiness summary data:
 *  1. Needs attention  — !can_generate
 *  2. Ready to generate — can_generate && compiledVersionCount === 0
 *  3. Delivered        — compiledVersionCount > 0  (collapsible)
 */
import { useEffect, useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle2, Package2,
  Clock, FileWarning, Plus, Loader2,
  ArrowRight, Upload, Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shell } from '@/components/layout/Shell';
import { useGetMyProfile } from '@workspace/api-client-react';
import { roleRank } from '@workspace/authz';
import type { Role } from '@workspace/authz';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BuilderInspection {
  id: string;
  address: string | null;
  insuredName: string | null;
  carrierName: string | null;
  claimNumber: string | null;
  dateOfLoss: string | null;
  lastTouchedAt: string;
  inspectorName?: string | null;
  photoCount: number;
  supplementCount: number;
  ready: boolean;
  compiledVersionCount: number;
  // readiness summary fields (present when ?readiness=true)
  overallPass: boolean;
  can_generate: boolean;
  variant: 'upload_path' | 'field_inspection';
  deficiencyCount: number;
  // CRM only
  leadId?: string | null;
}

type AuthMode = 'loading' | 'pp' | 'crm' | 'unauthed';

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Chips ──────────────────────────────────────────────────────────────────────

function VariantChip({ variant }: { variant: BuilderInspection['variant'] }) {
  return variant === 'upload_path' ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-blue-950/60 text-blue-300 border border-blue-800/50">
      <Upload className="h-2.5 w-2.5" />Upload path
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
      <Search className="h-2.5 w-2.5" />Field
    </span>
  );
}

function ReadinessChip({ overallPass, deficiencyCount }: { overallPass: boolean; deficiencyCount: number }) {
  if (overallPass) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-green-950/60 text-green-300 border border-green-800/50">
        <CheckCircle2 className="h-2.5 w-2.5" />Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-950/60 text-amber-300 border border-amber-800/50">
      <FileWarning className="h-2.5 w-2.5" />
      {deficiencyCount > 0 ? `${deficiencyCount} issue${deficiencyCount > 1 ? 's' : ''}` : 'Incomplete'}
    </span>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

function InspectionRow({
  insp,
  authMode,
}: {
  insp: BuilderInspection;
  authMode: 'pp' | 'crm';
}) {
  const primary = insp.address ?? insp.insuredName ?? 'Unnamed inspection';
  const secondary = insp.address && insp.insuredName ? insp.insuredName : null;
  const claimInfo = [insp.carrierName, insp.claimNumber, insp.dateOfLoss].filter(Boolean).join(' · ');

  // Action
  let actionLabel = '';
  let actionHref = '';
  if (insp.compiledVersionCount > 0) {
    actionLabel = 'Open';
    actionHref = authMode === 'pp'
      ? `/pp/wizard/${insp.id}`
      : insp.leadId ? `/leads/${insp.leadId}?tab=claim` : `/inspections/${insp.id}`;
  } else if (insp.can_generate) {
    actionLabel = 'Generate';
    actionHref = authMode === 'pp'
      ? `/pp/wizard/${insp.id}`
      : insp.leadId ? `/leads/${insp.leadId}?tab=claim` : `/inspections/${insp.id}`;
  } else {
    actionLabel = 'Fix issues';
    actionHref = authMode === 'pp'
      ? `/pp/wizard/${insp.id}`
      : insp.leadId ? `/leads/${insp.leadId}?tab=claim` : `/inspections/${insp.id}`;
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors group border-b border-zinc-800/60 last:border-0">
      {/* Status icon */}
      <div className="flex-shrink-0 mt-0.5">
        {insp.compiledVersionCount > 0 ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : insp.can_generate ? (
          <Package2 className="h-4 w-4 text-orange-400" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-400" />
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-zinc-100 truncate">{primary}</span>
          {secondary && (
            <span className="text-xs text-zinc-400 truncate">{secondary}</span>
          )}
          {insp.supplementCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-600 text-zinc-400">
              +{insp.supplementCount} supp
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {claimInfo && (
            <span className="text-xs text-zinc-500 truncate">{claimInfo}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <VariantChip variant={insp.variant} />
          <ReadinessChip overallPass={insp.overallPass} deficiencyCount={insp.deficiencyCount} />
          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Clock className="h-2.5 w-2.5" />{relativeDate(insp.lastTouchedAt)}
          </span>
          {insp.compiledVersionCount > 0 && (
            <span className="text-[10px] text-zinc-500">
              {insp.compiledVersionCount} version{insp.compiledVersionCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <a
        href={`/axiomrestore-web${actionHref}`}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700 hover:border-orange-500 hover:text-orange-400">
          {actionLabel} <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </a>
    </div>
  );
}

// ── Group ──────────────────────────────────────────────────────────────────────

function Group({
  title,
  icon,
  color,
  inspections,
  authMode,
  defaultCollapsed = false,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  inspections: BuilderInspection[];
  authMode: 'pp' | 'crm';
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (inspections.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left bg-zinc-900/80 hover:bg-zinc-800/60 transition-colors ${color}`}
      >
        {icon}
        <span className="text-sm font-semibold flex-1">{title}</span>
        <Badge variant="secondary" className="text-xs font-medium bg-zinc-800 text-zinc-300 border-zinc-700">
          {inspections.length}
        </Badge>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />}
      </button>
      {!collapsed && (
        <div className="bg-zinc-900/40">
          {inspections.map((insp) => (
            <InspectionRow key={insp.id} insp={insp} authMode={authMode} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── New Package Chooser ────────────────────────────────────────────────────────

function NewPackageDialog({
  authMode,
  hasUnpackaged,
  onClose,
}: {
  authMode: 'pp' | 'crm';
  hasUnpackaged: boolean;
  onClose: () => void;
}) {
  if (authMode === 'pp') {
    // PP users: single option — no dialog needed; handled by button click
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm shadow-2xl">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-100">New Proof Package</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Choose how to start</p>
        </div>
        <div className="p-4 space-y-2">
          {/* Option 1 — From a lead (CRM only) */}
          <a href="/axiomrestore-web/leads" className="flex items-start gap-3 rounded-lg border border-zinc-700 p-3 hover:border-orange-500/60 hover:bg-zinc-800/60 transition-colors group">
            <div className="flex-shrink-0 mt-0.5 p-1.5 rounded bg-zinc-800 group-hover:bg-orange-950/60">
              <Search className="h-4 w-4 text-zinc-400 group-hover:text-orange-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">From an existing lead</p>
              <p className="text-xs text-zinc-500 mt-0.5">Open the lead profile and start compiling from there.</p>
            </div>
          </a>
          {/* Option 2 — From a field inspection (when unpackaged ones exist) */}
          {hasUnpackaged && (
            <a href="/axiomrestore-web/inspections" className="flex items-start gap-3 rounded-lg border border-zinc-700 p-3 hover:border-orange-500/60 hover:bg-zinc-800/60 transition-colors group">
              <div className="flex-shrink-0 mt-0.5 p-1.5 rounded bg-zinc-800 group-hover:bg-orange-950/60">
                <Package2 className="h-4 w-4 text-zinc-400 group-hover:text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">From a field inspection</p>
                <p className="text-xs text-zinc-500 mt-0.5">Pick a completed field inspection and compile its package.</p>
              </div>
            </a>
          )}
        </div>
        <div className="px-4 pb-4">
          <Button variant="ghost" size="sm" className="w-full text-zinc-500 hover:text-zinc-300" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ authMode }: { authMode: 'pp' | 'crm' }) {
  if (authMode === 'pp') {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-full bg-orange-950/40 flex items-center justify-center mb-4 border border-orange-800/40">
          <Package2 className="h-7 w-7 text-orange-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">No packages yet</h2>
        <p className="text-sm text-zinc-400 mb-1">
          A Proof Package is a compiled, version-controlled report that documents the scope and cause of loss for a claim.
        </p>
        <p className="text-xs text-zinc-500 mt-2 mb-6">
          You'll need clear photos of each damage area and any existing test squares. Test-square counts and repairability determinations can't be reconstructed from photos after the fact — capture those in the field.
        </p>
        <a href="/axiomrestore-web/pp/new">
          <Button className="bg-orange-600 hover:bg-orange-500 text-white">
            <Plus className="mr-2 h-4 w-4" />Start your first package
          </Button>
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center max-w-md mx-auto">
      <div className="w-14 h-14 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4 border border-zinc-700">
        <Package2 className="h-7 w-7 text-zinc-400" />
      </div>
      <h2 className="text-lg font-semibold text-zinc-100 mb-2">No packages found</h2>
      <p className="text-sm text-zinc-400 mb-6">
        Proof Packages are compiled from completed field inspections. Use the mobile app to capture and submit an inspection, then return here to compile the package.
      </p>
      <a href="/axiomrestore-web/leads">
        <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:border-orange-500 hover:text-orange-400">
          Open Leads
        </Button>
      </a>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ProofPackageBuilderPage() {
  const [authMode, setAuthMode] = useState<AuthMode>('loading');
  const [inspections, setInspections] = useState<BuilderInspection[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showChooser, setShowChooser] = useState(false);
  const { data: profileEnvelope } = useGetMyProfile();
  const userRole = (profileEnvelope?.profile?.role ?? 'field_rep') as Role;
  // report.settings_view requires super_admin
  const canViewLibrary = authMode === 'crm' && roleRank(userRole) >= roleRank('super_admin');

  // Parse leadId from query string (pipeline entry point)
  const leadId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('leadId')
    : null;

  // ── Auth detection ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/pp/me', { credentials: 'include' })
      .then((r) => {
        if (r.ok) {
          setAuthMode('pp');
        } else {
          // Not a PP session — assume CRM (ProtectedRoute redirect handles the unauthenticated case)
          setAuthMode('crm');
        }
      })
      .catch(() => setAuthMode('crm'));
  }, []);

  // ── Data fetch (after auth resolved) ─────────────────────────────────────
  useEffect(() => {
    if (authMode === 'loading' || authMode === 'unauthed') return;

    const endpoint = authMode === 'pp'
      ? '/api/pp/inspections?readiness=true'
      : '/api/builder/inspections?readiness=true';

    fetch(endpoint, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 401) {
            // CRM user isn't actually authenticated — redirect to login
            window.location.href = `/api/login?returnTo=/axiomrestore-web/proof-packages`;
            return;
          }
          return;
        }
        const body = await r.json() as { inspections: BuilderInspection[] };
        setInspections(body.inspections ?? []);
      })
      .catch(() => {})
      .finally(() => setDataLoading(false));
  }, [authMode]);

  // ── Groups ─────────────────────────────────────────────────────────────────
  let displayed = inspections;
  if (leadId) {
    // Pipeline entry: show only the inspection tied to this lead
    displayed = inspections.filter((i) => i.leadId === leadId);
  }

  const needsAttention = displayed.filter((i) => !i.can_generate && i.compiledVersionCount === 0);
  const readyToGenerate = displayed.filter((i) => i.can_generate && i.compiledVersionCount === 0);
  const delivered = displayed.filter((i) => i.compiledVersionCount > 0);
  const hasUnpackaged = inspections.some((i) => i.compiledVersionCount === 0);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (authMode === 'loading' || (authMode !== 'unauthed' && dataLoading)) {
    return (
      <Shell>
        <div className="min-h-screen flex items-center justify-center bg-zinc-950">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </Shell>
    );
  }

  if (authMode === 'unauthed') {
    window.location.href = '/axiomrestore-web/pp/login';
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const resolvedAuthMode = authMode as 'pp' | 'crm';

  return (
    <Shell>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="max-w-3xl mx-auto px-4 py-8">

          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-zinc-100">Proof Package Builder</h1>
              {leadId && (
                <p className="text-xs text-zinc-500 mt-0.5">Filtered to lead · <a href="/axiomrestore-web/proof-packages" className="text-orange-400 hover:underline">Show all</a></p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Library button — CRM super-admins only */}
              {canViewLibrary && (
                <a href="/axiomrestore-web/settings/library">
                  <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 h-8">
                    <BookOpen className="h-3.5 w-3.5 mr-1.5" />Library
                  </Button>
                </a>
              )}
              {/* New Package */}
              {resolvedAuthMode === 'pp' ? (
                <a href="/axiomrestore-web/pp/new">
                  <Button size="sm" className="bg-orange-600 hover:bg-orange-500 text-white h-8">
                    <Plus className="h-3.5 w-3.5 mr-1" />New Package
                  </Button>
                </a>
              ) : (
                <Button size="sm" className="bg-orange-600 hover:bg-orange-500 text-white h-8" onClick={() => setShowChooser(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />New Package
                </Button>
              )}
            </div>
          </div>

          {/* Empty state */}
          {!dataLoading && displayed.length === 0 && (
            <EmptyState authMode={resolvedAuthMode} />
          )}

          {/* Groups */}
          {displayed.length > 0 && (
            <div className="space-y-3">
              <Group
                title="Needs attention"
                icon={<AlertCircle className="h-4 w-4 text-amber-400" />}
                color="text-amber-300"
                inspections={needsAttention}
                authMode={resolvedAuthMode}
              />
              <Group
                title="Ready to generate"
                icon={<Package2 className="h-4 w-4 text-orange-400" />}
                color="text-orange-300"
                inspections={readyToGenerate}
                authMode={resolvedAuthMode}
              />
              <Group
                title="Delivered"
                icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
                color="text-green-300"
                inspections={delivered}
                authMode={resolvedAuthMode}
                defaultCollapsed={needsAttention.length > 0 || readyToGenerate.length > 0}
              />
            </div>
          )}
        </div>
      </div>

      {/* New Package chooser dialog (CRM only) */}
      {showChooser && (
        <NewPackageDialog
          authMode={resolvedAuthMode}
          hasUnpackaged={hasUnpackaged}
          onClose={() => setShowChooser(false)}
        />
      )}
    </Shell>
  );
}
