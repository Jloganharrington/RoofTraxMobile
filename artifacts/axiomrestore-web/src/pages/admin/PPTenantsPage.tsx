import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import {
  usePPTenants,
  usePPTenantDetail,
  useReAdoptMasterPack,
  type PPTenantSummary,
} from "@/hooks/use-pp-tenants";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Building2,
  Users,
  FileText,
  Package,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Shield,
  BookOpen,
  MapPin,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// ── Readiness badge ────────────────────────────────────────────────────────────

function ReadinessBadge({ pass }: { pass: boolean }) {
  return pass ? (
    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  ) : (
    <XCircle className="h-4 w-4 text-rose-500" />
  );
}

function ReadinessRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <ReadinessBadge pass={pass} />
      <span className={pass ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

// ── Overall readiness pill ─────────────────────────────────────────────────────

function ReadinessPill({ r }: { r: PPTenantSummary["readiness"] }) {
  const allPass = r.hasLicenses && r.hasQualifications && r.hasJurisdictionPack && r.hasAhjPack;
  const somePass =
    r.hasLicenses || r.hasQualifications || r.hasJurisdictionPack || r.hasAhjPack;
  if (allPass) {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 font-medium">
        Ready
      </Badge>
    );
  }
  if (somePass) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 font-medium">
        Partial
      </Badge>
    );
  }
  return (
    <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-0 font-medium">
      Not configured
    </Badge>
  );
}

// ── Tenant detail panel ────────────────────────────────────────────────────────

