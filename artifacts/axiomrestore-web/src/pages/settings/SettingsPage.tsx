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
  Mail,
  Bell,
  CheckCircle2,
  AlertCircle,
  Send,
  XCircle,
  DollarSign,
  FileText,
  Sun,
  Moon,
  Monitor,
  Layers,
  MapPin,
  Zap,
  ChevronDown,
} from "lucide-react";
import { applyTheme, type ThemeValue } from "@/lib/applyTheme";
import { PriceBookPanel } from "@/pages/price-book/PriceBookList";
import { TemplatesPanel } from "@/pages/TemplatesPage";
import { SelectionsLibraryPanel } from "@/pages/settings/SelectionsLibraryPanel";
import { NotificationsTab } from "@/pages/settings/NotificationsTab";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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

interface CodeCitation {
  key: string;
  element: string;
  title: string;
  cite: string;
  body: string;
}

interface JurisdictionPack {
  id: string;
  jurisdiction: string;
  state: string;
  openingStatements: unknown[];
  uppaLaw: string | null;
  uppaStatement: string | null;
  generalCodeCitations: CodeCitation[];
  roofingCodeCitations: CodeCitation[];
  sidingCodeCitations: CodeCitation[];
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

type PersonalTabId = "my_profile" | "appearance" | "email_settings" | "notifications";
type CompanyTabId  = "company_profile" | "branding" | "preferences" | "price_book" | "templates" | "selections_library";
type TabId = PersonalTabId | CompanyTabId;

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const PERSONAL_TABS: Tab[] = [
  { id: "my_profile",     label: "Profile",        icon: User       },
  { id: "appearance",     label: "Appearance",     icon: SunMoon    },
  { id: "email_settings", label: "Email",          icon: Mail       },
  { id: "notifications",  label: "Notifications",  icon: Bell       },
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
    retail: 'Retail', insurance: 'Insurance', insurance_retail: 'Insurance / Retail',
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

      {/* Jurisdiction Packs */}
      <JurisdictionPacksSection companyId={companyId} />

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
// Jurisdiction Packs helpers
// ---------------------------------------------------------------------------

function blankCitation(): CodeCitation {
  return { key: "", element: "", title: "", cite: "", body: "" };
}

function toCitationKey(s: string): string {
  const k = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return k || `cit_${Math.random().toString(36).slice(2, 8)}`;
}

type CitSection = "general" | "roofing" | "siding";

function CitationsEditor({
  label,
  citations,
  onChange,
  onResearch,
  researching,
  packState,
}: {
  label: string;
  citations: CodeCitation[];
  onChange: (next: CodeCitation[]) => void;
  onResearch: () => void;
  researching: boolean;
  packState: string;
}) {
  return (
    <Collapsible defaultOpen={citations.length > 0}>
      <div className="rounded-md border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors rounded-t-md"
          >
            <span>{label}</span>
            <div className="flex items-center gap-2">
              {citations.length > 0 && (
                <span className="rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">
                  {citations.length}
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 pb-3 pt-2 space-y-3">
            {citations.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No citations yet. Add manually or use AI research.
              </p>
            )}
            {citations.map((cit, idx) => (
              <div
                key={idx}
                className="rounded-md border p-2.5 space-y-2 bg-muted/20"
              >
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      Title
                    </Label>
                    <Input
                      className="h-7 text-xs"
                      value={cit.title}
                      onChange={(e) =>
                        onChange(
                          citations.map((c, i) =>
                            i === idx ? { ...c, title: e.target.value } : c,
                          ),
                        )
                      }
                      placeholder="Drip Edge Requirement"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      Code Section
                    </Label>
                    <Input
                      className="h-7 text-xs"
                      value={cit.cite}
                      onChange={(e) =>
                        onChange(
                          citations.map((c, i) =>
                            i === idx ? { ...c, cite: e.target.value } : c,
                          ),
                        )
                      }
                      placeholder="2021 IRC R905.2.8.5"
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() =>
                      onChange(citations.filter((_, i) => i !== idx))
                    }
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    Provision Text
                  </Label>
                  <Textarea
                    className="text-xs min-h-[60px] resize-none"
                    value={cit.body}
                    onChange={(e) =>
                      onChange(
                        citations.map((c, i) =>
                          i === idx ? { ...c, body: e.target.value } : c,
                        ),
                      )
                    }
                    placeholder="Quoted code text and why it applies to storm claims…"
                  />
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                type="button"
                onClick={() => onChange([...citations, blankCitation()])}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                type="button"
                disabled={researching || !packState}
                onClick={onResearch}
                title={!packState ? "Enter the state code first" : undefined}
              >
                {researching ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Researching…
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3 mr-1" />
                    Research with AI
                  </>
                )}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function JurisdictionPacksSection({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [packState, setPackState] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [genCitations, setGenCitations] = useState<CodeCitation[]>([]);
  const [roofCitations, setRoofCitations] = useState<CodeCitation[]>([]);
  const [sidingCitations, setSidingCitations] = useState<CodeCitation[]>([]);
  const [researchingSection, setResearchingSection] =
    useState<CitSection | null>(null);

  const JUR_KEY = ["jurisdiction-packs", companyId];

  const { data: packsData } = useQuery<{ packs: JurisdictionPack[] }>({
    queryKey: JUR_KEY,
    queryFn: () =>
      customFetch(
        `/api/companies/${companyId}/jurisdiction-packs`,
      ) as Promise<{ packs: JurisdictionPack[] }>,
    enabled: !!companyId,
  });
  const packs = packsData?.packs ?? [];

  const upsertMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/companies/${companyId}/jurisdiction-packs/upsert`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JUR_KEY });
      toast({ title: "Jurisdiction pack saved" });
      setDialogOpen(false);
    },
    onError: (err) =>
      toast({
        title: "Save failed",
        description: String(err),
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(
        `/api/companies/${companyId}/jurisdiction-packs/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JUR_KEY });
      toast({ title: "Pack deleted" });
    },
    onError: (err) =>
      toast({
        title: "Delete failed",
        description: String(err),
        variant: "destructive",
      }),
  });

  function openAdd() {
    setEditingId(null);
    setPackState("");
    setJurisdiction("");
    setGenCitations([]);
    setRoofCitations([]);
    setSidingCitations([]);
    setDialogOpen(true);
  }

  function openEdit(pack: JurisdictionPack) {
    setEditingId(pack.id);
    setPackState(pack.state);
    setJurisdiction(pack.jurisdiction);
    setGenCitations(pack.generalCodeCitations ?? []);
    setRoofCitations(pack.roofingCodeCitations ?? []);
    setSidingCitations(pack.sidingCodeCitations ?? []);
    setDialogOpen(true);
  }

  function normalizeCitations(cits: CodeCitation[]): CodeCitation[] {
    return cits.map((c) => ({
      key: c.key || toCitationKey(c.title),
      element: c.element || c.title,
      title: c.title,
      cite: c.cite,
      body: c.body,
    }));
  }

  function handleSave() {
    const st = packState.trim().toUpperCase();
    const jur = jurisdiction.trim();
    if (!st || !/^[A-Z]{2}$/.test(st)) {
      toast({
        title: "Enter a valid 2-letter state code",
        variant: "destructive",
      });
      return;
    }
    if (!jur) {
      toast({ title: "Jurisdiction label is required", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({
      ...(editingId ? { id: editingId } : {}),
      state: st,
      jurisdiction: jur,
      openingStatements: [],
      uppaLaw: null,
      uppaStatement: null,
      generalCodeCitations: normalizeCitations(genCitations),
      roofingCodeCitations: normalizeCitations(roofCitations),
      sidingCodeCitations: normalizeCitations(sidingCitations),
    });
  }

  async function handleResearch(section: CitSection) {
    const st = packState.trim().toUpperCase();
    if (!st) {
      toast({ title: "Enter the state code first", variant: "destructive" });
      return;
    }
    const current =
      section === "general"
        ? genCitations
        : section === "roofing"
          ? roofCitations
          : sidingCitations;
    // Send keys from all three sections — the server enforces uniqueness
    // pack-wide (across general + roofing + siding), not just per-section.
    const existingKeys = [...genCitations, ...roofCitations, ...sidingCitations]
      .map((c) => c.key)
      .filter(Boolean);
    setResearchingSection(section);
    try {
      const result = (await customFetch(
        `/api/companies/${companyId}/jurisdiction-packs/${st}/code-research`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: section, existingKeys }),
        },
      )) as { suggestions: CodeCitation[] };
      const suggestions = result.suggestions ?? [];
      if (!suggestions.length) {
        toast({ title: "No suggestions returned" });
        return;
      }
      if (section === "general") {
        setGenCitations((prev) => [...prev, ...suggestions]);
      } else if (section === "roofing") {
        setRoofCitations((prev) => [...prev, ...suggestions]);
      } else {
        setSidingCitations((prev) => [...prev, ...suggestions]);
      }
      toast({
        title: `Added ${suggestions.length} suggestion(s)`,
        description: "Review each citation before saving.",
      });
    } catch (err) {
      toast({
        title: "Research failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setResearchingSection(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <CardTitle className="text-base">
                  Building Regulation Jurisdiction Packs
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Required for Proof Package compile. Add one pack per state
                  your company operates in — the state code must match the
                  2-letter abbreviation in the inspection address.
                </CardDescription>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={openAdd} className="shrink-0">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Pack
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {packs.length === 0 ? (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  No jurisdiction packs configured
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Proof Package compile will fail for every inspection until at
                  least one pack is added.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-md border divide-y divide-border/60">
              {packs.map((pack) => {
                const count =
                  (pack.generalCodeCitations?.length ?? 0) +
                  (pack.roofingCodeCitations?.length ?? 0) +
                  (pack.sidingCodeCitations?.length ?? 0);
                return (
                  <div key={pack.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="inline-flex items-center justify-center rounded font-mono text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 shrink-0 min-w-[40px] text-center">
                      {pack.state}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {pack.jurisdiction}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {count} code citation{count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => openEdit(pack)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(pack.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Jurisdiction Pack" : "Add Jurisdiction Pack"}
            </DialogTitle>
            <DialogDescription>
              State and label are required for compile to succeed. Code
              citations are included in the compiled report — use AI research
              to populate them, then review before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* State + Jurisdiction */}
            <div className="grid grid-cols-[80px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">State *</Label>
                <Input
                  value={packState}
                  onChange={(e) =>
                    setPackState(e.target.value.toUpperCase().slice(0, 2))
                  }
                  placeholder="VA"
                  maxLength={2}
                  className="uppercase font-mono text-center tracking-widest"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Jurisdiction Label *</Label>
                <Input
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="e.g. Virginia — USBC 2021 (IRC-based)"
                  maxLength={120}
                />
              </div>
            </div>

            <Separator />

            {/* Citation sections */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Code Citations{" "}
                <span className="font-normal">(optional — added to compiled report)</span>
              </p>
              <CitationsEditor
                label="General Code Citations"
                citations={genCitations}
                onChange={setGenCitations}
                onResearch={() => handleResearch("general")}
                researching={researchingSection === "general"}
                packState={packState}
              />
              <CitationsEditor
                label="Roofing Code Citations"
                citations={roofCitations}
                onChange={setRoofCitations}
                onResearch={() => handleResearch("roofing")}
                researching={researchingSection === "roofing"}
                packState={packState}
              />
              <CitationsEditor
                label="Siding Code Citations"
                citations={sidingCitations}
                onChange={setSidingCitations}
                onResearch={() => handleResearch("siding")}
                researching={researchingSection === "siding"}
                packState={packState}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Pack"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
            Leave blank to use the default AxiomRestore prompt.
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
            {activeTab === "email_settings" && <EmailSettingsTab />}
            {activeTab === "notifications"  && <NotificationsTab />}

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

