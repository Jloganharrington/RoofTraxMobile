/**
 * Lead Profile — full detail view for a single lead (pin or inspection).
 *
 * Tab order:
 *   Insurance leads with inspection → Dashboard · Inspection Flow · Insurance · Financials · Communication · Selections & Scope · Files
 *   Insurance leads (no inspection) → Dashboard · Insurance · Financials · Communication · Selections & Scope · Files
 *   Retail leads                    → Dashboard · Financials · Communication · Selections & Scope · Files
 *
 * The sticky header exposes a pipeline-stage dropdown (with auto-save) and,
 * for insurance leads, a profile sub-status dropdown.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { Shell } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  MapPin,
  User,
  DollarSign,
  Shield,
  MessageSquare,
  Clipboard,
  FolderOpen,
  Save,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Upload,
  Download,
  Pencil,
  Trash2,
  File,
  ImageIcon,
  Plus,
  TrendingUp,
  TrendingDown,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import {
  useGetLead,
  useUpdateLead,
  useRecheckAhj,
  useGetSamplePackageInfo,
  useGetLeadFiles,
  useRegisterLeadFile,
  useRenameLeadFile,
  useDeleteLeadFile,
  useGetLeadSources,
  LEAD_FILE_CATEGORIES,
  type FullLead,
  type LeadFileCategory,
  type LeadFileRow,
} from '@/lib/claimHubApi';
import { useQueryClient } from '@tanstack/react-query';
import {
  customFetch,
  useGetMyProfile,
  useGetPayments,
  useCreatePayment,
  useDeletePayment,
  useListCustomerInvoices,
  useCreateCustomerInvoice,
  useDeleteCustomerInvoice,
  useSendCustomerInvoice,
  useMarkCustomerInvoicePaid,
  useVoidCustomerInvoice,
  useListVendorExpenses,
  useCreateVendorExpense,
  useUpdateVendorExpense,
  useDeleteVendorExpense,
  useMarkVendorExpensePaid,
  useUpdateCommissions,
  useMarkSalesCommissionPaid,
  useMarkCanvassingCommissionPaid,
  useMarkPmCommissionPaid,
  type CreateVendorExpenseInput,
  type UpdateVendorExpenseInput,
  useGetPinProfitability,
  useGetPinInsurance,
  usePatchPinInsurance,
  getGetPinInsuranceQueryKey,
  getGetPinProfitabilityQueryKey,
  type InsurancePatchBody,
} from '@workspace/api-client-react';
import { InspectionFlowWizard } from '@/components/inspection/InspectionFlowWizard';
import {
  INSURANCE_STAGES,
  RETAIL_STAGES,
  STAGE_PROFILE_STATUSES,
  STAGE_DEFAULT_PROFILE_STATUS,
  getStageLabel,
} from '@/lib/pipelineStages';
import {
  useListPinChangeOrders,
  useApproveChangeOrder,
  type ChangeOrder as ChangeOrderRecord,
} from '@/lib/changeOrdersApi';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------


type TabId = 'dashboard' | 'inspection_flow' | 'contract_builder' | 'financials' | 'communication' | 'scope' | 'files';

function buildTabs(isInsurance: boolean, hasInspection: boolean) {
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Lead Dashboard', icon: <User className="h-4 w-4" /> },
  ];
  if (hasInspection) {
    tabs.push({ id: 'inspection_flow', label: 'Proof Package Builder', icon: <FileText className="h-4 w-4" /> });
  }
  if (isInsurance) {
    tabs.push({ id: 'contract_builder', label: 'Contract Builder', icon: <Shield className="h-4 w-4" /> });
  }
  tabs.push(
    { id: 'financials',    label: 'Financials',         icon: <DollarSign className="h-4 w-4" /> },
    { id: 'communication', label: 'Communication',      icon: <MessageSquare className="h-4 w-4" /> },
    { id: 'scope',         label: 'Selections & Scope', icon: <Clipboard className="h-4 w-4" /> },
    { id: 'files',         label: 'Files',              icon: <FolderOpen className="h-4 w-4" /> },
  );
  return tabs;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, val: string) => void;
  type?: string;
  placeholder?: string;
  span2?: boolean;
}

function Field({ label, name, value, onChange, type = 'text', placeholder, span2 }: FieldProps) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(name, e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  );
}

function formatPhoneDisplay(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 3)})${d.slice(3)}`;
  return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6)}`;
}

function PhoneField({ label, name, value, onChange, span2 }: Omit<FieldProps, 'type' | 'placeholder'>) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Input
        type="tel"
        value={value}
        onChange={e => onChange(name, formatPhoneDisplay(e.target.value))}
        placeholder="(555)555-5555"
        className="h-9 text-sm"
      />
    </div>
  );
}

interface TextareaFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, val: string) => void;
  rows?: number;
  placeholder?: string;
}

function TextareaField({ label, name, value, onChange, rows = 4, placeholder }: TextareaFieldProps) {
  return (
    <div className="sm:col-span-2">
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Textarea
        value={value}
        onChange={e => onChange(name, e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="text-sm resize-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  externalLeadSource: string;
  projectManagerName: string;
  ownerFirstName: string; ownerLastName: string; ownerEmail: string;
  hasSecondOwner: boolean;
  owner2FirstName: string; owner2LastName: string;
  customerPhone: string;
  notes: string; statusNotes: string; pipelineStage: string; profileStatus: string;
  // Property
  nonOwnerOccupied: boolean;
  mailingAddress: string; mailingCity: string; mailingState: string; mailingZip: string;
  // Extended insurance
  mailerSentDate: string; claimFiledDate: string;
  policyHolder: string; coverageType: string;
  approvedRcvAmount: string; approvedAcvAmount: string; depreciationAmount: string;
  inspectionNotes: string;
  // Insurance
  insuranceCarrier: string; policyNumber: string; claimNumber: string;
  dateOfLoss: string; inspectionDate: string;
  adjusterName: string; adjusterPhone: string; adjusterEmail: string; adjusterMeetingDate: string;
  // Financials — deposit/acv/supplement/final removed: managed by payments ledger
  contractAmount: string; deductibleAmount: string; rcvAmount: string;
  communicationNotes: string;
  contractScope: string; squareFootage: string; roofPitch: string;
  measurementVendor: string; measurementReportUrl: string;
  materialBrand: string; materialColor: string; materialStyle: string;
}

function toStr(v: string | null | undefined): string {
  return v ?? '';
}

// Timestamps come back as ISO strings from the API; extract just the date part for <input type="date">
function toDateStr(v: string | null | undefined): string {
  if (!v) return '';
  return v.slice(0, 10); // "2026-07-15T00:00:00.000Z" → "2026-07-15"
}

function initForm(lead: FullLead): FormState {
  return {
    externalLeadSource:   toStr(lead.externalLeadSource),
    projectManagerName:   toStr(lead.projectManagerName),
    ownerFirstName:       toStr(lead.ownerFirstName),
    ownerLastName:        toStr(lead.ownerLastName),
    ownerEmail:           toStr(lead.ownerEmail),
    hasSecondOwner:       !!(lead.owner2FirstName || lead.owner2LastName),
    owner2FirstName:      toStr(lead.owner2FirstName),
    owner2LastName:       toStr(lead.owner2LastName),
    customerPhone:        formatPhoneDisplay(toStr(lead.customerPhone)),
    notes:                toStr(lead.notes),
    statusNotes:          toStr(lead.statusNotes),
    pipelineStage:        toStr(lead.pipelineStage),
    profileStatus:        toStr(lead.profileStatus),
    // Property
    nonOwnerOccupied:     lead.nonOwnerOccupied ?? false,
    mailingAddress:       toStr(lead.mailingAddress),
    mailingCity:          toStr(lead.mailingCity),
    mailingState:         toStr(lead.mailingState),
    mailingZip:           toStr(lead.mailingZip),
    // Extended insurance
    mailerSentDate:       toDateStr(lead.mailerSentDate),
    claimFiledDate:       toDateStr(lead.claimFiledDate),
    policyHolder:         toStr(lead.policyHolder),
    coverageType:         toStr(lead.coverageType),
    approvedRcvAmount:    toStr(lead.approvedRcvAmount),
    approvedAcvAmount:    toStr(lead.approvedAcvAmount),
    depreciationAmount:   toStr(lead.depreciationAmount),
    inspectionNotes:      toStr(lead.inspectionNotes),
    // Insurance
    insuranceCarrier:     toStr(lead.insuranceCarrier),
    policyNumber:         toStr(lead.policyNumber),
    claimNumber:          toStr(lead.claimNumber),
    dateOfLoss:           toDateStr(lead.dateOfLoss),
    inspectionDate:       toDateStr(lead.inspectionDate),
    adjusterName:         toStr(lead.adjusterName),
    adjusterPhone:        toStr(lead.adjusterPhone),
    adjusterEmail:        toStr(lead.adjusterEmail),
    adjusterMeetingDate:  toDateStr(lead.adjusterMeetingDate),
    contractAmount:       toStr(lead.contractAmount),
    deductibleAmount:     toStr(lead.deductibleAmount),
    rcvAmount:            toStr(lead.rcvAmount),
    communicationNotes:   toStr(lead.notes),
    contractScope:        toStr(lead.contractScope),
    squareFootage:        toStr(lead.squareFootage),
    roofPitch:            toStr(lead.roofPitch),
    measurementVendor:    toStr(lead.measurementVendor),
    measurementReportUrl: toStr(lead.measurementReportUrl),
    materialBrand:        toStr(lead.materialBrand),
    materialColor:        toStr(lead.materialColor),
    materialStyle:        toStr(lead.materialStyle),
  };
}

const TAB_FIELDS: Record<TabId, (keyof FormState)[]> = {
  dashboard:       [
    'externalLeadSource','projectManagerName',
    'ownerFirstName','ownerLastName','ownerEmail','owner2FirstName','owner2LastName',
    'hasSecondOwner','customerPhone',
    'nonOwnerOccupied','mailingAddress','mailingCity','mailingState','mailingZip',
    'mailerSentDate','claimFiledDate','policyHolder','coverageType',
    'approvedRcvAmount','approvedAcvAmount','depreciationAmount','inspectionNotes',
    'insuranceCarrier','policyNumber','claimNumber','dateOfLoss','inspectionDate',
    'adjusterName','adjusterPhone','adjusterEmail','adjusterMeetingDate',
    'deductibleAmount','statusNotes','notes',
  ],
  inspection_flow: [],
  contract_builder: [],
  financials:      ['contractAmount','deductibleAmount','rcvAmount'],
  communication:   ['communicationNotes'],
  scope:           ['contractScope','squareFootage','roofPitch','measurementVendor','measurementReportUrl','materialBrand','materialColor','materialStyle'],
  files:           [],
};

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function InspectionFlowTab({ inspectionId }: { inspectionId: string }) {
  return <InspectionFlowWizard inspectionId={inspectionId} />;
}

// ===========================================================================
// INSURANCE DETAIL TILES — Policy · Claim Details · Adjuster
// Self-contained; owns its own data fetch and save.
// Rendered in DashboardTab (insurance leads only).
// These three panels were moved here from InsuranceTab.
// ===========================================================================
function InsuranceDetailTiles({ pinId, isManager }: { pinId: string; isManager: boolean }) {
  const { toast } = useToast();
  const qc       = useQueryClient();
  const ro       = !isManager;
  const { data: insData, isLoading } = useGetPinInsurance(pinId);
  const ins = insData?.insurance;

  const [f, setF] = useState({
    insuranceCarrier: '', policyNumber: '', policyHolder: '', coverageType: '', deductibleAmount: '',
    claimNumber: '', dateOfLoss: '', claimFiledDate: '', inspectionDate: '', claimStatus: '',
    adjusterName: '', adjusterPhone: '', adjusterEmail: '', adjusterMeetingDate: '', adjusterLastContact: '',
  });
  const [inited, setInited] = useState(false);

  const inp = (key: keyof typeof f) => ({
    value: f[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [key]: e.target.value })),
    disabled: ro,
    className: 'h-8 text-sm',
  });

  useEffect(() => {
    if (ins && !inited) {
      setF({
        insuranceCarrier:    ins.insuranceCarrier    ?? '',
        policyNumber:        ins.policyNumber        ?? '',
        policyHolder:        ins.policyHolder        ?? '',
        coverageType:        ins.coverageType        ?? '',
        deductibleAmount:    ins.deductibleAmount    ?? '',
        claimNumber:         ins.claimNumber         ?? '',
        dateOfLoss:          toDateStr(ins.dateOfLoss),
        claimFiledDate:      toDateStr(ins.claimFiledDate),
        inspectionDate:      toDateStr(ins.inspectionDate),
        claimStatus:         ins.claimStatus         ?? '',
        adjusterName:        ins.adjusterName        ?? '',
        adjusterPhone:       ins.adjusterPhone       ?? '',
        adjusterEmail:       ins.adjusterEmail       ?? '',
        adjusterMeetingDate: toDateStr(ins.adjusterMeetingDate),
        adjusterLastContact: toDateStr(ins.adjusterLastContact),
      });
      setInited(true);
    }
  }, [ins, inited]);

  const { mutateAsync: saveIns, isPending: saving } = usePatchPinInsurance({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPinInsuranceQueryKey(pinId) });
        toast({ title: 'Insurance data saved.' });
      },
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    },
  });

  async function handleSave() {
    await saveIns({
      pinId,
      data: {
        insuranceCarrier:    f.insuranceCarrier    || null,
        policyNumber:        f.policyNumber        || null,
        policyHolder:        f.policyHolder        || null,
        coverageType:        f.coverageType        || null,
        deductibleAmount:    f.deductibleAmount    || null,
        claimNumber:         f.claimNumber         || null,
        dateOfLoss:          f.dateOfLoss          || null,
        claimFiledDate:      f.claimFiledDate       || null,
        inspectionDate:      f.inspectionDate      || null,
        claimStatus:         (f.claimStatus as InsurancePatchBody['claimStatus']) ?? null,
        adjusterName:        f.adjusterName        || null,
        adjusterPhone:       f.adjusterPhone       || null,
        adjusterEmail:       f.adjusterEmail       || null,
        adjusterMeetingDate: f.adjusterMeetingDate || null,
        adjusterLastContact: f.adjusterLastContact || null,
      },
    });
  }

  if (isLoading) return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-lg" />)}
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* ── Policy ──────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 p-4 border-b">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Policy</h3>
          </div>
          <div className="p-4 space-y-2">
            <div><Label className="text-xs text-muted-foreground">Carrier</Label>
              <Input placeholder="State Farm, Allstate…" {...inp('insuranceCarrier')} /></div>
            <div><Label className="text-xs text-muted-foreground">Policy No.</Label>
              <Input {...inp('policyNumber')} /></div>
            <div><Label className="text-xs text-muted-foreground">Policy Holder</Label>
              <Input {...inp('policyHolder')} /></div>
            <div><Label className="text-xs text-muted-foreground">Coverage Type</Label>
              <Input placeholder="HO-3, HO-5…" {...inp('coverageType')} /></div>
            <div><Label className="text-xs text-muted-foreground">Deductible Amount</Label>
              <Input placeholder="$1,000" {...inp('deductibleAmount')} /></div>
          </div>
        </div>

        {/* ── Claim Details ────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 p-4 border-b">
            <Clipboard className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Claim Details</h3>
          </div>
          <div className="p-4 space-y-2">
            <div><Label className="text-xs text-muted-foreground">Claim No.</Label>
              <Input {...inp('claimNumber')} /></div>
            <div><Label className="text-xs text-muted-foreground">Date of Loss</Label>
              <Input type="date" {...inp('dateOfLoss')} /></div>
            <div><Label className="text-xs text-muted-foreground">Claim Filed Date</Label>
              <Input type="date" {...inp('claimFiledDate')} /></div>
            <div><Label className="text-xs text-muted-foreground">Inspection Date</Label>
              <Input type="date" {...inp('inspectionDate')} /></div>
            <div>
              <Label className="text-xs text-muted-foreground">Claim Status</Label>
              {ro ? (
                <div className="h-8 flex items-center">
                  {f.claimStatus
                    ? <Badge className={`text-xs ${CLAIM_STATUS_BADGE[f.claimStatus] ?? 'bg-muted text-foreground border'}`}>
                        {CLAIM_STATUS_OPTIONS.find(o => o.value === f.claimStatus)?.label ?? f.claimStatus}
                      </Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </div>
              ) : (
                <Select value={f.claimStatus} onValueChange={v => setF(p => ({ ...p, claimStatus: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select status…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— Not set —</SelectItem>
                    {CLAIM_STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>

        {/* ── Adjuster ────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 p-4 border-b">
            <User className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Adjuster</h3>
          </div>
          <div className="p-4 space-y-2">
            <div><Label className="text-xs text-muted-foreground">Name</Label>
              <Input {...inp('adjusterName')} /></div>
            <div><Label className="text-xs text-muted-foreground">Phone</Label>
              <Input type="tel" {...inp('adjusterPhone')} /></div>
            <div><Label className="text-xs text-muted-foreground">Email</Label>
              <Input type="email" {...inp('adjusterEmail')} /></div>
            <div><Label className="text-xs text-muted-foreground">Meeting Date</Label>
              <Input type="date" {...inp('adjusterMeetingDate')} /></div>
            <div><Label className="text-xs text-muted-foreground">Last Contact</Label>
              <Input type="date" {...inp('adjusterLastContact')} /></div>
          </div>
        </div>

      </div>

      {isManager && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Saving…</>
              : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Insurance</>}
          </Button>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// DASHBOARD TAB — property overview + contacts + insurance identity tiles
// ===========================================================================
function DashboardTab({
  form, onField, onCheck, isInsurance, lead, isManager, pinId,
}: {
  form: FormState;
  onField: (n: string, v: string) => void;
  onCheck: (n: string, v: boolean) => void;
  isInsurance: boolean;
  lead: FullLead;
  isManager: boolean;
  pinId: string;
}) {
  const workflowLabel = lead.workflow === 'insurance' ? 'Insurance' : 'Retail';
  const workflowColors = lead.workflow === 'insurance'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';

  const { data: sourcesData } = useGetLeadSources(lead.companyId);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Lead Source: start in edit mode when no value is saved yet, else show plain text
  const [leadSrcEditing, setLeadSrcEditing] = useState(!form.externalLeadSource);

  return (
    <div className="space-y-4">

      {/* ── Row 1: Property & Owner (left) · File Handlers (right) ───────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Property & Owner tile */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Property & Owner</h3>
            </div>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${workflowColors}`}>
              {workflowLabel}
            </span>
          </div>
          <div className="p-4 space-y-4">

            {/* Photo thumbnail → modal */}
            {lead.photoUrl ? (
              <button
                onClick={() => setPhotoOpen(true)}
                className="w-full rounded-lg overflow-hidden border aspect-video bg-muted relative group focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <img src={lead.photoUrl} alt="Front of home" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded">
                    View photo
                  </span>
                </div>
              </button>
            ) : (
              <div className="rounded-lg border bg-muted/30 aspect-video flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <MapPin className="h-6 w-6 opacity-20" />
                <p className="text-xs">No photo</p>
              </div>
            )}

            {/* Address */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Address</p>
              <p className="text-sm text-foreground/80 leading-snug break-words">
                {lead.address ?? <span className="italic text-muted-foreground">No address</span>}
              </p>
            </div>

            {/* AHJ */}
            {lead.ahjCheck?.jurisdiction && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">AHJ</p>
                <p className="text-sm text-foreground/80">{lead.ahjCheck.jurisdiction}</p>
              </div>
            )}

            {/* Non-owner occupied */}
            <div className="flex items-center gap-2 border-t pt-3">
              <input
                type="checkbox"
                id="nonOwnerOccupied"
                checked={form.nonOwnerOccupied}
                onChange={e => onCheck('nonOwnerOccupied', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
              />
              <Label htmlFor="nonOwnerOccupied" className="text-sm font-normal cursor-pointer">
                Non-owner occupied property
              </Label>
            </div>

            {/* ── Owner contact fields ─────────────────────────────────── */}
            <div className="border-t pt-3 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Owner</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="First Name" name="ownerFirstName" value={form.ownerFirstName} onChange={onField} />
                <Field label="Last Name"  name="ownerLastName"  value={form.ownerLastName}  onChange={onField} />
                <Field label="Email"      name="ownerEmail"     value={form.ownerEmail}     onChange={onField} type="email" span2 />
                <PhoneField label="Phone" name="customerPhone" value={form.customerPhone} onChange={onField} span2 />
                <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="hasSecondOwner"
                    checked={form.hasSecondOwner}
                    onChange={e => onCheck('hasSecondOwner', e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                  />
                  <Label htmlFor="hasSecondOwner" className="text-sm font-normal cursor-pointer">
                    Second owner
                  </Label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* File Tracking tile */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 p-4 border-b">
            <Clipboard className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">File Tracking</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* Lead Source */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Lead Source</p>
              {isManager && leadSrcEditing ? (
                <>
                  <select
                    value={form.externalLeadSource}
                    onChange={e => onField('externalLeadSource', e.target.value)}
                    className="w-full text-sm border border-input rounded px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Canvassing</option>
                    {(sourcesData?.leadSources ?? ["Angi's", 'Yelp', 'Call-In', 'Website']).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Button size="sm" className="h-7 text-xs mt-2 px-3"
                    onClick={() => setLeadSrcEditing(false)}>
                    Save
                  </Button>
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{form.externalLeadSource || 'Canvassing'}</p>
                    {!form.externalLeadSource && lead.repName && (
                      <p className="text-xs text-muted-foreground mt-0.5">by {lead.repName}</p>
                    )}
                  </div>
                  {isManager && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 shrink-0"
                      onClick={() => setLeadSrcEditing(true)}>
                      Edit
                    </Button>
                  )}
                </div>
              )}
            </div>
            {/* Sales Rep */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Sales Rep</p>
              <p className="text-sm font-medium">
                {lead.repName ?? <span className="italic opacity-40">—</span>}
              </p>
            </div>
            {/* Project Manager */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Project Manager</p>
              {isManager ? (
                <input
                  type="text"
                  value={form.projectManagerName}
                  onChange={e => onField('projectManagerName', e.target.value)}
                  placeholder="Assign PM…"
                  className="w-full text-sm border border-input rounded px-2 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium">
                  {form.projectManagerName || <span className="italic opacity-40">—</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 2: Second Owner OR Retail (when applicable) ───────────────── */}
      {(form.hasSecondOwner || lead.retailData) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {form.hasSecondOwner ? (
            <div className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 p-4 border-b">
                <User className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Second Owner</h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="First Name" name="owner2FirstName" value={form.owner2FirstName} onChange={onField} />
                  <Field label="Last Name"  name="owner2LastName"  value={form.owner2LastName}  onChange={onField} />
                </div>
              </div>
            </div>
          ) : lead.retailData ? (
            <div className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 p-4 border-b">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Damage Interests</h3>
              </div>
              <div className="p-4 space-y-4">
                {lead.retailData.appointmentDate && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Appointment</p>
                    <p className="text-sm font-semibold">
                      {new Date(lead.retailData.appointmentDate).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Interests</p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { key: 'interestedRoof'    as const, label: 'Roof' },
                        { key: 'interestedSiding'  as const, label: 'Siding' },
                        { key: 'interestedWindows' as const, label: 'Windows' },
                        { key: 'interestedDoors'   as const, label: 'Doors' },
                      ]
                    ).filter(({ key }) => lead.retailData?.[key]).map(({ label }) => (
                      <span key={label} className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                        {label}
                      </span>
                    ))}
                    {!lead.retailData.interestedRoof && !lead.retailData.interestedSiding &&
                     !lead.retailData.interestedWindows && !lead.retailData.interestedDoors && (
                      <span className="text-xs text-muted-foreground italic">None recorded</span>
                    )}
                  </div>
                </div>
                {lead.retailData.notes && (
                  <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">
                    {lead.retailData.notes}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Photo modal */}
      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="px-2 pt-2 pb-1">
            <DialogTitle className="text-sm">Front of Home</DialogTitle>
          </DialogHeader>
          {lead.photoUrl && (
            <img src={lead.photoUrl} alt="Front of home" className="w-full rounded-lg object-contain max-h-[75vh]" />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Mailing Address tile (non-owner occupied only) ───────────────── */}
      {form.nonOwnerOccupied && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 p-4 border-b">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Mailing Address</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Street"  name="mailingAddress" value={form.mailingAddress} onChange={onField} span2 placeholder="123 Main St" />
              <Field label="City"    name="mailingCity"    value={form.mailingCity}    onChange={onField} placeholder="Dallas" />
              <Field label="State"   name="mailingState"   value={form.mailingState}   onChange={onField} placeholder="TX" />
              <Field label="ZIP"     name="mailingZip"     value={form.mailingZip}     onChange={onField} placeholder="75201" />
            </div>
          </div>
        </div>
      )}

      {/* ── Insurance tiles: Policy · Claim Details · Adjuster ──────────── */}
      {isInsurance && (
        <InsuranceDetailTiles pinId={pinId} isManager={isManager} />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Claim status — mirrors CLAIM_STATUSES in artifacts/api-server/src/routes/insurance.ts
// ---------------------------------------------------------------------------
const CLAIM_STATUS_OPTIONS = [
  { value: 'not_filed',          label: 'Not Filed' },
  { value: 'filed',              label: 'Filed' },
  { value: 'under_review',       label: 'Under Review' },
  { value: 'adjuster_scheduled', label: 'Adjuster Scheduled' },
  { value: 'approved',           label: 'Approved' },
  { value: 'partially_approved', label: 'Partially Approved' },
  { value: 'denied',             label: 'Denied' },
  { value: 'supplement_pending', label: 'Supplement Pending' },
  { value: 'closed',             label: 'Closed' },
];
const CLAIM_STATUS_BADGE: Record<string, string> = {
  approved:           'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300',
  partially_approved: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300',
  denied:             'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300',
  filed:              'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300',
  under_review:       'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300',
  adjuster_scheduled: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300',
  supplement_pending: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300',
  closed:             'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400',
};

// ---------------------------------------------------------------------------
// ContractBuilderTab — placeholder; content coming soon
// ---------------------------------------------------------------------------
function ContractBuilderTab() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
      <Shield className="h-10 w-10 opacity-20" />
      <p className="text-sm font-medium">Contract Builder</p>
      <p className="text-xs max-w-xs">This tab is ready for new content.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments ledger helpers
// ---------------------------------------------------------------------------

function parseDollarToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}

const PAYMENT_TYPE_OPTIONS = [
  { value: 'deposit',      label: 'Deposit' },
  { value: 'acv',          label: 'ACV' },
  { value: 'betterment',   label: 'Betterment' },
  { value: 'supplement',   label: 'Supplement' },
  { value: 'final',        label: 'Final Payment' },
  { value: 'rcv_holdback', label: 'RCV Holdback' },
  { value: 'deductible',   label: 'Deductible' },
  { value: 'other',        label: 'Other' },
] as const;

// ---------------------------------------------------------------------------
// Invoices panel (Step 2)
// ---------------------------------------------------------------------------

const INVOICE_TYPE_LABELS: Record<string, string> = {
  initial_deposit: 'Initial Deposit',
  acv_payment:     'ACV Payment',
  supplement:      'Supplement',
  final_payment:   'Final Payment',
  service:         'Service',
  other:           'Other',
};

const INVOICE_TYPE_OPTIONS = Object.entries(INVOICE_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const INVOICE_STATUS_CLASSES: Record<string, string> = {
  open:  'bg-blue-50  text-blue-700  border-blue-200',
  sent:  'bg-amber-50 text-amber-700 border-amber-200',
  paid:  'bg-green-50 text-green-700 border-green-200',
  void:  'bg-gray-50  text-gray-500  border-gray-200',
};

// ===========================================================================
// INVOICING PANEL — payments + invoices combined, left column (steps 1 + 2)
// ===========================================================================

function InvoicingPanel({ pinId, isManager, lead }: { pinId: string; isManager: boolean; lead: FullLead }) {
  const { toast } = useToast();

  // ── Profitability + insurance for amount pre-fills ─────────────────────────
  const { data: profData } = useGetPinProfitability(pinId);
  const { data: insData }  = useGetPinInsurance(pinId);
  const p   = profData?.profitability;
  const ins = insData?.insurance;

  // ── Payments ──────────────────────────────────────────────────────────────
  const { data: paymentsData, isLoading: paymentsLoading } = useGetPayments(pinId);
  const createPaymentMutation = useCreatePayment();
  const deletePaymentMutation = useDeletePayment();
  const payments = paymentsData?.payments ?? [];

  const [showAddPayment, setShowAddPayment] = useState(false);
  const [addType,    setAddType]    = useState<string>('deposit');
  const [addDollars, setAddDollars] = useState('');
  const [addDate,    setAddDate]    = useState('');
  const [addMethod,  setAddMethod]  = useState('');
  const [addNotes,   setAddNotes]   = useState('');
  const [addPayErr,  setAddPayErr]  = useState<string | null>(null);

  async function handleAddPayment() {
    const cents = parseDollarToCents(addDollars);
    if (!cents)  { setAddPayErr('Enter a valid amount greater than $0.00'); return; }
    if (!addDate){ setAddPayErr('Payment date is required'); return; }
    setAddPayErr(null);
    try {
      await createPaymentMutation.mutateAsync({
        pinId,
        data: {
          type: addType as 'deposit',
          amountCents: cents,
          paymentDate: new Date(addDate + 'T12:00:00').toISOString(),
          method: addMethod || null,
          notes: addNotes || null,
        },
      });
      setShowAddPayment(false);
      setAddDollars(''); setAddDate(''); setAddMethod(''); setAddNotes('');
      toast({ title: 'Payment recorded' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save payment.', variant: 'destructive' });
    }
  }

  async function handleDeletePayment(paymentId: string) {
    try {
      await deletePaymentMutation.mutateAsync({ paymentId });
      toast({ title: 'Payment deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete payment.', variant: 'destructive' });
    }
  }

  // ── Invoices ──────────────────────────────────────────────────────────────
  const { data: invData, isLoading: invLoading } = useListCustomerInvoices(pinId);
  const createInvMutation   = useCreateCustomerInvoice();
  const deleteInvMutation   = useDeleteCustomerInvoice();
  const sendInvMutation     = useSendCustomerInvoice();
  const markInvPaidMutation = useMarkCustomerInvoicePaid();
  const voidInvMutation     = useVoidCustomerInvoice();
  const invoices = invData?.invoices ?? [];

  // ── Invoice modal state ───────────────────────────────────────────────────
  const [invModalOpen, setInvModalOpen] = useState(false);
  const [invName,      setInvName]      = useState('');
  const [invAddress,   setInvAddress]   = useState('');

  // Standard line item selections
  const [selFipsa,      setSelFipsa]      = useState(false);
  const [fipsaAmt,      setFipsaAmt]      = useState('');
  const [selAcv,        setSelAcv]        = useState(false);
  const [acvAmt,        setAcvAmt]        = useState('');
  const [selDeductible, setSelDeductible] = useState(false);
  const [deductibleAmt, setDeductibleAmt] = useState('');
  const [selBetterment, setSelBetterment] = useState(false);
  const [bettermentAmt, setBettermentAmt] = useState('');

  // Exclusive options with free-form line items
  const [selEmergency,   setSelEmergency]   = useState(false);
  const [selChangeOrder, setSelChangeOrder] = useState(false);
  const [emergencyLines, setEmergencyLines] = useState<{ desc: string; amount: string }[]>([{ desc: '', amount: '' }]);
  const [coLines,        setCoLines]        = useState<{ desc: string; amount: string }[]>([{ desc: '', amount: '' }]);

  const [invModalErr, setInvModalErr] = useState<string | null>(null);

  // Derived totals
  const isExclusive = selEmergency || selChangeOrder;
  const toC = (v: string) => parseDollarToCents(v) ?? 0;
  const grossCents =
    (selAcv         ? toC(acvAmt)        : 0) +
    (selDeductible  ? toC(deductibleAmt) : 0) +
    (selBetterment  ? toC(bettermentAmt) : 0) +
    (selEmergency   ? emergencyLines.reduce((s, l) => s + toC(l.amount), 0) : 0) +
    (selChangeOrder ? coLines.reduce((s, l)        => s + toC(l.amount), 0) : 0);
  const fipsaCents = selFipsa ? toC(fipsaAmt) : 0;
  const netCents   = Math.max(0, grossCents - fipsaCents);

  function openInvModal() {
    const fullName = [lead.ownerFirstName, lead.ownerLastName].filter(Boolean).join(' ') || lead.customerName || '';
    setInvName(fullName);
    setInvAddress(lead.address ?? '');
    setAcvAmt(p?.approvedAcvCents           ? (p.approvedAcvCents / 100).toFixed(2)           : '');
    setDeductibleAmt(p?.policyDeductibleCents ? (p.policyDeductibleCents / 100).toFixed(2)    : '');
    setBettermentAmt(ins?.bettermentsAmountCents ? (ins.bettermentsAmountCents / 100).toFixed(2) : '');
    setSelFipsa(false); setFipsaAmt('');
    setSelAcv(false); setSelDeductible(false); setSelBetterment(false);
    setSelEmergency(false); setSelChangeOrder(false);
    setEmergencyLines([{ desc: '', amount: '' }]);
    setCoLines([{ desc: '', amount: '' }]);
    setInvModalErr(null);
    setInvModalOpen(true);
  }

  function toggleEmergency(checked: boolean) {
    setSelEmergency(checked);
    if (checked) { setSelChangeOrder(false); setSelFipsa(false); setSelAcv(false); setSelDeductible(false); setSelBetterment(false); }
  }

  function toggleChangeOrder(checked: boolean) {
    setSelChangeOrder(checked);
    if (checked) { setSelEmergency(false); setSelFipsa(false); setSelAcv(false); setSelDeductible(false); setSelBetterment(false); }
  }

  async function handleCreateInvoice() {
    if (!invName.trim())    { setInvModalErr('Customer name is required');    return; }
    if (!invAddress.trim()) { setInvModalErr('Customer address is required'); return; }
    const noneSelected = !selFipsa && !selAcv && !selDeductible && !selBetterment && !selEmergency && !selChangeOrder;
    if (noneSelected)       { setInvModalErr('Select at least one line item'); return; }
    if (netCents <= 0)      { setInvModalErr('Invoice total must be greater than $0.00'); return; }

    const noteLines: string[] = [];
    if (selAcv)        noteLines.push(`ACV Payment: ${formatCents(toC(acvAmt))}`);
    if (selDeductible) noteLines.push(`Deductible: ${formatCents(toC(deductibleAmt))}`);
    if (selBetterment) noteLines.push(`Betterment: ${formatCents(toC(bettermentAmt))}`);
    if (selEmergency) {
      noteLines.push('Emergency Services:');
      emergencyLines.filter(l => l.desc || l.amount).forEach(l =>
        noteLines.push(`  ${l.desc || '(no description)'}: ${formatCents(toC(l.amount))}`));
    }
    if (selChangeOrder) {
      noteLines.push('Change Order:');
      coLines.filter(l => l.desc || l.amount).forEach(l =>
        noteLines.push(`  ${l.desc || '(no description)'}: ${formatCents(toC(l.amount))}`));
    }
    if (selFipsa) noteLines.push(`FIPSA Credit (paid): -${formatCents(fipsaCents)}`);

    let invoiceType = 'other';
    if (selEmergency) invoiceType = 'service';
    else if (selAcv && !selDeductible && !selBetterment && !selFipsa) invoiceType = 'acv_payment';

    setInvModalErr(null);
    try {
      await createInvMutation.mutateAsync({
        pinId,
        data: {
          customerName:    invName.trim(),
          customerAddress: invAddress.trim(),
          invoiceType:     invoiceType as 'acv_payment',
          amountCents:     netCents,
          notes:           noteLines.join('\n') || null,
        },
      });
      setInvModalOpen(false);
      toast({ title: 'Invoice created' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create invoice.', variant: 'destructive' });
    }
  }

  const invPending = createInvMutation.isPending || deleteInvMutation.isPending ||
    sendInvMutation.isPending || markInvPaidMutation.isPending || voidInvMutation.isPending;

  const hasActivity = payments.length > 0 || invoices.length > 0;
  const isLoading   = paymentsLoading || invLoading;

  // ── Line item row helper ──────────────────────────────────────────────────
  function LineItems({
    lines,
    setLines,
  }: {
    lines: { desc: string; amount: string }[];
    setLines: React.Dispatch<React.SetStateAction<{ desc: string; amount: string }[]>>;
  }) {
    return (
      <div className="mt-2 space-y-2 pl-7">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              className="h-7 text-xs flex-1 min-w-0"
              placeholder="Description…"
              value={line.desc}
              onChange={e => setLines(prev => prev.map((l, j) => j === i ? { ...l, desc: e.target.value } : l))}
            />
            <Input
              className="h-7 text-xs w-28 shrink-0"
              placeholder="$0.00"
              value={line.amount}
              onChange={e => setLines(prev => prev.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
            />
            {lines.length > 1 && (
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
          onClick={() => setLines(prev => [...prev, { desc: '', amount: '' }])}>
          <Plus className="h-3 w-3 mr-1" />Add line
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm">Invoicing</h3>
            <p className="text-xs text-muted-foreground">Revenue from customer payments</p>
          </div>
        </div>
        {isManager && (
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={openInvModal}>
              <FileText className="h-3 w-3 mr-1" />Create Invoice
            </Button>
            <Button size="sm" className="h-7 text-xs px-2"
              onClick={() => setShowAddPayment(v => !v)}>
              <Plus className="h-3 w-3 mr-1" />Add Payment
            </Button>
          </div>
        )}
      </div>

      {/* Add-payment inline form */}
      {showAddPayment && isManager && (
        <div className="border-b p-4 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <select className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                value={addType} onChange={e => setAddType(e.target.value)}>
                {PAYMENT_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input className="h-7 text-xs" placeholder="$0.00"
                value={addDollars} onChange={e => setAddDollars(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-7 text-xs"
                value={addDate} onChange={e => setAddDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Method (optional)</Label>
              <Input className="h-7 text-xs" placeholder="Check, ACH…"
                value={addMethod} onChange={e => setAddMethod(e.target.value)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Notes (optional)</Label>
              <Input className="h-7 text-xs" placeholder="Reference #…"
                value={addNotes} onChange={e => setAddNotes(e.target.value)} />
            </div>
          </div>
          {addPayErr && <p className="text-xs text-destructive">{addPayErr}</p>}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => { setShowAddPayment(false); setAddPayErr(null); }}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleAddPayment}
              disabled={createPaymentMutation.isPending}>
              {createPaymentMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save Payment
            </Button>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1">
        {isLoading && <p className="text-xs text-muted-foreground p-4">Loading…</p>}

        {!isLoading && !hasActivity && (
          <div className="flex items-center justify-center min-h-[120px]">
            <p className="text-sm text-muted-foreground">No payments recorded yet</p>
          </div>
        )}

        {/* Payments list */}
        {payments.length > 0 && (
          <div className="divide-y">
            {payments.map(pmt => (
              <div key={pmt.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0 text-xs">
                  <Badge variant="secondary" className="capitalize text-xs shrink-0">
                    {pmt.type.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(pmt.paymentDate).toLocaleDateString()}
                  </span>
                  {pmt.method && <span className="text-muted-foreground truncate">{pmt.method}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold tabular-nums">{formatCents(pmt.amountCents)}</span>
                  {isManager && (
                    <Button size="icon" variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeletePayment(pmt.id)}
                      disabled={deletePaymentMutation.isPending}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invoices list */}
        {invoices.length > 0 && (
          <div className={payments.length > 0 ? 'border-t divide-y' : 'divide-y'}>
            {invoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-2.5 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{inv.invoiceNumber}</span>
                    <Badge variant="outline"
                      className={`text-xs capitalize ${INVOICE_STATUS_CLASSES[inv.status] ?? ''}`}>
                      {inv.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{inv.customerName}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-sm font-semibold tabular-nums">{formatCents(inv.amountCents)}</span>
                  {isManager && (
                    <>
                      {(inv.status === 'open' || inv.status === 'sent') && (
                        <Button size="sm" variant="outline" className="h-6 text-xs px-1.5"
                          onClick={() => markInvPaidMutation.mutateAsync({ invoiceId: inv.id })
                            .then(() => toast({ title: 'Invoice marked paid' }))
                            .catch(() => toast({ title: 'Error', variant: 'destructive' }))}
                          disabled={invPending}>Mark Paid</Button>
                      )}
                      {inv.status === 'open' && (
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-1.5"
                          onClick={() => sendInvMutation.mutateAsync({ invoiceId: inv.id })
                            .then(() => toast({ title: 'Invoice sent' }))
                            .catch(() => toast({ title: 'Error', variant: 'destructive' }))}
                          disabled={invPending}>Send</Button>
                      )}
                      {inv.status !== 'void' && (
                        <Button size="icon" variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-amber-600"
                          onClick={() => voidInvMutation.mutateAsync({ invoiceId: inv.id })
                            .then(() => toast({ title: 'Invoice voided' }))
                            .catch(() => toast({ title: 'Error', variant: 'destructive' }))}
                          disabled={invPending} title="Void">
                          <XCircle className="h-3 w-3" />
                        </Button>
                      )}
                      {(inv.status === 'open' || inv.status === 'void') && (
                        <Button size="icon" variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteInvMutation.mutateAsync({ invoiceId: inv.id })
                            .then(() => toast({ title: 'Invoice deleted' }))
                            .catch(() => toast({ title: 'Error', variant: 'destructive' }))}
                          disabled={invPending} title="Delete">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create Invoice modal ──────────────────────────────────────────── */}
      <Dialog open={invModalOpen} onOpenChange={setInvModalOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Customer Name</Label>
                <Input className="h-8 text-sm" value={invName}
                  onChange={e => setInvName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Address</Label>
                <Input className="h-8 text-sm" value={invAddress}
                  onChange={e => setInvAddress(e.target.value)} placeholder="123 Main St" />
              </div>
            </div>

            {/* Line items section */}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
                Line Items
              </p>

              {/* FIPSA Credit */}
              <div className="py-2 border-b">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="selFipsa" checked={selFipsa}
                    disabled={isExclusive}
                    onChange={e => setSelFipsa(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="selFipsa" className={`text-sm font-medium cursor-pointer ${isExclusive ? 'opacity-40' : ''}`}>
                        FIPSA Credit
                      </Label>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                        Always Paid — reduces total
                      </span>
                    </div>
                    {selFipsa && (
                      <Input className="h-7 text-xs mt-1.5 w-36" placeholder="$0.00"
                        value={fipsaAmt} onChange={e => setFipsaAmt(e.target.value)} />
                    )}
                  </div>
                </div>
              </div>

              {/* ACV Payment */}
              <div className="py-2 border-b">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="selAcv" checked={selAcv}
                    disabled={isExclusive}
                    onChange={e => setSelAcv(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                  <div className="flex-1">
                    <Label htmlFor="selAcv" className={`text-sm font-medium cursor-pointer ${isExclusive ? 'opacity-40' : ''}`}>
                      ACV Payment
                    </Label>
                    {selAcv && (
                      <Input className="h-7 text-xs mt-1.5 w-36" placeholder="$0.00"
                        value={acvAmt} onChange={e => setAcvAmt(e.target.value)} />
                    )}
                  </div>
                </div>
              </div>

              {/* Deductible */}
              <div className="py-2 border-b">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="selDeductible" checked={selDeductible}
                    disabled={isExclusive}
                    onChange={e => setSelDeductible(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                  <div className="flex-1">
                    <Label htmlFor="selDeductible" className={`text-sm font-medium cursor-pointer ${isExclusive ? 'opacity-40' : ''}`}>
                      Deductible
                    </Label>
                    {selDeductible && (
                      <Input className="h-7 text-xs mt-1.5 w-36" placeholder="$0.00"
                        value={deductibleAmt} onChange={e => setDeductibleAmt(e.target.value)} />
                    )}
                  </div>
                </div>
              </div>

              {/* Betterment */}
              <div className="py-2 border-b">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="selBetterment" checked={selBetterment}
                    disabled={isExclusive}
                    onChange={e => setSelBetterment(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                  <div className="flex-1">
                    <Label htmlFor="selBetterment" className={`text-sm font-medium cursor-pointer ${isExclusive ? 'opacity-40' : ''}`}>
                      Betterment
                    </Label>
                    {selBetterment && (
                      <Input className="h-7 text-xs mt-1.5 w-36" placeholder="$0.00"
                        value={bettermentAmt} onChange={e => setBettermentAmt(e.target.value)} />
                    )}
                  </div>
                </div>
              </div>

              {/* Emergency Services — exclusive */}
              <div className="py-2 border-b">
                <div className="flex items-start gap-3">
                  <input type="checkbox" id="selEmergency" checked={selEmergency}
                    disabled={selChangeOrder}
                    onChange={e => toggleEmergency(e.target.checked)}
                    className="h-4 w-4 mt-0.5 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="selEmergency" className={`text-sm font-medium cursor-pointer ${selChangeOrder ? 'opacity-40' : ''}`}>
                        Emergency Services
                      </Label>
                      <span className="text-[10px] text-muted-foreground italic">cannot combine with other items</span>
                    </div>
                    {selEmergency && (
                      <LineItems lines={emergencyLines} setLines={setEmergencyLines} />
                    )}
                  </div>
                </div>
              </div>

              {/* Change Order — exclusive */}
              <div className="py-2">
                <div className="flex items-start gap-3">
                  <input type="checkbox" id="selChangeOrder" checked={selChangeOrder}
                    disabled={selEmergency}
                    onChange={e => toggleChangeOrder(e.target.checked)}
                    className="h-4 w-4 mt-0.5 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="selChangeOrder" className={`text-sm font-medium cursor-pointer ${selEmergency ? 'opacity-40' : ''}`}>
                        Change Order
                      </Label>
                      <span className="text-[10px] text-muted-foreground italic">cannot combine with other items</span>
                    </div>
                    {selChangeOrder && (
                      <LineItems lines={coLines} setLines={setCoLines} />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Total summary */}
            <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
              {selFipsa && fipsaCents > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>FIPSA Credit (paid)</span>
                  <span className="text-green-600 font-medium">−{formatCents(fipsaCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold">
                <span>Invoice Total</span>
                <span className={netCents > 0 ? '' : 'text-muted-foreground'}>{formatCents(netCents)}</span>
              </div>
            </div>

            {invModalErr && <p className="text-xs text-destructive">{invModalErr}</p>}
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={() => setInvModalOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateInvoice} disabled={createInvMutation.isPending}>
              {createInvMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Create Invoice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Expense helpers
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  materials:     'Materials',
  labor:         'Labor',
  subcontractor: 'Subcontractor',
  equipment:     'Equipment',
  other:         'Other',
};

const EXPENSE_CATEGORIES_LIST = ['materials', 'labor', 'subcontractor', 'equipment', 'other'] as const;

// ===========================================================================
// EXPENSE TRACKER PANEL — vendor expenses, full-width bottom (step 3)
// ===========================================================================

function ExpenseTrackerPanel({
  pinId,
  isManager,
  onExportPdf,
  exportingPdf,
}: {
  pinId: string;
  isManager: boolean;
  onExportPdf: () => void;
  exportingPdf: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useListVendorExpenses(pinId);
  const createMutation   = useCreateVendorExpense();
  const updateMutation   = useUpdateVendorExpense();
  const deleteMutation   = useDeleteVendorExpense();
  const markPaidMutation = useMarkVendorExpensePaid();

  const expenses = data?.expenses ?? [];

  const [showAdd,   setShowAdd]   = useState(false);
  const [aVendor,   setAVendor]   = useState('');
  const [aDollars,  setADollars]  = useState('');
  const [aCategory, setACategory] = useState<string>('materials');
  const [aInvoice,  setAInvoice]  = useState('');
  const [aDesc,     setADesc]     = useState('');
  const [aError,    setAError]    = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [eVendor,   setEVendor]   = useState('');
  const [eDollars,  setEDollars]  = useState('');
  const [eCategory, setECategory] = useState<string>('materials');
  const [eDesc,     setEDesc]     = useState('');

  function resetAdd() {
    setAVendor(''); setADollars(''); setACategory('materials');
    setAInvoice(''); setADesc(''); setAError(null); setShowAdd(false);
  }

  async function handleCreate() {
    const cents = parseDollarToCents(aDollars);
    if (!cents)          { setAError('Enter a valid amount greater than $0.00'); return; }
    if (!aVendor.trim()) { setAError('Vendor name is required');                 return; }
    setAError(null);
    try {
      await createMutation.mutateAsync({
        pinId,
        data: {
          vendorName: aVendor.trim(), amountCents: cents,
          category: aCategory as CreateVendorExpenseInput['category'],
          invoiceNumber: aInvoice.trim() || null,
          description: aDesc.trim() || null,
        } satisfies CreateVendorExpenseInput,
      });
      resetAdd();
      toast({ title: 'Expense added' });
    } catch {
      toast({ title: 'Error', description: 'Failed to add expense.', variant: 'destructive' });
    }
  }

  function beginEdit(exp: NonNullable<typeof data>['expenses'][number]) {
    setEditingId(exp.id);
    setEVendor(exp.vendorName);
    setEDollars((exp.amountCents / 100).toFixed(2));
    setECategory(exp.category);
    setEDesc(exp.description ?? '');
  }

  async function handleUpdate(expenseId: string) {
    const cents = parseDollarToCents(eDollars);
    if (!cents || !eVendor.trim()) return;
    try {
      await updateMutation.mutateAsync({
        expenseId,
        data: {
          vendorName: eVendor.trim(), amountCents: cents,
          category: eCategory as UpdateVendorExpenseInput['category'],
          description: eDesc.trim() || null,
        } satisfies UpdateVendorExpenseInput,
      });
      setEditingId(null);
      toast({ title: 'Expense updated' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update expense.', variant: 'destructive' });
    }
  }

  async function handleDelete(expenseId: string) {
    try {
      await deleteMutation.mutateAsync({ expenseId });
      toast({ title: 'Expense deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete expense.', variant: 'destructive' });
    }
  }

  async function handleMarkPaid(expenseId: string) {
    try {
      await markPaidMutation.mutateAsync({ expenseId });
      toast({ title: 'Expense marked as paid' });
    } catch {
      toast({ title: 'Error', description: 'Failed to mark paid.', variant: 'destructive' });
    }
  }

  const totalCents       = expenses.reduce((s, e) => s + e.amountCents, 0);
  const paidCents        = expenses.filter(e => e.isPaid).reduce((s, e) => s + e.amountCents, 0);
  const outstandingCents = totalCents - paidCents;

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm">Expense Tracker</h3>
            <p className="text-xs text-muted-foreground">Vendor invoices and project expenses</p>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 text-xs px-2"
              onClick={onExportPdf} disabled={exportingPdf}>
              {exportingPdf
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating…</>
                : <><FileText className="h-3 w-3 mr-1" />Project P&amp;L Report</>
              }
            </Button>
          )}
          {isManager && (
            <Button size="sm" className="h-7 text-xs px-2"
              onClick={() => setShowAdd(v => !v)}>
              <Plus className="h-3 w-3 mr-1" />Add Expense
            </Button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showAdd && isManager && (
        <div className="border-b p-4 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Vendor Name *</Label>
              <Input value={aVendor} onChange={e => setAVendor(e.target.value)}
                placeholder="e.g. ACME Roofing Supply" className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount ($) *</Label>
              <Input value={aDollars} onChange={e => setADollars(e.target.value)}
                placeholder="0.00" className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category *</Label>
              <Select value={aCategory} onValueChange={setACategory}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES_LIST.map(c => (
                    <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Invoice # (optional)</Label>
              <Input value={aInvoice} onChange={e => setAInvoice(e.target.value)}
                placeholder="INV-001" className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={aDesc} onChange={e => setADesc(e.target.value)}
                placeholder="Brief description" className="h-7 text-xs" />
            </div>
          </div>
          {aError && <p className="text-xs text-destructive">{aError}</p>}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetAdd}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleCreate}
              disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Adding…' : 'Add Expense'}
            </Button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground p-4">Loading expenses…</p>}

      {!isLoading && expenses.length === 0 && (
        <div className="flex items-center justify-center min-h-[100px]">
          <p className="text-sm text-muted-foreground text-center px-4">
            No expenses yet. Add supplier or subcontractor invoices to track project costs.
          </p>
        </div>
      )}

      {expenses.length > 0 && (
        <div className="divide-y">
          {expenses.map(exp => (
            <div key={exp.id}>
              {editingId === exp.id ? (
                <div className="p-3 space-y-2 bg-muted/20">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Vendor Name</Label>
                      <Input value={eVendor} onChange={e => setEVendor(e.target.value)} className="h-7 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount ($)</Label>
                      <Input value={eDollars} onChange={e => setEDollars(e.target.value)} className="h-7 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Category</Label>
                      <Select value={eCategory} onValueChange={setECategory}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES_LIST.map(c => (
                            <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Description</Label>
                      <Input value={eDesc} onChange={e => setEDesc(e.target.value)} className="h-7 text-xs" />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => handleUpdate(exp.id)}
                      disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{exp.vendorName}</p>
                    <p className="text-xs text-muted-foreground">
                      {EXPENSE_CATEGORY_LABELS[exp.category] ?? exp.category}
                      {exp.description ? ` · ${exp.description}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{formatCents(exp.amountCents)}</span>
                    {exp.isPaid ? (
                      <Badge variant="outline" className="text-xs border-green-500 text-green-600">Paid</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Unpaid</Badge>
                    )}
                    {isManager && !exp.isPaid && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                        onClick={() => handleMarkPaid(exp.id)} disabled={markPaidMutation.isPending}>
                        Mark Paid
                      </Button>
                    )}
                    {isManager && (
                      <>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                          onClick={() => beginEdit(exp)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(exp.id)} disabled={deleteMutation.isPending}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {expenses.length > 0 && (
        <div className="flex items-center justify-end gap-4 text-xs border-t px-4 py-2.5">
          {paidCents > 0 && (
            <span className="text-muted-foreground">
              Paid: <span className="font-semibold text-green-600 tabular-nums">{formatCents(paidCents)}</span>
            </span>
          )}
          {outstandingCents > 0 && (
            <span className="text-muted-foreground">
              Outstanding: <span className="font-semibold text-amber-600 tabular-nums">{formatCents(outstandingCents)}</span>
            </span>
          )}
          <span className="text-muted-foreground">
            Total: <span className="font-semibold tabular-nums">{formatCents(totalCents)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// COST BREAKDOWN PANEL — commissions (auto-save on blur) + computed totals
// Right column, step 3.
// ---------------------------------------------------------------------------

type CommissionField = {
  key:      'leadAcquisitionCostCents' | 'referralFeeCents' | 'salesCommissionCents'
          | 'canvassingCommissionCents' | 'pmCommissionCents';
  label:    string;
  paidKey?: 'salesCommissionPaidDate' | 'canvassingCommissionPaidDate' | 'pmCommissionPaidDate';
};

const OVERHEAD_FIELDS: CommissionField[] = [
  { key: 'leadAcquisitionCostCents',  label: 'Lead Acquisition'   },
  { key: 'referralFeeCents',          label: 'Referral Fee'       },
  { key: 'salesCommissionCents',      label: 'Sales Commission',  paidKey: 'salesCommissionPaidDate'      },
  { key: 'canvassingCommissionCents', label: 'Canvassing Comm.',  paidKey: 'canvassingCommissionPaidDate' },
  { key: 'pmCommissionCents',         label: 'PM Commission',     paidKey: 'pmCommissionPaidDate'         },
];

// ===========================================================================
// COLLECTION TRACKER PANEL — donut chart of invoiced / collected / balance
// ===========================================================================

function CollectionTrackerPanel({ pinId }: { pinId: string }) {
  const { data: profData } = useGetPinProfitability(pinId);
  const p = profData?.profitability;

  const totalCents      = p?.revisedContractCents ?? 0;
  const invoicedRaw     = p?.invoiceTotalCents    ?? 0;
  const paidCents       = p?.invoicePaidCents     ?? 0;
  const unpaidCents     = Math.max(0, invoicedRaw - paidCents);   // invoiced but not yet collected
  const balanceCents    = Math.max(0, totalCents - invoicedRaw);  // not yet invoiced

  // When total is zero fall back to a single placeholder segment so the ring
  // renders; we'll hide the labels in that case.
  const hasData = totalCents > 0;

  const segments = hasData
    ? [
        { name: 'Collected', value: Math.max(0, paidCents), color: '#22c55e' },  // green-500
        { name: 'Invoiced',  value: unpaidCents,            color: '#fbbf24' },  // amber-400
        { name: 'Balance',   value: balanceCents,           color: '#fca5a5' },  // red-300
      ]
    : [{ name: 'No data', value: 1, color: '#e2e8f0' }]; // muted placeholder

  const rows: { color: string; label: string; cents: number }[] = [
    { color: '#22c55e', label: 'Collected', cents: paidCents    },
    { color: '#fbbf24', label: 'Invoiced',  cents: unpaidCents  },
    { color: '#fca5a5', label: 'Balance',   cents: balanceCents },
  ];

  return (
    <div className="rounded-lg border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <Wallet className="h-4 w-4 text-blue-500 shrink-0" />
        <div>
          <h3 className="font-semibold text-base">Collection Tracker</h3>
          <p className="text-sm text-muted-foreground">
            {hasData
              ? `Total contract: ${formatCents(totalCents)}`
              : 'No contract value set'}
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center gap-4 px-4 py-5">
        {/* Donut chart */}
        <div className="shrink-0 relative">
          <PieChart width={425} height={425}>
            <Pie
              data={segments}
              cx={206}
              cy={206}
              innerRadius={125}
              outerRadius={195}
              dataKey="value"
              strokeWidth={hasData ? 2 : 0}
              stroke="hsl(var(--card))"
              startAngle={90}
              endAngle={-270}
            >
              {segments.map((seg, i) => (
                <Cell key={i} fill={seg.color} />
              ))}
            </Pie>
            {hasData && (
              <RechartsTooltip
                formatter={(value: number) => [formatCents(value), '']}
                contentStyle={{ fontSize: 13, padding: '4px 8px' }}
                itemStyle={{ margin: 0 }}
              />
            )}
          </PieChart>
          {/* Center label — always visible */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-sm text-muted-foreground leading-none">Total</span>
            <span className="text-base font-semibold tabular-nums leading-tight mt-1">
              {formatCents(totalCents)}
            </span>
          </div>
        </div>

        {/* Legend table */}
        <div className="w-full space-y-5 text-base px-2">
          {rows.map(row => (
            <div key={row.label} className="flex items-center gap-2.5">
              <div
                className="h-3 w-3 rounded-[3px] shrink-0"
                style={{ backgroundColor: row.color }}
              />
              <span className="flex-1 text-muted-foreground text-sm">{row.label}</span>
              <span className="tabular-nums font-semibold text-sm">{formatCents(row.cents)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// CLAIM VALUE TRACKER PANEL — RCV / ACV / Variance / Betterments bar
// Insurance-only tile in the Financials tab. Shows how the carrier's approved
// amounts map against the total contract value.
//
// Bar (left → right, widths sum to 100% of revisedContractCents):
//   ■ Green        – Approved ACV
//   ■ Light Green  – Approved RCV above ACV
//   ■ Red          – Variance (base scope not covered by RCV — SHORT)
//   ■ Light Purple – Betterments (always from the right)
// ===========================================================================

function ClaimValueTrackerFinancialsPanel({
  pinId,
  isManager,
}: {
  pinId: string;
  isManager: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: profData } = useGetPinProfitability(pinId);
  const { data: insData }  = useGetPinInsurance(pinId);
  const { mutateAsync: patchIns, isPending: saving } = usePatchPinInsurance({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPinProfitabilityQueryKey(pinId) });
        qc.invalidateQueries({ queryKey: getGetPinInsuranceQueryKey(pinId) });
      },
    },
  });

  const p   = profData?.profitability;
  const ins = insData?.insurance;

  // ── Bar math ──────────────────────────────────────────────────────────────
  // totalCents  = contract value ± change orders  (the full bar)
  // baseScopeCents = revised − betterments         (non-betterments portion)
  // rcvCents    = revisedContractCents + claimVarianceCents
  //               (claimVariance = approvedRcv − revised, so rcv = revised + variance)
  const totalCents      = Math.max(0, p?.revisedContractCents ?? 0);
  const baseScopeCents  = Math.max(0, p?.baseScopeCents       ?? totalCents);
  const bettCents       = Math.max(0, totalCents - baseScopeCents);
  const acvCents        = Math.max(0, p?.approvedAcvCents     ?? 0);
  const rcvCents        = Math.max(0, totalCents + (p?.claimVarianceCents ?? 0));

  // Clamp all within baseScopeCents so segments never overflow the left portion
  const clampedAcv      = Math.min(acvCents, baseScopeCents);
  const clampedRcvTop   = Math.min(rcvCents, baseScopeCents);
  const rcvAboveAcvCents = Math.max(0, clampedRcvTop - clampedAcv);
  const varianceCents    = Math.max(0, baseScopeCents - clampedRcvTop);
  const isShort          = varianceCents > 0 && totalCents > 0;

  const toPercent = (n: number) =>
    totalCents > 0 ? Math.max(0, Math.min(100, (n / totalCents) * 100)) : 0;

  const acvPct        = toPercent(clampedAcv);
  const rcvAbovePct   = toPercent(rcvAboveAcvCents);
  const variancePct   = toPercent(varianceCents);
  const bettPct       = toPercent(bettCents);

  // RCV tick position as percentage of bar (for the midpoint label)
  const rcvTickPct    = totalCents > 0 ? Math.max(2, Math.min(96, (rcvCents / totalCents) * 100)) : 50;

  // ── Modal state ───────────────────────────────────────────────────────────
  const [open,      setOpen]     = useState(false);
  const [rcvDraft,  setRcvDraft] = useState('');
  const [acvDraft,  setAcvDraft] = useState('');
  const [bettDraft, setBettDraft] = useState('');

  function openModal() {
    setRcvDraft(ins?.approvedRcvAmount  ?? '');
    setAcvDraft(ins?.approvedAcvAmount  ?? '');
    setBettDraft(
      ins?.bettermentsAmountCents != null
        ? (ins.bettermentsAmountCents / 100).toFixed(2)
        : '',
    );
    setOpen(true);
  }

  async function handleSave() {
    const bettCentsVal = bettDraft.trim() ? parseDollarToCents(bettDraft) : null;
    try {
      await patchIns({
        pinId,
        data: {
          approvedRcvAmount:      rcvDraft.trim()  || null,
          approvedAcvAmount:      acvDraft.trim()  || null,
          bettermentsAmountCents: bettCentsVal,
        },
      });
      toast({ title: 'Claim financials saved.' });
      setOpen(false);
    } catch {
      toast({ title: 'Error saving claim financials.', variant: 'destructive' });
    }
  }

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const hasData = totalCents > 0;

  return (
    <div className="rounded-lg border bg-card">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 p-4 border-b">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Claim Value Tracker</h3>
            <p className="text-xs text-muted-foreground">RCV coverage vs. contract value</p>
          </div>
        </div>
        {isManager && (
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1.5 shrink-0"
            onClick={openModal}
          >
            <Pencil className="h-3 w-3" />
            Record Claim Financials
          </Button>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="p-4 space-y-3">

        {/* RCV / Contract labels */}
        <div className="flex justify-between items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Approved RCV</p>
            <p className="text-xl font-bold tabular-nums">
              {rcvCents > 0 ? formatCents(rcvCents) : '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Contract Amount</p>
            <p className="text-xl font-bold tabular-nums">
              {hasData ? formatCents(totalCents) : '—'}
            </p>
          </div>
        </div>

        {/* ── Bar ───────────────────────────────────────────────────────── */}
        {hasData ? (
          <>
            <div className="relative h-7 w-full rounded-md overflow-hidden bg-muted/30 flex">
              {/* ACV — solid green */}
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${acvPct}%` }}
                title={`ACV: ${formatCents(clampedAcv)}`}
              />
              {/* RCV above ACV — light green */}
              <div
                className="h-full bg-green-300 transition-all"
                style={{ width: `${rcvAbovePct}%` }}
                title={`RCV above ACV: ${formatCents(rcvAboveAcvCents)}`}
              />
              {/* Variance — red (gap between RCV and base scope) */}
              <div
                className="h-full bg-red-400 transition-all"
                style={{ width: `${variancePct}%` }}
                title={`Variance (SHORT): ${formatCents(varianceCents)}`}
              />
              {/* Betterments — light purple, flush right */}
              <div
                className="h-full bg-purple-300 transition-all ml-auto"
                style={{ width: `${bettPct}%` }}
                title={`Betterments: ${formatCents(bettCents)}`}
              />
            </div>

            {/* Tick labels: 0% … rcvPct% … 100% */}
            <div className="relative h-4 w-full text-[10px] text-muted-foreground select-none">
              <span className="absolute left-0">0%</span>
              {rcvCents > 0 && (
                <span
                  className="absolute -translate-x-1/2"
                  style={{ left: `${rcvTickPct}%` }}
                >
                  {rcvTickPct.toFixed(1)}%
                </span>
              )}
              <span className="absolute right-0">100%</span>
            </div>

            {/* Legend row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-green-500" />
                ACV
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-green-300" />
                RCV above ACV
              </span>
              {isShort && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-red-400" />
                  Variance
                </span>
              )}
              {bettCents > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-purple-300" />
                  Betterments
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="h-7 rounded-md bg-muted/30 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">
              No contract value — set via Project Financials
            </span>
          </div>
        )}

        {/* ── Variance / coverage alert ──────────────────────────────────── */}
        {isShort && (
          <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
            <span className="font-semibold text-red-700 dark:text-red-400">
              VARIANCE: {formatCents(varianceCents)} (SHORT)
            </span>
            <span className="text-red-500 dark:text-red-500 ml-0.5">
              Supplement may be needed
            </span>
          </div>
        )}
        {!isShort && hasData && rcvCents > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-3 py-2 text-xs">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
            <span className="font-semibold text-green-700 dark:text-green-400">
              RCV covers full scope
            </span>
          </div>
        )}

        {/* ── Collapsible breakdown ──────────────────────────────────────── */}
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setBreakdownOpen(o => !o)}
        >
          {breakdownOpen
            ? <><ChevronUp className="h-3 w-3" /> Hide claim &amp; contract breakdown</>
            : <><ChevronDown className="h-3 w-3" /> Show claim &amp; contract breakdown</>}
        </button>

        {breakdownOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-3 border-t text-sm">
            {/* Claim breakdown */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Claim Breakdown
              </p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">RCV Approved</span>
                <span className="tabular-nums font-medium">{formatCents(rcvCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ACV Approved</span>
                <span className="tabular-nums font-medium">{formatCents(acvCents)}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="font-semibold">Total Approved</span>
                <span className="tabular-nums font-bold">{formatCents(rcvCents)}</span>
              </div>
            </div>

            {/* Contract breakdown */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contract Breakdown
              </p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base Scope</span>
                <span className="tabular-nums font-medium">{formatCents(baseScopeCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Betterments</span>
                <span className="tabular-nums font-medium">{formatCents(bettCents)}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="font-semibold">Total Contract</span>
                <span className="tabular-nums font-bold">{formatCents(totalCents)}</span>
              </div>
              {hasData && rcvCents > 0 && (
                <p className="text-right text-[10px] text-muted-foreground">
                  {((rcvCents / totalCents) * 100).toFixed(1)}% of contract
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Record Claim Financials modal ─────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Claim Financials</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Approved RCV</Label>
              <Input
                placeholder="e.g. 18,520.00"
                value={rcvDraft}
                onChange={e => setRcvDraft(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Replacement Cost Value approved by the carrier
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Approved ACV</Label>
              <Input
                placeholder="e.g. 15,000.00"
                value={acvDraft}
                onChange={e => setAcvDraft(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Actual Cash Value (depreciated payment)
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Betterments</Label>
              <Input
                placeholder="e.g. 2,500.00"
                value={bettDraft}
                onChange={e => setBettDraft(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Upgrades / code-required improvements not covered by the claim
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// PROJECT FINANCIALS PANEL — accrual-basis waterfall (FINANCIALS STEP 5, Step 3)
// Waterfall: Contract Value → Change Orders → Revised Contract →
//            Cost of Goods Sold → Job Overhead → Net Project Margin
// ===========================================================================

function ProjectFinancialsPanel({ pinId, isManager }: { pinId: string; isManager: boolean }) {
  const { toast }                  = useToast();
  const { data: leadData }         = useGetLead(pinId);
  const { data: profData }         = useGetPinProfitability(pinId);
  const updateMutation             = useUpdateCommissions();
  const salesMarkPaidMutation      = useMarkSalesCommissionPaid();
  const canvassingMarkPaidMutation = useMarkCanvassingCommissionPaid();
  const pmMarkPaidMutation         = useMarkPmCommissionPaid();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lead = leadData?.lead as any;
  const p    = profData?.profitability;

  const [overheadOpen, setOverheadOpen] = useState(false);
  const [coModalOpen,  setCoModalOpen]  = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!lead) return;
    setDrafts({
      leadAcquisitionCostCents:  lead.leadAcquisitionCostCents  != null ? (lead.leadAcquisitionCostCents  / 100).toFixed(2) : '',
      referralFeeCents:          lead.referralFeeCents          != null ? (lead.referralFeeCents          / 100).toFixed(2) : '',
      salesCommissionCents:      lead.salesCommissionCents      != null ? (lead.salesCommissionCents      / 100).toFixed(2) : '',
      canvassingCommissionCents: lead.canvassingCommissionCents != null ? (lead.canvassingCommissionCents / 100).toFixed(2) : '',
      pmCommissionCents:         lead.pmCommissionCents         != null ? (lead.pmCommissionCents         / 100).toFixed(2) : '',
    });
  }, [lead?.id]);

  async function handleBlurSave(field: CommissionField) {
    if (!isManager) return;
    const raw   = drafts[field.key] ?? '';
    const cents  = parseDollarToCents(raw);
    const value  = raw.trim() === '' ? null : cents;
    if (raw.trim() !== '' && !value) return;
    const currentCents = (lead?.[field.key] as number | null | undefined) ?? null;
    if (value === currentCents) return;
    try {
      await updateMutation.mutateAsync({ pinId, data: { [field.key]: value } });
    } catch {
      toast({ title: 'Error', description: `Failed to save ${field.label}.`, variant: 'destructive' });
    }
  }

  async function handleMarkPaid(field: CommissionField) {
    if (!field.paidKey) return;
    const mutation =
      field.paidKey === 'salesCommissionPaidDate'      ? salesMarkPaidMutation      :
      field.paidKey === 'canvassingCommissionPaidDate'  ? canvassingMarkPaidMutation :
                                                          pmMarkPaidMutation;
    try {
      await mutation.mutateAsync({ pinId });
      toast({ title: `${field.label} marked as paid` });
    } catch (err: unknown) {
      toast({ title: 'Error',
        description: (err as { message?: string })?.message ?? 'Failed to mark paid.',
        variant: 'destructive' });
    }
  }

  // Waterfall numbers — all from the profitability view (migration 029)
  const approvedCoCents    = p?.approvedCoCents         ?? 0;
  const revisedCents       = p?.revisedContractCents    ?? 0;
  const baseContractCents  = revisedCents - approvedCoCents;   // = _parse_legacy(contractAmount)
  const cogsCents          = p?.totalExpenseCents       ?? 0;
  const overheadCents      = p?.totalCommissionCents    ?? 0;
  const netMarginCents     = p?.netProjectMarginCents   ?? 0;
  const netMarginPct       = p?.netProjectMarginPct     ?? 0;

  // Committed-but-unpaid: overhead lines that have a paidKey, an amount set,
  // but no paid date yet — these are real liabilities.
  const unpaidOverheadCents = OVERHEAD_FIELDS
    .filter(f => f.paidKey && !lead?.[f.paidKey] && (lead?.[f.key] ?? 0) > 0)
    .reduce((s, f) => s + ((lead?.[f.key] as number | undefined) ?? 0), 0);

  return (
    <div className="rounded-lg border bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
        <div>
          <h3 className="font-semibold text-sm">Project Financials</h3>
          <p className="text-xs text-muted-foreground">Accrual waterfall</p>
        </div>
      </div>

      <div className="flex-1 divide-y text-sm">
        {/* Row: Contract Value */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-medium">Contract Value</span>
          <span className="tabular-nums font-semibold">
            {formatCents(baseContractCents)}
          </span>
        </div>

        {/* Row: Change Orders — always visible; click opens full CO list modal */}
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-sm text-left"
          onClick={() => setCoModalOpen(true)}>
          <span className="text-muted-foreground">Change Orders</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {approvedCoCents !== 0 ? (
              <span className={`tabular-nums font-semibold ${approvedCoCents >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {approvedCoCents >= 0 ? '+' : '−'}{formatCents(Math.abs(approvedCoCents))}
              </span>
            ) : (
              <span className="tabular-nums font-semibold text-muted-foreground">—</span>
            )}
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </div>
        </button>

        {/* Change Orders modal — reuses the existing ChangeOrdersPanel list */}
        <Dialog open={coModalOpen} onOpenChange={setCoModalOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Change Orders</DialogTitle>
            </DialogHeader>
            <ChangeOrdersPanel pinId={pinId} isManager={isManager} isInsurance={false} />
          </DialogContent>
        </Dialog>

        {/* Row: Cost of Goods Sold */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-medium text-muted-foreground">Cost of Goods Sold</span>
          <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">
            {cogsCents > 0 ? `(${formatCents(cogsCents)})` : '—'}
          </span>
        </div>

        {/* Row: Job Overhead — collapsible, expands to show the 5 lines (3c) */}
        <div>
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-sm"
            onClick={() => setOverheadOpen(o => !o)}>
            <span className="font-medium text-muted-foreground">Job Overhead</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">
                {overheadCents > 0 ? `(${formatCents(overheadCents)})` : '—'}
              </span>
              {overheadOpen
                ? <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>

          {/* Overhead detail rows */}
          {overheadOpen && (
            <div className="bg-muted/20 divide-y border-t">
              {OVERHEAD_FIELDS.map(field => {
                const paidDate  = field.paidKey ? lead?.[field.paidKey] : null;
                const amountSet = !!(lead?.[field.key]);
                const isPaid    = !!paidDate;
                return (
                  <div key={field.key} className="flex items-center justify-between px-4 py-2 gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{field.label}</span>
                      {isPaid && (
                        <p className="text-xs text-green-500 mt-0.5">
                          Paid {new Date(paidDate as string).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {field.paidKey && amountSet && !isPaid && isManager && (
                        <button
                          className="text-xs text-amber-500 hover:text-amber-400 hover:underline underline-offset-2"
                          onClick={() => handleMarkPaid(field)}
                          disabled={
                            salesMarkPaidMutation.isPending ||
                            canvassingMarkPaidMutation.isPending ||
                            pmMarkPaidMutation.isPending
                          }>
                          Mark paid
                        </button>
                      )}
                      {isPaid && <span className="text-xs text-green-500 font-medium">✓</span>}
                      {isManager ? (
                        <Input
                          className="h-7 w-24 text-sm text-right tabular-nums"
                          value={drafts[field.key] ?? ''}
                          onChange={e => setDrafts(d => ({ ...d, [field.key]: e.target.value }))}
                          onBlur={() => handleBlurSave(field)}
                          placeholder="0"
                          disabled={updateMutation.isPending}
                        />
                      ) : (
                        <span className="text-sm tabular-nums font-semibold">
                          {lead?.[field.key] != null ? formatCents(lead[field.key] as number) : '—'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Committed-but-unpaid subtotal */}
              {unpaidOverheadCents > 0 && (
                <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10">
                  <span className="text-xs text-amber-600 dark:text-amber-400">Committed, unpaid</span>
                  <span className="text-xs tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                    {formatCents(unpaidOverheadCents)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row: Net Project Margin — bottom line */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
          <span className="font-bold">Net Project Margin</span>
          <div className="text-right shrink-0">
            <span className={`tabular-nums font-bold ${
              netMarginCents >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}>
              {formatCents(netMarginCents)}
            </span>
            {revisedCents > 0 && (
              <p className={`text-xs ${netMarginPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {netMarginPct.toFixed(1)}%
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// FIN KPI CARDS — 5 stat cards across the top
// ===========================================================================

function FinKpiCards({
  pinId,
  contractAmount,
  onField,
}: {
  pinId: string;
  contractAmount: string;
  onField: (n: string, v: string) => void;
}) {
  const { data: profData } = useGetPinProfitability(pinId);
  const p = profData?.profitability;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: updateLead } = useUpdateLead(pinId);

  const [editingContract, setEditingContract] = useState(false);
  const [contractDraft,   setContractDraft]   = useState(contractAmount);

  useEffect(() => {
    if (!editingContract) setContractDraft(contractAmount);
  }, [contractAmount, editingContract]);

  async function commitContract(val: string) {
    onField('contractAmount', val);          // keep local form state in sync
    setEditingContract(false);
    try {
      await updateLead({ contractAmount: val.trim() === '' ? null : val });
      qc.invalidateQueries({ queryKey: getGetPinProfitabilityQueryKey(pinId) });
    } catch {
      toast({ title: 'Save failed', description: 'Could not update contract value.', variant: 'destructive' });
    }
  }

  const contractCents      = parseDollarToCents(contractAmount.replace(/[$,\s]/g, '')) ??
    (contractAmount.trim() ? null : 0);
  const totalPayments      = p?.totalPaymentsCents      ?? 0;
  const totalCosts         = p?.totalCostCents          ?? 0;
  const approvedCoCents    = p?.approvedCoCents         ?? 0;
  const netProjectMargin   = p?.netProjectMarginCents   ?? 0;
  const netProjectMarginPct = p?.netProjectMarginPct    ?? 0;
  const revisedCents       = p?.revisedContractCents    ?? 0;
  const balanceDue         = revisedCents > 0 ? Math.max(0, revisedCents - totalPayments) : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {/* Contract Value — whole tile is clickable to edit */}
      <div
        className={`rounded-lg border bg-card border-l-[3px] border-l-green-500 p-4 space-y-1 transition-colors ${
          editingContract ? '' : 'cursor-pointer hover:bg-accent/50'
        }`}
        onClick={() => { if (!editingContract) setEditingContract(true); }}
        title={editingContract ? undefined : 'Edit contract value'}
      >
        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
          <TrendingUp className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Contract Value</span>
          {!editingContract && <Pencil className="h-3 w-3 ml-auto opacity-40" />}
        </div>
        {editingContract ? (
          <Input
            className="h-7 text-sm mt-1"
            value={contractDraft}
            onChange={e => setContractDraft(e.target.value)}
            onBlur={() => commitContract(contractDraft)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitContract(contractDraft);
              if (e.key === 'Escape') setEditingContract(false);
            }}
            autoFocus
            placeholder="0.00"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <>
            <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
              {contractAmount.trim()
                ? (contractCents != null ? formatCents(contractCents) : contractAmount)
                : '$0'}
            </p>
            {approvedCoCents !== 0 && (
              <p className={`text-xs ${approvedCoCents >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {approvedCoCents >= 0 ? '+' : '−'}{formatCents(Math.abs(approvedCoCents))} CO · {formatCents(revisedCents)} revised
              </p>
            )}
          </>
        )}
      </div>

      {/* Total Costs */}
      <div className="rounded-lg border bg-card border-l-[3px] border-l-red-500 p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
          <TrendingDown className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Total Costs</span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
          {formatCents(totalCosts)}
        </p>
      </div>

      {/* Net Project Margin */}
      <div className="rounded-lg border bg-card border-l-[3px] border-l-blue-500 p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
          <DollarSign className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Net Project Margin</span>
        </div>
        <p className={`text-2xl font-bold tabular-nums ${
          netProjectMargin >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'
        }`}>
          {formatCents(netProjectMargin)}
        </p>
        {revisedCents > 0 && (
          <p className={`text-xs ${netProjectMarginPct >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
            {netProjectMarginPct.toFixed(1)}% margin
          </p>
        )}
      </div>

      {/* Payments Received */}
      <div className="rounded-lg border bg-card border-l-[3px] border-l-purple-500 p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
          <DollarSign className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Payments Received</span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-purple-600 dark:text-purple-400">
          {formatCents(totalPayments)}
        </p>
      </div>

      {/* Balance Due */}
      <div className="rounded-lg border bg-card border-l-[3px] border-l-orange-500 p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
          <Wallet className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Balance Due</span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-orange-600 dark:text-orange-400">
          {balanceDue != null ? formatCents(balanceDue) : '—'}
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// CHANGE ORDERS PANEL — Zone 4, full width below expense tracker
// ===========================================================================

function ChangeOrdersPanel({
  pinId,
  isManager,
  isInsurance,
}: {
  pinId: string;
  isManager: boolean;
  isInsurance: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useListPinChangeOrders(pinId);
  const approveMutation = useApproveChangeOrder(pinId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const changeOrders: ChangeOrderRecord[] = data?.changeOrders ?? [];
  const approvedCos = changeOrders.filter((co) => co.status === 'approved' && !co.voidedAt);
  const pendingCos  = changeOrders.filter((co) => co.status === 'pending'  && !co.voidedAt);
  const approvedTotal = approvedCos.reduce((s, co) => s + co.amountCents, 0);

  async function handleApprove(co: ChangeOrderRecord) {
    try {
      await approveMutation.mutateAsync(co.id);
      toast({
        title: 'Change order approved',
        description: 'The signed PDF has been queued for delivery to the customer.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Approval failed',
        description: (err as { message?: string })?.message ?? 'Could not approve this change order.',
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="rounded-lg border bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-primary shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Change Orders</h3>
            <p className="text-xs text-muted-foreground">
              {approvedCos.length} approved
              {pendingCos.length > 0 && ` · ${pendingCos.length} pending`}
              {approvedTotal > 0 && ` · ${formatCents(approvedTotal)} added to contract`}
            </p>
          </div>
        </div>
        {pendingCos.length > 0 && (
          <Badge className="bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 text-xs">
            {pendingCos.length} pending review
          </Badge>
        )}
      </div>

      {isLoading && (
        <div className="p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      )}

      {!isLoading && changeOrders.length === 0 && (
        <div className="p-6 text-center text-muted-foreground text-sm">
          No change orders on this job yet.
        </div>
      )}

      {!isLoading && changeOrders.length > 0 && (
        <div className="divide-y">
          {changeOrders.map((co) => {
            const isVoided   = !!co.voidedAt;
            const isExpanded = expandedId === co.id;
            const canApprove =
              isManager &&
              co.status === 'pending' &&
              !isVoided &&
              !!co.documentObjectPath &&
              !!co.homeownerSignedAt;
            const docUrl = co.documentObjectPath
              ? `/api/storage/objects${co.documentObjectPath.replace(/^\/objects/, '')}`
              : null;

            return (
              <div key={co.id} className={isVoided ? 'opacity-50' : ''}>
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Status icon */}
                  <div className="shrink-0">
                    {co.status === 'approved' && !isVoided && (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    )}
                    {co.status === 'pending' && !isVoided && (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                    {isVoided && <XCircle className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCents(co.amountCents)}
                      </span>
                      {co.status === 'approved' && !isVoided && (
                        <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                          Approved
                        </Badge>
                      )}
                      {co.status === 'pending' && !isVoided && (
                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                          Pending
                        </Badge>
                      )}
                      {isVoided && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Voided
                        </Badge>
                      )}
                      {co.requiredToCompleteScope && (
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            isInsurance
                              ? 'border-blue-400 text-blue-600 dark:text-blue-400'
                              : 'border-orange-400 text-orange-600'
                          }`}
                        >
                          {isInsurance ? 'Supplement candidate' : 'Required scope'}
                        </Badge>
                      )}
                      {co.emailedAt && (
                        <span className="text-xs text-green-500 font-medium">✉ Emailed</span>
                      )}
                    </div>
                    {co.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {co.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(co.createdAt).toLocaleDateString()}
                      {co.homeownerSignedAt &&
                        ` · Signed ${new Date(co.homeownerSignedAt).toLocaleDateString()}`}
                      {co.approvedAt &&
                        ` · Approved ${new Date(co.approvedAt).toLocaleDateString()}`}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {docUrl && (
                      <a
                        href={docUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="View signed document"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {canApprove && (
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => handleApprove(co)}
                        disabled={approveMutation.isPending}
                      >
                        {approveMutation.isPending ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Approving…</>
                        ) : (
                          'Approve'
                        )}
                      </Button>
                    )}
                    {co.lineItems.length > 0 && (
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : co.id)}
                        title={isExpanded ? 'Collapse line items' : 'Expand line items'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Line items accordion */}
                {isExpanded && co.lineItems.length > 0 && (
                  <div className="px-4 pb-3 pl-11">
                    <div className="rounded border bg-muted/20 divide-y text-xs">
                      {co.lineItems.map((li) => (
                        <div
                          key={li.id}
                          className="flex items-center justify-between px-3 py-1.5 gap-2"
                        >
                          <span className="flex-1 truncate text-muted-foreground">
                            {parseFloat(li.quantity) !== 1
                              ? `${parseFloat(li.quantity)}× `
                              : ''}
                            {li.description}
                          </span>
                          <span className="font-medium tabular-nums shrink-0">
                            {formatCents(li.totalCents)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40">
                        <span className="font-semibold text-muted-foreground">Total</span>
                        <span className="font-bold tabular-nums">
                          {formatCents(co.amountCents)}
                        </span>
                      </div>
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

// ===========================================================================
// FINANCIALS TAB — 3-zone widget layout
// ===========================================================================

function FinancialsTab({
  form,
  onField,
  pinId,
  isManager,
  isInsurance,
  lead,
}: {
  form: FormState;
  onField: (n: string, v: string) => void;
  pinId: string;
  isManager: boolean;
  isInsurance: boolean;
  lead: FullLead;
}) {
  const { toast } = useToast();
  const [exportingPdf, setExportingPdf] = useState(false);

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const blob = await customFetch<Blob>(
        `/api/pins/${pinId}/financials/export`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financials-${pinId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Export failed', description: 'Could not generate the PDF. Please try again.', variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Zone 1 — KPI stat cards */}
      <FinKpiCards pinId={pinId} contractAmount={form.contractAmount} onField={onField} />

      {/* Two-column layout — left 2/3 stacks all main panels;
                              right 1/3 stacks Collection Tracker + Change Orders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* Column 1–2: Project Financials, Claim Value Tracker, Invoicing, Expense Tracker */}
        <div className="md:col-span-2 flex flex-col gap-4">
          <ProjectFinancialsPanel pinId={pinId} isManager={isManager} />
          {isInsurance && (
            <ClaimValueTrackerFinancialsPanel pinId={pinId} isManager={isManager} />
          )}
          <InvoicingPanel pinId={pinId} isManager={isManager} lead={lead} />
          <ExpenseTrackerPanel
            pinId={pinId}
            isManager={isManager}
            onExportPdf={handleExportPdf}
            exportingPdf={exportingPdf}
          />
        </div>

        {/* Column 3: Collection Tracker + Change Orders */}
        <div className="md:col-span-1 flex flex-col gap-4">
          <CollectionTrackerPanel pinId={pinId} />
          <ChangeOrdersPanel pinId={pinId} isManager={isManager} isInsurance={isInsurance} />
        </div>
      </div>
    </div>
  );
}

function CommunicationTab({ form, onField }: { form: FormState; onField: (n: string, v: string) => void }) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Notes & Activity">
        <TextareaField label="Communication Notes" name="communicationNotes" value={form.communicationNotes}
          onChange={onField} rows={10} placeholder="Log calls, emails, and other interactions here…" />
      </FieldGroup>
    </div>
  );
}

function ScopeTab({ form, onField }: { form: FormState; onField: (n: string, v: string) => void }) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Scope of Work">
        <TextareaField label="Contract Scope" name="contractScope" value={form.contractScope}
          onChange={onField} rows={5} placeholder="Describe the scope of work…" />
      </FieldGroup>
      <FieldGroup title="Measurements">
        <Field label="Square Footage"        name="squareFootage"       value={form.squareFootage}       onChange={onField} placeholder="e.g. 28 squares" />
        <Field label="Roof Pitch"            name="roofPitch"           value={form.roofPitch}           onChange={onField} placeholder="e.g. 4/12" />
        <Field label="Measurement Vendor"    name="measurementVendor"   value={form.measurementVendor}   onChange={onField} placeholder="EagleView, GAF QuickMeasure…" />
        <Field label="Measurement Report URL" name="measurementReportUrl" value={form.measurementReportUrl} onChange={onField} placeholder="https://…" span2 />
      </FieldGroup>
      <FieldGroup title="Material Selections">
        <Field label="Brand" name="materialBrand" value={form.materialBrand} onChange={onField} placeholder="GAF, Owens Corning…" />
        <Field label="Color" name="materialColor" value={form.materialColor} onChange={onField} placeholder="Charcoal, Barkwood…" />
        <Field label="Style" name="materialStyle" value={form.materialStyle} onChange={onField} placeholder="Timberline HDZ, Duration…" />
      </FieldGroup>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  site_photos:          'Site Photos',
  contracts:            'Contracts',
  estimates:            'Estimates',
  insurance_documents:  'Insurance Documents',
  measurement_reports:  'Measurement Reports',
  permits:              'Permits',
  correspondence:       'Correspondence',
  general:              'General',
};

// ---------------------------------------------------------------------------
// Files Tab
// ---------------------------------------------------------------------------


function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LeadFileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <ImageIcon className="h-4 w-4 shrink-0" />;
  if (mimeType === 'application/pdf' || mimeType.includes('word') || mimeType.includes('text'))
    return <FileText className="h-4 w-4 shrink-0" />;
  return <File className="h-4 w-4 shrink-0" />;
}


function FilesTab({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadCategory, setUploadCategory] = useState<LeadFileCategory>('general');
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  // Sections collapsed by user; non-empty sections start expanded
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { data, isLoading } = useGetLeadFiles(leadId);
  const registerFile = useRegisterLeadFile(leadId);
  const renameFileMutation = useRenameLeadFile(leadId);
  const deleteFileMutation = useDeleteLeadFile(leadId);

  const files = data?.files ?? [];

  const filesByCategory = useMemo(() => {
    const grouped = Object.fromEntries(
      LEAD_FILE_CATEGORIES.map(c => [c, [] as LeadFileRow[]]),
    ) as Record<string, LeadFileRow[]>;
    for (const f of files) {
      grouped[f.category]?.push(f);
    }
    return grouped;
  }, [files]);

  function toggleSection(cat: string) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const handleUpload = useCallback(async (rawFiles: FileList | null) => {
    if (!rawFiles || rawFiles.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: rawFiles.length });
    let ok = 0, fail = 0;

    for (let i = 0; i < rawFiles.length; i++) {
      const f = rawFiles[i];
      try {
        const { uploadURL, objectPath } = await customFetch<{
          uploadURL: string; objectPath: string;
        }>('/api/storage/uploads/request-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: f.name,
            size: f.size,
            contentType: f.type || 'application/octet-stream',
          }),
        });

        const putRes = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': f.type || 'application/octet-stream' },
          body: f,
        });
        if (!putRes.ok) throw new Error(`PUT ${putRes.status}`);

        await registerFile.mutateAsync({
          objectPath,
          fileName: f.name,
          originalName: f.name,
          fileSize: f.size,
          mimeType: f.type || 'application/octet-stream',
          category: uploadCategory,
        });
        ok++;
      } catch (err) {
        console.error('Lead file upload failed', err);
        fail++;
      }
      setUploadProgress({ done: i + 1, total: rawFiles.length });
    }

    setUploading(false);
    setUploadProgress(null);
    setShowUploadPanel(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (ok > 0) toast({ title: `${ok} file${ok !== 1 ? 's' : ''} uploaded` });
    if (fail > 0) toast({ title: `${fail} upload${fail !== 1 ? 's' : ''} failed`, variant: 'destructive' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCategory, registerFile, toast]);

  async function commitRename(fileId: string) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      await renameFileMutation.mutateAsync({ fileId, fileName: renameValue.trim() });
    } catch {
      toast({ title: 'Rename failed', variant: 'destructive' });
    }
    setRenamingId(null);
  }

  async function handleDelete(fileId: string) {
    try {
      await deleteFileMutation.mutateAsync(fileId);
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={e => handleUpload(e.target.files)}
      />

      {/* Upload panel */}
      {canManage && (
        <div>
          {!showUploadPanel ? (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowUploadPanel(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Files
              </Button>
            </div>
          ) : (
            <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
              <p className="text-sm font-medium">Upload files</p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Category</Label>
                  <Select
                    value={uploadCategory}
                    onValueChange={v => setUploadCategory(v as LeadFileCategory)}
                  >
                    <SelectTrigger className="h-8 text-xs w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_FILE_CATEGORIES.map(c => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Upload className="h-4 w-4 mr-2" />
                  }
                  {uploading
                    ? (uploadProgress
                        ? `${uploadProgress.done} / ${uploadProgress.total}`
                        : 'Uploading…')
                    : 'Choose Files'
                  }
                </Button>
                {!uploading && (
                  <Button variant="ghost" size="sm" onClick={() => setShowUploadPanel(false)}>
                    Cancel
                  </Button>
                )}
              </div>
              {uploading && uploadProgress && (
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Category sections */}
      {LEAD_FILE_CATEGORIES.map(cat => {
        const catFiles = filesByCategory[cat] ?? [];
        const isEmpty = catFiles.length === 0;
        const isCollapsed = collapsedSections.has(cat);

        return (
          <div key={cat} className="border rounded-lg overflow-hidden">
            {/* Section header */}
            <div
              className={`flex items-center justify-between px-4 py-2.5 ${
                isEmpty ? 'text-muted-foreground' : ''
              } ${!isEmpty ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
              onClick={() => !isEmpty && toggleSection(cat)}
              role={!isEmpty ? 'button' : undefined}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {CATEGORY_LABELS[cat]}
                {!isEmpty && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                    {catFiles.length}
                  </Badge>
                )}
              </span>
              {!isEmpty && (
                isCollapsed
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {/* File rows (non-empty, expanded) */}
            {!isEmpty && !isCollapsed && (
              <div className="divide-y border-t">
                {catFiles.map(file => (
                  <LeadFileRow
                    key={file.id}
                    file={file}
                    canManage={canManage}
                    isRenaming={renamingId === file.id}
                    renameValue={renameValue}
                    onRenameValueChange={setRenameValue}
                    onStartRename={() => { setRenamingId(file.id); setRenameValue(file.fileName); }}
                    onCommitRename={() => commitRename(file.id)}
                    onCancelRename={() => setRenamingId(null)}
                    onDelete={() => handleDelete(file.id)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {isEmpty && (
              <div className="px-4 pb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span>No files in this section.</span>
                {canManage && (
                  <button
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => {
                      setUploadCategory(cat);
                      setShowUploadPanel(true);
                    }}
                  >
                    Upload to this section
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function LeadProfile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error } = useGetLead(id!);
  const { mutateAsync: updateLead, isPending: saving } = useUpdateLead(id!);
  const { data: profileData } = useGetMyProfile();
  const { data: sampleInfo } = useGetSamplePackageInfo();
  const isSample = !!id && !!sampleInfo?.pinId && id === sampleInfo.pinId;

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [form, setForm] = useState<FormState | null>(null);
  const [stageSaving, setStageSaving] = useState(false);

  useEffect(() => {
    if (data?.lead && !form) setForm(initForm(data.lead));
  }, [data, form]);

  const lead = data?.lead;
  const isInsurance = !lead?.workflow || lead.workflow === 'insurance';
  const isRetail = lead?.workflow === 'retail';

  // Derive the linked inspection ID (for the Inspection Flow tab)
  const inspectionId = useMemo(() => {
    if (!lead) return null;
    // ins- prefixed leads ARE inspections; strip prefix to get the raw ID
    if (lead.id.startsWith('ins-')) return lead.id.slice(4);
    // Pin leads may have a linked inspection populated by the API
    return lead.inspectionId ?? null;
  }, [lead]);

  // Re-check AHJ button — only for ins- leads (which have a direct inspection)
  const isInsLead = id?.startsWith('ins-') ?? false;
  const userRole = profileData?.profile?.role ?? '';
  const isManager = ['manager', 'admin', 'super_admin'].includes(userRole);
  const canRecheckAhj = isInsLead && (
    userRole === 'manager' || userRole === 'admin' || userRole === 'super_admin'
  );
  const { mutateAsync: recheckAhj, isPending: ahjChecking } = useRecheckAhj(
    inspectionId ?? '',
    id ?? '',
  );

  // Rebuild tabs whenever pipeline type or inspection presence changes
  const tabs = useMemo(() => buildTabs(isInsurance, !!inspectionId), [isInsurance, inspectionId]);

  // Available stages based on pipeline type
  const stageOptions = isRetail ? RETAIL_STAGES : INSURANCE_STAGES;

  // Profile sub-status options for current stage (insurance only)
  const profileStatusOptions = useMemo(() => {
    if (!isInsurance || !form?.pipelineStage) return [];
    return STAGE_PROFILE_STATUSES[form.pipelineStage] ?? [];
  }, [isInsurance, form?.pipelineStage]);

  function handleField(name: string, val: string) {
    setForm(prev => prev ? { ...prev, [name]: val } : prev);
  }

  function handleCheckField(name: string, val: boolean) {
    setForm(prev => prev ? { ...prev, [name]: val } : prev);
  }

  // Auto-save stage change immediately; auto-populate default profile status
  async function handleStageChange(newStage: string) {
    const defaultStatus = isInsurance ? (STAGE_DEFAULT_PROFILE_STATUS[newStage] ?? '') : '';
    setForm(prev => prev ? { ...prev, pipelineStage: newStage, profileStatus: defaultStatus } : prev);
    setStageSaving(true);
    try {
      await updateLead({
        pipelineStage: newStage,
        profileStatus: defaultStatus || null,
        statusLastUpdated: new Date().toISOString(),
      });
      toast({ title: 'Stage updated', description: getStageLabel(newStage) });
    } catch {
      toast({ title: 'Error', description: 'Failed to update stage.', variant: 'destructive' });
    } finally {
      setStageSaving(false);
    }
  }

  // Auto-save profile status change immediately
  async function handleProfileStatusChange(newStatus: string) {
    setForm(prev => prev ? { ...prev, profileStatus: newStatus } : prev);
    try {
      await updateLead({ profileStatus: newStatus, statusLastUpdated: new Date().toISOString() });
    } catch {
      toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' });
    }
  }

  async function handleSave() {
    if (!form) return;
    const keys = TAB_FIELDS[activeTab];
    if (keys.length === 0) return;
    const payload: Record<string, string | boolean | null> = {};
    for (const k of keys) {
      const raw = form[k as keyof FormState];
      const serverKey = k === 'communicationNotes' ? 'notes' : k;
      if (typeof raw === 'boolean') {
        payload[serverKey] = raw;
      } else {
        payload[serverKey] = (raw as string) === '' ? null : (raw as string);
      }
    }
    try {
      await updateLead(payload);
      toast({ title: 'Saved', description: 'Lead profile updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save changes.', variant: 'destructive' });
    }
  }

  const displayName = lead
    ? [lead.ownerFirstName, lead.ownerLastName].filter(Boolean).join(' ') ||
      lead.customerName || 'Unnamed Lead'
    : '';

  const WORKFLOW_COLORS: Record<string, string> = {
    insurance: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    retail:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  };

  if (error) {
    return (
      <Shell>
        <div className="py-20 text-center text-muted-foreground">
          <p className="text-sm">Lead not found or you don&apos;t have access.</p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/leads')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Leads
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-0 -mx-4 sm:-mx-6">
        {/* ── Sticky header ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-background border-b px-4 sm:px-6">

          {/* SAMPLE banner — shown only for the company demo lead */}
          {isSample && (
            <div className="flex items-center gap-2 py-1.5 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800">
              <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded bg-amber-400 text-amber-900 shrink-0">
                SAMPLE
              </span>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-tight">
                This is your demo client. Add photos, inspection data, and walk the Proof Package Builder — exactly like a real claim.
              </p>
            </div>
          )}

          {/* Row 1 — back · name · badges */}
          <div className="flex items-center gap-3 py-3">
            <button onClick={() => navigate('/leads')}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </button>

            {isLoading ? (
              <div className="space-y-1 flex-1">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold truncate">{displayName}</h1>
                  {lead?.workflow && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${WORKFLOW_COLORS[lead.workflow] ?? ''}`}>
                      {lead.workflow.charAt(0).toUpperCase() + lead.workflow.slice(1)}
                    </span>
                  )}
                </div>
                {lead?.address && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />{lead.address}
                  </p>
                )}
                {/* AHJ check result badge */}
                {lead?.ahjCheck && !lead.ahjCheck.packPresent && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-0.5 mt-1 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>AHJ pack missing — <span className="font-semibold">{lead.ahjCheck.jurisdiction}</span> not in library</span>
                  </p>
                )}
                {/* Re-check AHJ button — manager+ only, ins- leads only */}
                {canRecheckAhj && (
                  <div className="mt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] px-2 gap-1"
                      disabled={ahjChecking}
                      onClick={async () => {
                        try {
                          const result = await recheckAhj();
                          if (result.ahjCheck) {
                            toast({
                              title: 'AHJ check complete',
                              description: result.ahjCheck.packPresent
                                ? `Pack found for ${result.ahjCheck.jurisdiction}`
                                : `No pack — ${result.ahjCheck.jurisdiction} not in library`,
                            });
                          } else {
                            toast({
                              title: 'AHJ check failed',
                              description: 'Could not determine jurisdiction. Try again.',
                              variant: 'destructive',
                            });
                          }
                        } catch {
                          toast({ title: 'Error', description: 'AHJ re-check failed.', variant: 'destructive' });
                        }
                      }}
                    >
                      {ahjChecking
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Checking…</>
                        : <><RefreshCw className="h-3 w-3" />Re-check AHJ</>
                      }
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Row 2 — stage dropdown · profile status (insurance) · last-updated */}
          {!isLoading && lead && form && (
            <div className="flex items-center gap-2 pb-2 flex-wrap">
              {/* Stage select */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Stage</span>
                <Select value={form.pipelineStage || ''} onValueChange={handleStageChange} disabled={stageSaving}>
                  <SelectTrigger className="h-7 text-xs min-w-[180px] max-w-[220px]">
                    <SelectValue placeholder="Set stage…">
                      {form.pipelineStage ? getStageLabel(form.pipelineStage) : 'Set stage…'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {stageOptions.map(s => (
                      <SelectItem key={s.key} value={s.key} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {stageSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>

              {/* Profile status — insurance only, only when stage has sub-statuses */}
              {isInsurance && profileStatusOptions.length > 0 && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Status</span>
                    <Select value={form.profileStatus || ''} onValueChange={handleProfileStatusChange}>
                      <SelectTrigger className="h-7 text-xs min-w-[200px] max-w-[260px]">
                        <SelectValue placeholder="Select status…">
                          {form.profileStatus || 'Select status…'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {profileStatusOptions.map(s => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Profile status badge when no sub-statuses but one is set */}
              {isInsurance && profileStatusOptions.length === 0 && form.profileStatus && (
                <Badge variant="outline" className="text-[10px] h-7">
                  {form.profileStatus}
                </Badge>
              )}
            </div>
          )}

          {/* Row 3 — tab navigation */}
          <div className="flex gap-0 overflow-x-auto scrollbar-none">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-6">
          {isLoading || !form ? (
            <div className="space-y-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              {activeTab === 'dashboard'       && lead && <DashboardTab form={form} onField={handleField} onCheck={handleCheckField} isInsurance={isInsurance} lead={lead} isManager={isManager} pinId={id!} />}
              {activeTab === 'inspection_flow' && inspectionId && <InspectionFlowTab inspectionId={inspectionId} />}
              {activeTab === 'contract_builder' && isInsurance && <ContractBuilderTab />}
              {activeTab === 'financials'      && lead && <FinancialsTab form={form} onField={handleField} pinId={id!} isManager={isManager} isInsurance={isInsurance} lead={lead} />}
              {activeTab === 'communication'   && <CommunicationTab  form={form} onField={handleField} />}
              {activeTab === 'scope'           && <ScopeTab          form={form} onField={handleField} />}
              {activeTab === 'files'           && lead && (
                <FilesTab
                  leadId={id!}
                  canManage={
                    lead.userId === (profileData?.profile?.userId ?? '') ||
                    ['manager', 'admin', 'super_admin'].includes(profileData?.profile?.role ?? '')
                  }
                />
              )}

              {activeTab !== 'files' && activeTab !== 'inspection_flow' && activeTab !== 'contract_builder' && (
                <div className="mt-8 flex justify-end border-t pt-6">
                  <Button onClick={handleSave} disabled={saving} className="min-w-28">
                    {saving
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                      : <><Save className="h-4 w-4 mr-2" />Save Changes</>
                    }
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

interface FileRowProps {
  file: LeadFileRow;
  canManage: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

function LeadFileRow({
  file, canManage,
  isRenaming, renameValue, onRenameValueChange,
  onStartRename, onCommitRename, onCancelRename,
  onDelete,
}: FileRowProps) {
  const downloadPath = `/api/storage/objects${file.objectPath.replace(/^\/objects/, '')}`;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 text-muted-foreground">
        <LeadFileIcon mimeType={file.mimeType} />
      </div>

      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <Input
            className="h-7 text-sm py-0.5"
            value={renameValue}
            onChange={e => onRenameValueChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            autoFocus
          />
        ) : (
          <p className="text-sm font-medium truncate leading-snug">{file.fileName}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {file.uploaderName}
          {' · '}
          {new Date(file.createdAt).toLocaleDateString()}
          {' · '}
          {formatBytes(file.fileSize)}
        </p>
      </div>

      {canManage && !isRenaming && (
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <a
            href={downloadPath}
            download={file.fileName}
            className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
          <button
            className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Rename"
            onClick={onStartRename}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            title="Delete"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