function TenantDetailPanel({
  companyId,
  onClose,
}: {
  companyId: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = usePPTenantDetail(companyId);
  const reAdopt = useReAdoptMasterPack();
  const { toast } = useToast();

  const handleReAdopt = (masterPackId: string, packLabel: string) => {
    reAdopt.mutate(
      { companyId, masterPackId },
      {
        onSuccess: () => {
          toast({
            title: "Pack re-adopted",
            description: `${packLabel} has been re-adopted with the latest master content.`,
          });
        },
        onError: (err) => {
          toast({
            title: "Re-adopt failed",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-1">
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-600 py-8 px-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error.message}
        </div>
      )}
      {data && (
        <div className="space-y-5">
          {/* Company overview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Company Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Work type</span>
                <span className="font-medium capitalize">
                  {data.company.workType?.replace("_", " + ") ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trades</span>
                <span className="font-medium capitalize">
                  {data.company.tradeTypes?.join(", ") ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Licenses</span>
                <span className="font-medium">
                  {Array.isArray(data.company.contractorLicenses) &&
                  data.company.contractorLicenses.length > 0
                    ? `${data.company.contractorLicenses.length} state(s)`
                    : "None entered"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Qualifications</span>
                <span className="font-medium">
                  {data.company.qualificationsText ? "✓ Set" : "Not set"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pricing statement</span>
                <span className="font-medium">
                  {data.company.pricingBasisStatement ? "✓ Set" : "Not set"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Logo</span>
                <span className="font-medium">
                  {data.company.logoUrl ? "✓ Uploaded" : "Not uploaded"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Founder contact */}
          {data.founder && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Founder Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">
                    {[data.founder.firstName, data.founder.lastName]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-right break-all">
                    {data.founder.email ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email verified</span>
                  <span className="font-medium">
                    {data.founder.emailVerifiedAt ? (
                      <span className="text-emerald-600">
                        {format(new Date(data.founder.emailVerifiedAt), "MMM d, yyyy")}
                      </span>
                    ) : (
                      <span className="text-amber-600">Not verified</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Registered</span>
                  <span className="font-medium">
                    {format(new Date(data.founder.createdAt), "MMM d, yyyy")}
                  </span>
                </div>
                {/* View-as link for read-only PP session inspection */}
                <div className="pt-2 border-t border-border">
                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/pp/me`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View /pp/me (read-only)
                  </a>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Jurisdiction packs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Jurisdiction Packs
              </CardTitle>
              <CardDescription>
                {data.jurisdictionPacks.length === 0
                  ? "No jurisdiction packs configured"
                  : `${data.jurisdictionPacks.length} pack(s)`}
              </CardDescription>
            </CardHeader>
            {data.jurisdictionPacks.length > 0 && (
              <CardContent>
                <div className="space-y-1">
                  {data.jurisdictionPacks.map((jp) => (
                    <div
                      key={jp.id}
                      className="flex items-center justify-between text-sm py-1 border-b border-border/40 last:border-0"
                    >
                      <span className="font-medium">{jp.jurisdiction}</span>
                      <span className="text-muted-foreground text-xs">{jp.state}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Master pack adoptions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                AHJ Code Packs
              </CardTitle>
              <CardDescription>
                {data.adoptions.length === 0 && data.allAhjPacks.length === 0
                  ? "No AHJ packs configured"
                  : `${data.allAhjPacks.length} pack(s) — ${data.adoptions.length} from master library`}
              </CardDescription>
            </CardHeader>
            {data.adoptions.length > 0 && (
              <CardContent>
                <div className="space-y-3">
                  {data.adoptions.map((adoption) => (
                    <div
                      key={adoption.id}
                      className="border border-border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {adoption.masterPack?.county
                              ? `${adoption.masterPack.county}, ${adoption.masterPack.state}`
                              : adoption.masterPack?.state ?? "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {adoption.masterPack?.packType?.replace("_", " ")} ·{" "}
                            {adoption.masterPack?.codeCycle ?? "No code cycle"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {adoption.isStale && (
                            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs">
                              Stale
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={reAdopt.isPending}
                            onClick={() =>
                              handleReAdopt(
                                adoption.masterPackId,
                                adoption.masterPack?.county
                                  ? `${adoption.masterPack.county}, ${adoption.masterPack.state}`
                                  : adoption.masterPack?.state ?? "Pack",
                              )
                            }
                          >
                            {reAdopt.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Re-adopt
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Adopted{" "}
                        {formatDistanceToNow(new Date(adoption.adoptedAt), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Recent inspections */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Recent Inspections
              </CardTitle>
              <CardDescription>Last 10 inspections</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentInspections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No inspections yet.</p>
              ) : (
                <div className="space-y-1">
                  {data.recentInspections.map((insp) => (
                    <div
                      key={insp.id}
                      className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {insp.insuredName ?? insp.address ?? insp.id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {insp.address ?? "No address"} ·{" "}
                          {formatDistanceToNow(new Date(insp.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {insp.hasCompiledReport && (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-[10px]">
                            Compiled
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground capitalize">
                          {insp.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PPTenantsPage() {
  const { data: tenants, isLoading, error } = usePPTenants();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTenant = tenants?.find((t) => t.id === selectedId) ?? null;

  return (
    <Shell>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">PP Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All Proof Package subscriber companies — readiness and configuration status.
          </p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-rose-200 dark:border-rose-800">
            <CardContent className="pt-6 flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">{error.message}</p>
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!isLoading && !error && tenants?.length === 0 && (
          <Card>
            <CardContent className="pt-10 pb-10 text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">No PP subscribers yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Companies that register via the PP checkout flow will appear here.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Tenant table */}
        {tenants && tenants.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead className="hidden sm:table-cell">Registered</TableHead>
                    <TableHead className="text-center">Readiness</TableHead>
                    <TableHead className="text-center hidden md:table-cell">Licenses</TableHead>
                    <TableHead className="text-center hidden md:table-cell">Quals</TableHead>
                    <TableHead className="text-center hidden lg:table-cell">Juri. Pack</TableHead>
                    <TableHead className="text-center hidden lg:table-cell">AHJ Pack</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Inspections</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Compiled</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow
                      key={tenant.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(tenant.id)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {tenant.workType?.replace("_", " + ") ?? "—"}
                            {tenant.tradeTypes && tenant.tradeTypes.length > 0
                              ? ` · ${tenant.tradeTypes.join(", ")}`
                              : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(tenant.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-center">
                        <ReadinessPill r={tenant.readiness} />
                      </TableCell>
                      <TableCell className="text-center hidden md:table-cell">
                        <div className="flex justify-center">
                          <ReadinessBadge pass={tenant.readiness.hasLicenses} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center hidden md:table-cell">
                        <div className="flex justify-center">
                          <ReadinessBadge pass={tenant.readiness.hasQualifications} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center hidden lg:table-cell">
                        <div className="flex justify-center">
                          <ReadinessBadge pass={tenant.readiness.hasJurisdictionPack} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center hidden lg:table-cell">
                        <div className="flex justify-center">
                          <ReadinessBadge pass={tenant.readiness.hasAhjPack} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-sm">
                        {tenant.inspectionCount}
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-sm">
                        {tenant.compiledPackageCount}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Summary stat cards */}
        {tenants && tenants.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Total tenants</p>
                <p className="text-2xl font-bold mt-0.5">{tenants.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Fully ready</p>
                <p className="text-2xl font-bold mt-0.5 text-emerald-600">
                  {
                    tenants.filter(
                      (t) =>
                        t.readiness.hasLicenses &&
                        t.readiness.hasQualifications &&
                        t.readiness.hasJurisdictionPack &&
                        t.readiness.hasAhjPack,
                    ).length
                  }
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Total inspections</p>
                <p className="text-2xl font-bold mt-0.5">
                  {tenants.reduce((s, t) => s + t.inspectionCount, 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Compiled packages</p>
                <p className="text-2xl font-bold mt-0.5">
                  {tenants.reduce((s, t) => s + t.compiledPackageCount, 0)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tenant detail side panel */}
        <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto" side="right">
            <SheetHeader className="mb-4">
              <SheetTitle>{selectedTenant?.name ?? "Tenant Detail"}</SheetTitle>
              <SheetDescription>
                {selectedTenant
                  ? `Company ID: ${selectedTenant.id} · ${selectedTenant.inspectionCount} inspection(s) · ${selectedTenant.compiledPackageCount} compiled`
                  : "Loading…"}
              </SheetDescription>
            </SheetHeader>
            {selectedId && (
              <TenantDetailPanel companyId={selectedId} onClose={() => setSelectedId(null)} />
            )}
          </SheetContent>
        </Sheet>
      </div>
    </Shell>
  );
}
