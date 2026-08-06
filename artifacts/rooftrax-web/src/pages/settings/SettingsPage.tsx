/**
 * Settings dashboard — Company Profile, Branding, and Platform Preferences.
 * Super admins see all three tabs. Managers/admins see Branding (logo only)
 * and Platform Preferences. Field reps are redirected to /dashboard.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/Shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { useGetMyProfile, useGetLeadSources, useUpdateLeadSources, DEFAULT_LEAD_SOURCES } from "@/lib/claimHubApi";
import {
  Building2,
  Palette,
  Sliders,
  Plus,
  Trash2,
  Loader2,
  Upload,
  ImageIcon,
  Bot,
  Bug,
  Lock,
  Megaphone,
  User,
  SunMoon,
  LayoutGrid,
  Mail,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FipsaSettings {
  contractorLegalName: string | null;
  contractorAddress: string | null;
  fipsaFeeCents: number | null;
}

interface ReportSettings {
  licenses: Array<{ state: string; number: string; classification: string }>;
  qualificationsText: string | null;
  pricingBasisStatement: string | null;
}

interface ReportBranding {
  headerColor: string;
  headerTextColor: string;
  accentColor: string;
}

interface AiSettings {
  systemPrompt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function centsToDisplayDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

function displayDollarsToCents(value: string): number | null {
  const parsed = parseFloat(value.replace(/[^0-9.]/g, ""));
  if (isNaN(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

type PersonalTabId = "my_profile" | "appearance" | "dashboard_tab" | "email_settings";
type CompanyTabId  = "company_profile" | "branding" | "preferences";
type TabId = PersonalTabId | CompanyTabId;

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const PERSONAL_TABS: Tab[] = [
  { id: "my_profile",     label: "Profile",     icon: User       },
  { id: "appearance",     label: "Appearance",  icon: SunMoon    },
  { id: "dashboard_tab",  label: "Dashboard",   icon: LayoutGrid },
  { id: "email_settings", label: "Email",       icon: Mail       },
];

const COMPANY_TABS: Tab[] = [
  { id: "company_profile", label: "Company Profile",     icon: Building2 },
  { id: "branding",        label: "Branding",             icon: Palette   },
  { id: "preferences",     label: "Platform Preferences", icon: Sliders   },
];

// ---------------------------------------------------------------------------
// Coming Soon stub — placeholder for Personal tabs not yet implemented (S2–S4)
// ---------------------------------------------------------------------------
function ComingSoonStub({ label }: { label: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>This section is coming soon.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This feature is under development and will be available in a future update.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Company Profile Tab
// ---------------------------------------------------------------------------

function CompanyProfileTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Company Name ─────────────────────────────────────────────────────────
  const { data: companyData, isLoading: loadingCompany } = useQuery<{
    company: { id: string; name: string };
  }>({
    queryKey: ["company", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}`),
  });

  const [companyName, setCompanyName] = useState("");
  useEffect(() => {
    if (companyData?.company?.name) setCompanyName(companyData.company.name);
  }, [companyData]);

  const nameMutation = useMutation({
    mutationFn: (name: string) =>
      customFetch(`/api/companies/${companyId}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      toast({ title: "Company name saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save company name", description: String(err), variant: "destructive" }),
  });

  // ── FIPSA / Legal Settings ────────────────────────────────────────────────
  const { data: fipsaData, isLoading: loadingFipsa } = useQuery<{
    settings: FipsaSettings;
  }>({
    queryKey: ["fipsa-settings", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}/fipsa-settings`),
  });

  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [feeDollars, setFeeDollars] = useState("");

  useEffect(() => {
    if (fipsaData?.settings) {
      const s = fipsaData.settings;
      setLegalName(s.contractorLegalName ?? "");
      setAddress(s.contractorAddress ?? "");
      setFeeDollars(centsToDisplayDollars(s.fipsaFeeCents));
    }
  }, [fipsaData]);

  const fipsaMutation = useMutation({
    mutationFn: (vars: FipsaSettings) =>
      customFetch(`/api/companies/${companyId}/fipsa-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            contractorLegalName: vars.contractorLegalName || null,
            contractorAddress: vars.contractorAddress || null,
            fipsaFeeCents: vars.fipsaFeeCents,
          },
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fipsa-settings", companyId] });
      toast({ title: "Legal & Agreement settings saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save settings", description: String(err), variant: "destructive" }),
  });

  // ── Report Settings (licenses, qualifications, pricing) ──────────────────
  const { data: reportData, isLoading: loadingReport } = useQuery<{
    settings: ReportSettings;
  }>({
    queryKey: ["report-settings", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}/report-settings`),
  });

  const [licenses, setLicenses] = useState<Array<{ state: string; number: string; classification: string }>>([]);
  const [qualifications, setQualifications] = useState("");
  const [pricingBasis, setPricingBasis] = useState("");

  useEffect(() => {
    if (reportData?.settings) {
      const s = reportData.settings;
      setLicenses(s.licenses ?? []);
      setQualifications(s.qualificationsText ?? "");
      setPricingBasis(s.pricingBasisStatement ?? "");
    }
  }, [reportData]);

  const reportMutation = useMutation({
    mutationFn: (vars: ReportSettings) =>
      customFetch(`/api/companies/${companyId}/report-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            licenses: vars.licenses,
            qualificationsText: vars.qualificationsText || null,
            pricingBasisStatement: vars.pricingBasisStatement || null,
          },
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-settings", companyId] });
      toast({ title: "Report settings saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save report settings", description: String(err), variant: "destructive" }),
  });

  const addLicense = () =>
    setLicenses((prev) => [...prev, { state: "", number: "", classification: "" }]);

  const removeLicense = (idx: number) =>
    setLicenses((prev) => prev.filter((_, i) => i !== idx));

  const updateLicense = (idx: number, field: "state" | "number" | "classification", value: string) =>
    setLicenses((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );

  // ── Lead Sources ────────────────────────────────────────────────────────────
  const { data: leadSourcesData, isLoading: loadingLeadSources } = useGetLeadSources(companyId);
  const updateLeadSourcesMutation = useUpdateLeadSources(companyId);
  const [localLeadSources, setLocalLeadSources] = useState<string[]>([]);
  const [newSourceInput, setNewSourceInput] = useState('');

  useEffect(() => {
    if (leadSourcesData?.leadSources) {
      setLocalLeadSources(leadSourcesData.leadSources);
    } else if (!loadingLeadSources) {
      setLocalLeadSources([...DEFAULT_LEAD_SOURCES]);
    }
  }, [leadSourcesData, loadingLeadSources]);

  if (loadingCompany || loadingFipsa || loadingReport) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Company Display Name */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company Name</CardTitle>
          <CardDescription>The name displayed throughout the platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Display Name</Label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Roofing Co."
              maxLength={200}
            />
          </div>
          <Button
            size="sm"
            disabled={nameMutation.isPending || !companyName.trim()}
            onClick={() => nameMutation.mutate(companyName.trim())}
          >
            {nameMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Legal & Agreement */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Legal & Agreement</CardTitle>
          <CardDescription>
            Printed on FIPSA agreements and related legal documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="legal-name">Contractor Legal Name</Label>
              <Input
                id="legal-name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="e.g. Acme Roofing LLC"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fee">Documentation Fee</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="fee"
                  value={feeDollars}
                  onChange={(e) => setFeeDollars(e.target.value)}
                  placeholder="750.00"
                  className="max-w-[120px]"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Contractor Address</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Springfield, IL 62704"
              maxLength={300}
            />
          </div>
          <Button
            size="sm"
            disabled={fipsaMutation.isPending}
            onClick={() =>
              fipsaMutation.mutate({
                contractorLegalName: legalName.trim() || null,
                contractorAddress: address.trim() || null,
                fipsaFeeCents: displayDollarsToCents(feeDollars),
              })
            }
          >
            {fipsaMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Contractor Licenses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contractor Licenses</CardTitle>
          <CardDescription>Printed in the Statement of Qualifications (Exhibit B).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {licenses.length === 0 && (
            <p className="text-sm text-muted-foreground">No licenses added yet.</p>
          )}
          {licenses.map((lic, idx) => (
            <div key={idx} className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">State</Label>
                <Input
                  value={lic.state}
                  onChange={(e) => updateLicense(idx, "state", e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="VA"
                  maxLength={2}
                  className="uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">License Number</Label>
                <Input
                  value={lic.number}
                  onChange={(e) => updateLicense(idx, "number", e.target.value)}
                  placeholder="2705-064938A"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Classification</Label>
                <Input
                  value={lic.classification}
                  onChange={(e) => updateLicense(idx, "classification", e.target.value)}
                  placeholder="VA Class A Contractor"
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => removeLicense(idx)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addLicense}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add License
            </Button>
            <Button
              size="sm"
              disabled={reportMutation.isPending}
              onClick={() =>
                reportMutation.mutate({
                  licenses,
                  qualificationsText: qualifications || null,
                  pricingBasisStatement: pricingBasis || null,
                })
              }
            >
              {reportMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Qualifications & Pricing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Qualifications & Pricing</CardTitle>
          <CardDescription>Narrative content printed in the Proof Package.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="qualifications">Qualifications Statement</Label>
            <Textarea
              id="qualifications"
              value={qualifications}
              onChange={(e) => setQualifications(e.target.value)}
              placeholder="Describe your company's qualifications and expertise…"
              className="min-h-[100px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pricing-basis">Pricing Basis Statement</Label>
            <Textarea
              id="pricing-basis"
              value={pricingBasis}
              onChange={(e) => setPricingBasis(e.target.value)}
              placeholder="Explain the basis for your pricing methodology…"
              className="min-h-[80px]"
            />
          </div>
          <Button
            size="sm"
            disabled={reportMutation.isPending}
            onClick={() =>
              reportMutation.mutate({
                licenses,
                qualificationsText: qualifications || null,
                pricingBasisStatement: pricingBasis || null,
              })
            }
          >
            {reportMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Lead Sources */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Lead Sources</CardTitle>
          </div>
          <CardDescription>
            Non-canvassing lead sources reps can select when entering a lead from the mobile app.
            "Canvassing" is always available — only add sources for inbound or third-party leads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingLeadSources ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />)}
            </div>
          ) : (
            <>
              {localLeadSources.length === 0 && (
                <p className="text-sm text-muted-foreground">No lead sources configured.</p>
              )}
              <div className="space-y-2">
                {localLeadSources.map((src, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={src}
                      onChange={(e) =>
                        setLocalLeadSources((prev) =>
                          prev.map((s, i) => (i === idx ? e.target.value : s))
                        )
                      }
                      className="h-8 text-sm flex-1"
                      maxLength={100}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive shrink-0"
                      onClick={() =>
                        setLocalLeadSources((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Add new source */}
              <div className="flex items-center gap-2 pt-1">
                <Input
                  value={newSourceInput}
                  onChange={(e) => setNewSourceInput(e.target.value)}
                  placeholder="New source name…"
                  className="h-8 text-sm flex-1"
                  maxLength={100}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSourceInput.trim()) {
                      setLocalLeadSources((prev) => [...prev, newSourceInput.trim()]);
                      setNewSourceInput('');
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newSourceInput.trim()}
                  onClick={() => {
                    if (newSourceInput.trim()) {
                      setLocalLeadSources((prev) => [...prev, newSourceInput.trim()]);
                      setNewSourceInput('');
                    }
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>

              <Button
                size="sm"
                disabled={updateLeadSourcesMutation.isPending}
                onClick={() => updateLeadSourcesMutation.mutate(localLeadSources, {
                  onSuccess: () => toast({ title: "Lead sources saved" }),
                  onError: (err) => toast({ title: "Failed to save", description: String(err), variant: "destructive" }),
                })}
              >
                {updateLeadSourcesMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                  : "Save Lead Sources"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branding Tab
// ---------------------------------------------------------------------------

const DEFAULT_BRANDING: ReportBranding = {
  headerColor: "#1e293b",
  headerTextColor: "#ffffff",
  accentColor: "#2563eb",
};

function BrandingTab({
  companyId,
  isSuperAdmin,
}: {
  companyId: string;
  isSuperAdmin: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // ── Logo ─────────────────────────────────────────────────────────────────
  const { data: profileData, isLoading: loadingProfile } = useGetMyProfile();
  const logoUrl = profileData?.profile?.companyLogoUrl;

  const handleLogoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast({ title: "Please select an image file", variant: "destructive" });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "Image must be under 5 MB", variant: "destructive" });
        return;
      }

      setUploadingLogo(true);
      try {
        const { uploadURL, objectPath } = await customFetch<{
          uploadURL: string;
          objectPath: string;
        }>("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType: file.type,
          }),
        });

        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);

        await customFetch(`/api/companies/${companyId}/logo`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logoUrl: objectPath }),
        });

        qc.invalidateQueries({ queryKey: ["my-profile"] });
        toast({ title: "Logo updated" });
      } catch (err) {
        toast({ title: "Logo upload failed", description: String(err), variant: "destructive" });
      } finally {
        setUploadingLogo(false);
      }
    },
    [companyId, qc, toast]
  );

  // ── Report Branding (super admin only) ───────────────────────────────────
  const { data: brandingData, isLoading: loadingBranding } = useQuery<{
    branding: ReportBranding | null;
  }>({
    queryKey: ["report-branding", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}/report-branding`),
    enabled: isSuperAdmin,
  });

  const [colors, setColors] = useState<ReportBranding>(DEFAULT_BRANDING);

  useEffect(() => {
    if (brandingData !== undefined) {
      setColors(brandingData.branding ?? DEFAULT_BRANDING);
    }
  }, [brandingData]);

  const brandingMutation = useMutation({
    mutationFn: (branding: ReportBranding | null) =>
      customFetch(`/api/companies/${companyId}/report-branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branding }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-branding", companyId] });
      toast({ title: "Color palette saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save palette", description: String(err), variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Logo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company Logo</CardTitle>
          <CardDescription>Displayed on FIPSA agreements and the Proof Package cover.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingProfile ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-lg border bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoUrl ? (
                  <img
                    src={`/api/storage/objects/${logoUrl}`}
                    alt="Company logo"
                    className="h-full w-full object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {logoUrl ? "Logo uploaded. Click below to replace it." : "No logo uploaded yet."}
                </p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Uploading…</>
                  ) : (
                    <><Upload className="h-3.5 w-3.5 mr-1.5" />{logoUrl ? "Replace Logo" : "Upload Logo"}</>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">PNG, JPG, or SVG · Max 5 MB</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Color Palette */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">Report Color Palette</CardTitle>
              <CardDescription className="mt-1">
                Colors used in generated forensic reports and Proof Packages.
              </CardDescription>
            </div>
            {!isSuperAdmin && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md">
                <Lock className="h-3 w-3" />
                Super admin only
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSuperAdmin ? (
            <p className="text-sm text-muted-foreground">
              Color palette changes require super admin access.
            </p>
          ) : loadingBranding ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    { field: "headerColor" as const, label: "Header Color" },
                    { field: "headerTextColor" as const, label: "Header Text Color" },
                    { field: "accentColor" as const, label: "Accent Color" },
                  ] as const
                ).map(({ field, label }) => (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={field} className="text-xs">{label}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id={field}
                        value={colors[field]}
                        onChange={(e) =>
                          setColors((prev) => ({ ...prev, [field]: e.target.value }))
                        }
                        className="h-8 w-8 rounded border cursor-pointer flex-shrink-0"
                      />
                      <Input
                        value={colors[field]}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                            setColors((prev) => ({ ...prev, [field]: val }));
                          }
                        }}
                        placeholder="#000000"
                        maxLength={7}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Live preview strip */}
              <div className="rounded-lg overflow-hidden border text-xs font-medium">
                <div
                  className="px-4 py-2.5 flex items-center justify-between"
                  style={{ backgroundColor: colors.headerColor, color: colors.headerTextColor }}
                >
                  <span>Header Preview</span>
                  <span style={{ color: colors.accentColor, backgroundColor: colors.headerTextColor, padding: "1px 8px", borderRadius: "4px" }}>
                    Accent
                  </span>
                </div>
                <div className="px-4 py-3 bg-white flex items-center gap-3">
                  <span className="text-gray-700">Report body text</span>
                  <span style={{ color: colors.accentColor }} className="font-semibold">
                    Accent link color
                  </span>
                  <span
                    style={{ backgroundColor: colors.accentColor, color: "#fff" }}
                    className="px-2 py-0.5 rounded text-white"
                  >
                    CTA button
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={brandingMutation.isPending}
                  onClick={() => brandingMutation.mutate(colors)}
                >
                  {brandingMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                  ) : (
                    "Save Palette"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={brandingMutation.isPending}
                  onClick={() => {
                    setColors(DEFAULT_BRANDING);
                    brandingMutation.mutate(null);
                  }}
                >
                  Reset to Default
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform Preferences Tab
// ---------------------------------------------------------------------------

function PlatformPreferencesTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── AI System Prompt ──────────────────────────────────────────────────────
  const { data: aiData, isLoading: loadingAi } = useQuery<{
    settings: AiSettings;
  }>({
    queryKey: ["ai-settings", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}/ai-settings`),
  });

  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    if (aiData?.settings) {
      setSystemPrompt(aiData.settings.systemPrompt ?? "");
    }
  }, [aiData]);

  const aiMutation = useMutation({
    mutationFn: (prompt: string) =>
      customFetch(`/api/companies/${companyId}/ai-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: prompt.trim() || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-settings", companyId] });
      toast({ title: "AI prompt saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save AI prompt", description: String(err), variant: "destructive" }),
  });

  // ── Beta Features ─────────────────────────────────────────────────────────
  const { data: profileData, isLoading: loadingProfile } = useGetMyProfile();
  const [betaBugReporting, setBetaBugReporting] = useState(true);

  useEffect(() => {
    if (profileData?.profile) {
      setBetaBugReporting(profileData.profile.betaBugReporting ?? true);
    }
  }, [profileData]);

  const prefsMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      customFetch(`/api/companies/${companyId}/platform-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betaBugReporting: enabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast({ title: "Beta preferences saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save preferences", description: String(err), variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* AI System Prompt */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">AI System Prompt</CardTitle>
          </div>
          <CardDescription>
            Custom instructions prepended to every AI summary request for this company.
            Leave blank to use the default RoofTrax prompt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingAi ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a storm-damage expert assisting a licensed roofing contractor…"
                className="min-h-[140px] font-mono text-sm"
                maxLength={4000}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {systemPrompt.length} / 4000 characters
                </span>
                <Button
                  size="sm"
                  disabled={aiMutation.isPending}
                  onClick={() => aiMutation.mutate(systemPrompt)}
                >
                  {aiMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                  ) : (
                    "Save Prompt"
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Beta Features */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Beta Features</CardTitle>
          </div>
          <CardDescription>
            Enable or disable early-access features for your company.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingProfile ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">In-app Bug Reporting</p>
                <p className="text-xs text-muted-foreground">
                  Shows a bug-report button throughout the app. Disable once out of beta.
                </p>
              </div>
              <Switch
                checked={betaBugReporting}
                disabled={prefsMutation.isPending}
                onCheckedChange={(checked) => {
                  setBetaBugReporting(checked);
                  prefsMutation.mutate(checked);
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { data: authEnvelope, isLoading: loadingAuth } = useGetCurrentAuthUser();
  const { data: profileData, isLoading: loadingProfile } = useGetMyProfile();

  const role = profileData?.profile?.role ?? "";
  const companyId = authEnvelope?.user?.companyId ?? "";
  const isSuperAdmin = role === "super_admin";
  const isManagerOrAbove =
    role === "manager" || role === "admin" || role === "super_admin";

  // Company tabs filtered by role — personal tabs are always shown to all users
  const visibleCompanyTabs = COMPANY_TABS.filter((t) => {
    if (t.id === "company_profile") return isSuperAdmin;
    return isManagerOrAbove;
  });

  const [activeTab, setActiveTab] = useState<TabId>("my_profile");

  if (loadingAuth || loadingProfile) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="max-w-4xl mx-auto">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your profile, preferences, and company configuration.
          </p>
        </div>

        <div className="flex gap-6">
          {/* Left sidebar nav */}
          <aside className="w-44 flex-shrink-0">
            <nav className="space-y-4 sticky top-0">

              {/* ── Personal group ──────────────────────────────────────── */}
              <div>
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
                  Personal
                </p>
                <div className="space-y-0.5">
                  {PERSONAL_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-left ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Company group (only when role grants ≥1 tab) ────────── */}
              {visibleCompanyTabs.length > 0 && (
                <div>
                  <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
                    Company
                  </p>
                  <div className="space-y-0.5">
                    {visibleCompanyTabs.map((tab) => {
                      const Icon = tab.icon;
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-left ${
                            active
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </nav>
          </aside>

          {/* Tab content */}
          <div className="flex-1 min-w-0">
            {/* Personal tabs — stubs until S2–S4 */}
            {activeTab === "my_profile"     && <ComingSoonStub label="Profile" />}
            {activeTab === "appearance"     && <ComingSoonStub label="Appearance" />}
            {activeTab === "dashboard_tab"  && <ComingSoonStub label="Dashboard" />}
            {activeTab === "email_settings" && <ComingSoonStub label="Email" />}

            {/* Company tabs — gates preserved exactly as before */}
            {activeTab === "company_profile" && isSuperAdmin && (
              <CompanyProfileTab companyId={companyId} />
            )}
            {activeTab === "branding" && isManagerOrAbove && (
              <BrandingTab companyId={companyId} isSuperAdmin={isSuperAdmin} />
            )}
            {activeTab === "preferences" && isManagerOrAbove && (
              <PlatformPreferencesTab companyId={companyId} />
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
