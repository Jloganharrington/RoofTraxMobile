/**
 * /pp/inspections — My Inspections
 *
 * Lists all inspections captured under the company by mobile-app reps.
 * Groups by address, shows readiness status, and provides a "Generate Package"
 * button on ready inspections.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Camera, User, MapPin, AlertCircle, Loader2, PackagePlus, Plus } from 'lucide-react';
import { useLocation } from 'wouter';

interface PPInspection {
  id: string;
  address: string | null;
  insuredName: string | null;
  status: string;
  inspectedAt: string;
  inspectorName: string;
  photoCount: number;
  ready: boolean;
  packageCount: number;
}

export default function MyInspectionsPage() {
  const [inspections, setInspections] = useState<PPInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();

  const params = new URLSearchParams(window.location.search);
  const verified = params.get('verified') === '1';
  const ready = params.get('ready') === '1';

  useEffect(() => {
    fetch('/api/pp/inspections', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? 'Failed to load inspections');
        }
        return r.json() as Promise<{ inspections: PPInspection[] }>;
      })
      .then((body) => setInspections(body.inspections))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-zinc-400">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-xs text-orange-400 hover:text-orange-300 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">My Inspections</h1>
          <p className="text-sm text-zinc-400 mt-1">
            All inspections captured by your team. Generate a Proof Package from any ready inspection.
          </p>
        </div>
        <button
          onClick={() => navigate('/pp/new')}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors flex-shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create New Package</span>
          <span className="sm:hidden">New Package</span>
        </button>
      </div>

      {verified && (
        <div className="flex items-center gap-2 bg-green-900/20 border border-green-700 text-green-400 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          Email verified successfully — your account is ready.
        </div>
      )}

      {ready && (
        <div className="flex items-center gap-2 bg-orange-900/20 border border-orange-700 text-orange-400 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          You're ready — pick an inspection below and click <strong className="font-semibold">Generate Package</strong> to start building.
        </div>
      )}

      {inspections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Camera className="h-12 w-12 text-zinc-700" />
          <div>
            <p className="text-zinc-300 font-medium">No inspections yet</p>
            <p className="text-sm text-zinc-500 mt-1">
              Inspections will appear here once your field reps capture them in the mobile app.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {inspections.map((insp) => (
            <div
              key={insp.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              {/* Left: address + meta */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-100 truncate">
                      {insp.address ?? 'Address not recorded'}
                    </p>
                    {insp.insuredName && (
                      <p className="text-xs text-zinc-500 truncate">{insp.insuredName}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(insp.inspectedAt).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {insp.inspectorName}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5" />
                    {insp.photoCount} photo{insp.photoCount !== 1 ? 's' : ''}
                  </span>
                  {insp.packageCount > 0 && (
                    <span className="flex items-center gap-1.5 text-orange-400">
                      <PackagePlus className="h-3.5 w-3.5" />
                      {insp.packageCount} package{insp.packageCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: readiness pill + action */}
              <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 flex-shrink-0">
                {insp.ready ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-400 border border-green-800">
                    <CheckCircle2 className="h-3 w-3" /> Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
                    <Clock className="h-3 w-3" /> Pending
                  </span>
                )}

                {insp.ready ? (
                  <button
                    onClick={() => navigate(`/pp/wizard/${insp.id}`)}
                    className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors whitespace-nowrap"
                  >
                    Generate Package
                  </button>
                ) : (
                  <button
                    disabled
                    title="Inspection must be submitted and AI summary generated before generating a package"
                    className="px-3 py-1.5 text-xs font-semibold bg-zinc-800 text-zinc-600 rounded cursor-not-allowed whitespace-nowrap"
                  >
                    Generate Package
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
