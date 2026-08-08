/**
 * Settings dashboard — Company Profile, Branding, and Platform Preferences.
 * Super admins see all three tabs. Managers/admins see Branding (logo only)
 * and Platform Preferences. Field reps are redirected to /dashboard.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Reorder } from "framer-motion";
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
import {
  customFetch,
  useGetCurrentAuthUser,
  useGetMyProfile,
  useUpdateProfileMe,
  getGetMyProfileQueryKey,
  useUpdateProfileSmtp,
  useTestProfileSmtp,
  useGetDashboardLayout,
  getGetDashboardManifestQueryKey,
  getGetDashboardLayoutQueryKey,
  usePatchDashboardLayout,
  useDeleteDashboardLayout,
  // Generated query-key functions — NEVER hand-write a key for a generated hook.
  // If a get*QueryKey() exists for an endpoint, use it in both useQuery and
  // invalidateQueries so cross-component cache consistency is guaranteed.
  getGetCompanyQueryKey,
  getGetCompanyFipsaSettingsQueryKey,
  getGetCompanyReportSettingsQueryKey,
  getGetCompanyReportBrandingQueryKey,
} from "@workspace/api-client-react";
import { useGetLeadSources, useUpdateLeadSources, DEFAULT_LEAD_SOURCES } from "@/lib/claimHubApi";
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
  CheckCircle2,
  AlertCircle,
  Send,
  XCircle,
  DollarSign,
  FileText,
  Eye,
  EyeOff,
  GripVertical,
  Sun,
  Moon,
  Monitor,
  Layers,
} from "lucide-react";
import { applyTheme, type ThemeValue } from "@/lib/applyTheme";
import { PriceBookPanel } from "@/pages/price-book/PriceBookList";
import { TemplatesPanel } from "@/pages/TemplatesPage";
import { SelectionsLibraryPanel } from "@/pages/settings/SelectionsLibraryPanel";

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
type CompanyTabId  = "company_profile" | "branding" | "preferences" | "price_book" | "templates" | "selections_library";
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
  { id: "company_profile",    label: "Company Profile",     icon: Building2  },
  { id: "branding",           label: "Branding",             icon: Palette    },
  { id: "preferences",        label: "Platform Preferences", icon: Sliders    },
  { id: "price_book",         label: "Price Book",           icon: DollarSign },
  { id: "templates",          label: "Templates",            icon: FileText   },
  { id: "selections_library", label: "Selections Library",   icon: Layers     },
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
// Personal Profile Tab — Wave 2B
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: profileData } = useGetMyProfile();
  const profile = profileData?.profile;
  const mutation = useUpdateProfileMe();

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Initialise form fields once profile data loads
  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName ?? '');
    setLastName(profile.lastName   ?? '');
    setPhone(profile.phone         ?? '');
  }, [profile]);

  const handleSave = () => {
    mutation.mutate(
      { data: { firstName: firstName || null, lastName: lastName || null, phone: phone || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
          toast({ title: 'Profile saved' });
        },
        onError: () => toast({ title: 'Failed to save profile', variant: 'destructive' }),
      },
    );
  };

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Please select an image file', variant: 'destructive' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: 'Image must be under 5 MB', variant: 'destructive' });
        return;
      }
      setUploadingAvatar(true);
      try {
        const { uploadURL, objectPath } = await customFetch<{
          uploadURL: string;
          objectPath: string;
        }>('/api/storage/uploads/request-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        });
        const putRes = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);
        const avatarUrl = `/api/storage/objects${objectPath.replace(/^\/objects/, '')}`;
        await mutation.mutateAsync({ data: { profileImageUrl: avatarUrl } });
        qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
        toast({ title: 'Avatar updated' });
      } catch (err) {
        toast({ title: 'Avatar upload failed', description: String(err), variant: 'destructive' });
      } finally {
        setUploadingAvatar(false);
      }
    },
    [mutation, qc, toast],
  );

  const ROLE_LABELS: Record<string, string> = {
    field_rep: 'Field Rep', manager: 'Manager',
    admin: 'Admin', super_admin: 'Super Admin',
  };
  const WORKFLOW_LABELS: Record<string, string> = {
    retail: 'Retail', insurance_retail: 'Insurance / Retail',
  };
  const DEPT_LABELS: Record<string, string> = {
    canvasser: 'Canvasser', inspector_canvasser: 'Inspector / Canvasser',
  };

  return (
    <div className="space-y-6">
      {/* ── Name, phone, avatar ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Personal profile</CardTitle>
          <CardDescription>Your display name, avatar, and contact phone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-sm overflow-hidden flex-none bg-muted flex items-center justify-center">
              {profile?.profileImageUrl ? (
                <img src={profile.profileImageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-black uppercase text-muted-foreground">
                  {profile?.firstName?.charAt(0) || '?'}
                </span>
              )}
            </div>
            <div>
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded hover:bg-muted transition-colors">
                  {uploadingAvatar
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    : <><Upload className="h-3.5 w-3.5" /> Change avatar</>}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploadingAvatar}
                  onChange={handleAvatarUpload}
                />
              </label>
              <p className="text-[10px] text-muted-foreground mt-1.5">JPG, PNG, GIF · max 5 MB</p>
            </div>
          </div>

          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="prof-first">First name</Label>
              <Input
                id="prof-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prof-last">Last name</Label>
              <Input
                id="prof-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
          </div>

          {/* Email — read-only */}
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={profile?.email ?? ''} disabled />
            <p className="text-[10px] text-muted-foreground">
              Email is your login identity and cannot be changed here.
            </p>
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="prof-phone">Phone</Label>
            <Input
              id="prof-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
            />
          </div>

          <Button onClick={handleSave} disabled={mutation.isPending} size="sm">
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Save changes
          </Button>
        </CardContent>
      </Card>

      {/* ── Your access ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Your access</CardTitle>
          <CardDescription>Role and workflow — set by your manager.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm max-w-sm">
            <dt className="text-muted-foreground">Role</dt>
            <dd className="font-medium">{ROLE_LABELS[profile?.role ?? ''] ?? profile?.role ?? '—'}</dd>
            <dt className="text-muted-foreground">Department</dt>
            <dd className="font-medium">{DEPT_LABELS[profile?.department ?? ''] ?? profile?.department ?? '—'}</dd>
            <dt className="text-muted-foreground">Workflow</dt>
            <dd className="font-medium">{WORKFLOW_LABELS[profile?.workflowAssignment ?? ''] ?? profile?.workflowAssignment ?? '—'}</dd>
          </dl>
        </CardContent>
      </Card>

      {/* ── Signature on file ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Signature on file</CardTitle>
          <CardDescription>
            Your signature is captured in the mobile app and printed on inspection declarations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profile?.signatureSignedAt ? (
            <p className="text-sm">
              Captured on{' '}
              <span className="font-medium">
                {new Date(profile.signatureSignedAt).toLocaleDateString()}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No signature on file. Capture one in the mobile app.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
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
    queryKey: getGetCompanyQueryKey(companyId),
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
      qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(companyId) });
      toast({ title: "Company name saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save company name", description: String(err), variant: "destructive" }),
  });

  // ── FIPSA / Legal Settings ────────────────────────────────────────────────
  const { data: fipsaData, isLoading: loadingFipsa } = useQuery<{
    settings: FipsaSettings;
  }>({
    queryKey: getGetCompanyFipsaSettingsQueryKey(companyId),
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
      qc.invalidateQueries({ queryKey: getGetCompanyFipsaSettingsQueryKey(companyId) });
      toast({ title: "Legal & Agreement settings saved" });
    },
    onError: (err) =>
      toast({ title: "Failed to save settings", description: String(err), variant: "destructive" }),
  });

  // ── Report Settings (licenses, qualifications, pricing) ──────────────────
  const { data: reportData, isLoading: loadingReport } = useQuery<{
    settings: ReportSettings;
  }>({
    queryKey: getGetCompanyReportSettingsQueryKey(companyId),
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
      qc.invalidateQueries({ queryKey: getGetCompanyReportSettingsQueryKey(companyId) });
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

        qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
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
    queryKey: getGetCompanyReportBrandingQueryKey(companyId),
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
      qc.invalidateQueries({ queryKey: getGetCompanyReportBrandingQueryKey(companyId) });
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
      qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
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

interface SmtpFormState {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
}
export default function SettingsPage() {
  const { data: authEnvelope, isLoading: loadingAuth } = useGetCurrentAuthUser();
  const { data: profileData, isLoading: loadingProfile } = useGetMyProfile();

  const role = profileData?.profile?.role ?? "";
  const companyId = authEnvelope?.user?.companyId ?? "";
  const isSuperAdmin = role === "super_admin";
  const isManagerOrAbove =
    role === "manager" || role === "admin" || role === "super_admin";

  const isAdminOrAbove = role === "admin" || role === "super_admin";

  // Every Company tab is admin+. No per-tab exceptions.
  const visibleCompanyTabs = COMPANY_TABS.filter(() => isAdminOrAbove);

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
            {activeTab === "my_profile"     && <ProfileTab />}
            {activeTab === "appearance"     && <AppearanceTab />}
            {activeTab === "dashboard_tab"  && <DashboardSettingsTab />}
            {activeTab === "email_settings" && <EmailSettingsTab />}

            {/* Company tabs — all gated at admin+, matching the sidebar filter */}
            {activeTab === "company_profile" && isAdminOrAbove && (
              <CompanyProfileTab companyId={companyId} />
            )}
            {activeTab === "branding" && isAdminOrAbove && (
              <BrandingTab companyId={companyId} isSuperAdmin={isSuperAdmin} />
            )}
            {activeTab === "preferences" && isAdminOrAbove && (
              <PlatformPreferencesTab companyId={companyId} />
            )}
            {activeTab === "price_book" && isAdminOrAbove && <PriceBookPanel />}
            {activeTab === "templates" && isAdminOrAbove && <TemplatesPanel />}
            {activeTab === "selections_library" && isAdminOrAbove && <SelectionsLibraryPanel />}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Appearance Tab — Wave 2B (A1)
