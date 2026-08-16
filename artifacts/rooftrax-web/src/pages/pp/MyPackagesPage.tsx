/**
 * /pp/packages — My Packages
 *
 * Lists all previously compiled proof packages for the company.
 * Each version links to GET /api/pp/inspections/:id/report/:versionIndex
 * which renders the JSON blob as text/html (with blocked-content policy applied).
 */
import { useEffect, useState } from 'react';
import { Package, MapPin, Clock, AlertCircle, Loader2, ExternalLink, Eye, Download } from 'lucide-react';

interface PPPackageVersion {
  index: number;
  generatedAt: string;
  hasBlob: boolean;
}

interface PPPackage {
  inspectionId: string;
  address: string | null;
  insuredName: string | null;
  latestCompiledAt: string;
  versionCount: number;
  versions: PPPackageVersion[];
  status: 'compiled' | 'pending';
}

function reportUrl(inspectionId: string, versionIndex: number): string {
  return `/api/pp/inspections/${inspectionId}/report/${versionIndex}`;
}

function pdfUrl(inspectionId: string, versionIndex: number): string {
  return `/api/pp/inspections/${inspectionId}/report/${versionIndex}/pdf`;
}

export default function MyPackagesPage() {
  const [packages, setPackages] = useState<PPPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/pp/packages', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? 'Failed to load packages');
        }
        return r.json() as Promise<{ packages: PPPackage[] }>;
      })
      .then((body) => setPackages(body.packages))
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
      <div>
        <h1 className="text-2xl font-bold text-white">My Packages</h1>
        <p className="text-sm text-zinc-400 mt-1">
          All compiled Proof Packages for your company. Each report opens as a rendered HTML document.
        </p>
      </div>

      {packages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Package className="h-12 w-12 text-zinc-700" />
          <div>
            <p className="text-zinc-300 font-medium">No packages yet</p>
            <p className="text-sm text-zinc-500 mt-1">
              Generated Proof Packages will appear here. Head to My Inspections to get started.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => {
            const isExpanded = expandedId === pkg.inspectionId;
            const latestVersion = pkg.versions[pkg.versions.length - 1];

            return (
              <div
                key={pkg.inspectionId}
                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
              >
                {/* Summary row */}
                <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-semibold text-zinc-100 truncate">
                          {pkg.address ?? 'Address not recorded'}
                        </p>
                        {pkg.insuredName && (
                          <p className="text-xs text-zinc-500 truncate">{pkg.insuredName}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Latest:{' '}
                        {new Date(pkg.latestCompiledAt).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5" />
                        {pkg.versionCount} version{pkg.versionCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 flex-shrink-0">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-800">
                      Compiled
                    </span>

                    <div className="flex gap-2">
                      {/* Download PDF and view latest version */}
                      {latestVersion ? (
                        <>
                          <a
                            href={pdfUrl(pkg.inspectionId, latestVersion.index)}
                            download
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download PDF
                          </a>
                          <a
                            href={reportUrl(pkg.inspectionId, latestVersion.index)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View Report
                          </a>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-800 text-zinc-500 rounded">
                          Unavailable
                        </span>
                      )}

                      {/* Expand/collapse version history */}
                      {pkg.versionCount > 1 && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : pkg.inspectionId)}
                          className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                        >
                          {isExpanded ? 'Less' : 'History'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Version history */}
                {isExpanded && (
                  <div className="border-t border-zinc-800 px-5 py-3 bg-zinc-950/40">
                    <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-3">
                      Version History
                    </p>
                    <div className="space-y-2">
                      {[...pkg.versions].reverse().map((ver) => (
                        <div
                          key={ver.index}
                          className="flex items-center justify-between gap-4 text-xs"
                        >
                          <span className="text-zinc-400">
                            v{ver.index + 1} —{' '}
                            {new Date(ver.generatedAt).toLocaleString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                              hour: 'numeric', minute: '2-digit',
                            })}
                          </span>
                          <div className="flex items-center gap-3">
                            <a
                              href={pdfUrl(pkg.inspectionId, ver.index)}
                              download
                              className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300"
                            >
                              <Download className="h-3 w-3" /> PDF
                            </a>
                            <a
                              href={reportUrl(pkg.inspectionId, ver.index)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200"
                            >
                              <ExternalLink className="h-3 w-3" /> View
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