// ---------------------------------------------------------------------------

interface ThemeOption {
  value: ThemeValue;
  label: string;
  description: string;
  Icon: React.ElementType;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'White canvas, dark text.',
    Icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Near-black canvas, light text.',
    Icon: Moon,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follows your OS preference.',
    Icon: Monitor,
  },
];

function AppearanceTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: profileData, isLoading } = useGetMyProfile();
  const profile = profileData?.profile;
  const mutation = useUpdateProfileMe();

  // Derive current theme: prefer what's stored in localStorage so the UI
  // reflects the live-applied value, falling back to the server value.
  const [current, setCurrent] = useState<ThemeValue>(() => {
    const stored = localStorage.getItem('rt_theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'dark';
  });

  // Sync from server profile once loaded (profile wins over bootstrap guess).
  useEffect(() => {
    if (!profile) return;
    const serverTheme = profile.theme as ThemeValue | undefined;
    if (serverTheme === 'light' || serverTheme === 'dark' || serverTheme === 'system') {
      setCurrent(serverTheme);
      applyTheme(serverTheme);
    }
  }, [profile]);

  const handleSelect = (value: ThemeValue) => {
    if (value === current) return;
    setCurrent(value);
    applyTheme(value);
    mutation.mutate(
      { data: { theme: value } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
          toast({ title: 'Appearance saved' });
        },
        onError: () => toast({ title: 'Failed to save appearance', variant: 'destructive' }),
      },
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how the app looks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose how the app looks. Your preference is saved to your profile and applies across all sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {THEME_OPTIONS.map(({ value, label, description, Icon }) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => handleSelect(value)}
              disabled={mutation.isPending}
              className={`w-full flex items-center gap-4 rounded border p-4 text-left transition-colors
                ${selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card text-foreground hover:bg-accent hover:border-accent-foreground/20'
                }
                disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm
                ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-sm">{label}</span>
                <span className="block text-xs text-muted-foreground">{description}</span>
              </span>
              {selected && (
                <span className="flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </span>
              )}
              {mutation.isPending && selected && (
                <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
              )}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

interface SmtpFormErrors {
  host?: string;
  port?: string;
  username?: string;
}

function EmailSettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: profileData, isLoading } = useGetMyProfile();
  const profile = profileData?.profile;

  const [form, setForm] = useState<SmtpFormState>(EMPTY_SMTP);
  const [errors, setErrors] = useState<SmtpFormErrors>({});

  // Seed form from profile on load (never pre-fill password)
  useEffect(() => {
    if (profile) {
      setForm({
        host: profile.smtpHost ?? "",
        port: profile.smtpPort != null ? String(profile.smtpPort) : "",
        secure: profile.smtpSecure ?? false,
        username: profile.smtpUsername ?? "",
        password: "",
        fromEmail: profile.smtpFromEmail ?? "",
      });
    }
  }, [profile]);

  const updateMutation = useUpdateProfileSmtp({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
        // Refresh password field (write-only, never shown)
        setForm((prev) => ({ ...prev, password: "" }));
        toast({ title: "SMTP configuration saved" });
      },
      onError: (err) =>
        toast({ title: "Failed to save SMTP config", description: String(err), variant: "destructive" }),
    },
  });

  const testMutation = useTestProfileSmtp({
    mutation: {
      onSuccess: (data) => {
        const result = data as { sent: boolean };
        if (result.sent) {
          toast({ title: "Test email sent successfully" });
        } else {
          toast({ title: "Test email was not delivered", variant: "destructive" });
        }
      },
      onError: (err) =>
        toast({ title: "Test email failed", description: String(err), variant: "destructive" }),
    },
  });

  function validate(): boolean {
    const errs: SmtpFormErrors = {};
    if (!form.host.trim()) errs.host = "Server host is required";
    const portNum = parseInt(form.port, 10);
    if (!form.port.trim() || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errs.port = "Port must be a number between 1 and 65535";
    }
    if (!form.username.trim()) errs.username = "Username is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handlePortChange(value: string) {
    const portNum = parseInt(value, 10);
    setForm((prev) => ({
      ...prev,
      port: value,
      secure: portNum === 465 ? true : prev.secure,
    }));
  }

  function handleSave() {
    if (!validate()) return;
    const payload: Record<string, unknown> = {
      host: form.host.trim(),
      port: parseInt(form.port, 10),
      secure: form.secure,
      username: form.username.trim(),
    };
    if (form.fromEmail.trim()) payload.fromEmail = form.fromEmail.trim();
    if (form.password) payload.password = form.password;
    updateMutation.mutate({ data: payload as Parameters<typeof updateMutation.mutate>[0]["data"] });
  }

  function handleClear() {
    updateMutation.mutate(
      { data: { clear: true } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
          setForm(EMPTY_SMTP);
          setErrors({});
          toast({ title: "SMTP configuration cleared" });
        },
      }
    );
  }

  const smtpConfigured = profile?.smtpConfigured ?? false;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Outgoing Mail (SMTP)</CardTitle>
              <CardDescription>
                Configure your personal outgoing mail server to send reports and documents by email.
              </CardDescription>
            </div>
            {smtpConfigured ? (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configured
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                <AlertCircle className="h-3.5 w-3.5" />
                Not configured
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Server + Port */}
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">Outgoing Server</Label>
              <Input
                id="smtp-host"
                value={form.host}
                onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))}
                placeholder="smtp.example.com"
                aria-invalid={!!errors.host}
              />
              {errors.host && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3 w-3" />{errors.host}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                value={form.port}
                onChange={(e) => handlePortChange(e.target.value)}
                placeholder="587"
                inputMode="numeric"
                aria-invalid={!!errors.port}
              />
              {errors.port && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3 w-3" />{errors.port}
                </p>
              )}
            </div>
          </div>

          {/* Secure toggle */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Switch
              id="smtp-secure"
              checked={form.secure}
              onCheckedChange={(v) => setForm((p) => ({ ...p, secure: v }))}
            />
            <div>
              <Label htmlFor="smtp-secure" className="text-sm font-medium cursor-pointer">
                Secure connection (TLS/SSL)
              </Label>
              <p className="text-xs text-muted-foreground">
                Enable for port 465. Use STARTTLS for ports 587/25.
              </p>
            </div>
          </div>

          {/* Username + Password */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-username">Username</Label>
              <Input
                id="smtp-username"
                value={form.username}
                onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                placeholder="you@example.com"
                autoComplete="username"
                aria-invalid={!!errors.username}
              />
              {errors.username && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3 w-3" />{errors.username}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-password">Password</Label>
              <Input
                id="smtp-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                placeholder={smtpConfigured ? "••••••••" : "Enter password"}
                autoComplete="current-password"
              />
              {smtpConfigured && !form.password && (
                <p className="text-xs text-muted-foreground">Leave blank to keep the existing password.</p>
              )}
            </div>
          </div>

          {/* From Email (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="smtp-from">
              From Email <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="smtp-from"
              value={form.fromEmail}
              onChange={(e) => setForm((p) => ({ ...p, fromEmail: e.target.value }))}
              placeholder="Your Name <you@example.com>"
              type="email"
            />
          </div>

          <Separator />

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
              ) : (
                "Save Configuration"
              )}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={!smtpConfigured || testMutation.isPending}
              title={!smtpConfigured ? "Save a configuration first" : undefined}
            >
              {testMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending…</>
              ) : (
                <><Send className="h-3.5 w-3.5 mr-1.5" />Send test email</>
              )}
            </Button>

            {smtpConfigured && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive ml-auto"
                onClick={handleClear}
                disabled={updateMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear configuration
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const EMPTY_SMTP: SmtpFormState = {
  host: "",
  port: "",
  secure: false,
  username: "",
  password: "",
  fromEmail: "",
};

// ---------------------------------------------------------------------------
// Dashboard Settings Tab — D1: widget visibility & order
// ---------------------------------------------------------------------------

interface WidgetRow {
  key: string;
  title: string;
  visible: boolean;
}

function DashboardSettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Source from GET /dashboard/layout, which returns ALL granted widgets
  // (visible + hidden) so users can toggle individual widgets back on
  // without a full "Restore defaults" reset.
  const { data: layoutData, isLoading, isError } = useGetDashboardLayout();

  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (!layoutData || initialised) return;
    setRows(
      layoutData.widgets.map((w) => ({ key: w.key, title: w.title, visible: !w.hidden }))
    );
    setInitialised(true);
  }, [layoutData, initialised]);

  const patchMutation = usePatchDashboardLayout();
  const deleteMutation = useDeleteDashboardLayout();

  const toggleVisibility = (idx: number) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, visible: !r.visible } : r));
    setRows(next);
    setDirty(true);
  };

  const handleSave = () => {
    const order = rows.map((r) => r.key);
    const hidden = rows.filter((r) => !r.visible).map((r) => r.key);
    patchMutation.mutate(
      { data: { order, hidden } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetDashboardManifestQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardLayoutQueryKey() });
          setDirty(false);
          toast({ title: "Dashboard layout saved" });
        },
        onError: () =>
          toast({ title: "Failed to save layout", variant: "destructive" }),
      }
    );
  };

  const handleRestoreDefaults = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetDashboardManifestQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardLayoutQueryKey() });
        setInitialised(false); // re-initialise from refreshed layout
        setDirty(false);
        toast({ title: "Dashboard layout reset to defaults" });
      },
      onError: () =>
        toast({ title: "Failed to reset layout", variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (isError || !layoutData) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        Could not load dashboard widgets. Please refresh.
      </div>
    );
  }

  const saving = patchMutation.isPending;
  const resetting = deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Widget Visibility &amp; Order</CardTitle>
          <CardDescription>
            Choose which widgets appear on your dashboard and arrange them with the
            up/down buttons. Changes take effect after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No widgets are available for your account.
            </p>
          ) : (
            <Reorder.Group
              axis="y"
              values={rows}
              onReorder={(next) => { setRows(next); setDirty(true); }}
              className="space-y-2"
            >
              {rows.map((row, idx) => (
                <Reorder.Item
                  key={row.key}
                  value={row}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 transition-opacity cursor-default select-none ${
                    row.visible ? "bg-background" : "opacity-50 bg-muted/40"
                  }`}
                >
                  {/* Drag handle */}
                  <span
                    className="text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
                    aria-label={`Drag to reorder ${row.title}`}
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>

                  {/* Visibility toggle */}
                  <button
                    type="button"
                    onClick={() => toggleVisibility(idx)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={row.visible ? `Hide ${row.title}` : `Show ${row.title}`}
                  >
                    {row.visible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </button>

                  {/* Widget name */}
                  <span className="flex-1 text-sm font-medium">{row.title}</span>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRestoreDefaults}
          disabled={resetting || saving}
          className="text-muted-foreground"
        >
          {resetting ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Resetting…</>
          ) : (
            "Restore defaults"
          )}
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving || resetting}
        >
          {saving ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
          ) : (
            "Save layout"
          )}
        </Button>
      </div>
    </div>
  );
}
