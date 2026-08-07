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
  useMarkPmCommissionPaid,
  type CreateVendorExpenseInput,
  type UpdateVendorExpenseInput,
  useGetPinProfitability,
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

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------


type TabId = 'dashboard' | 'inspection_flow' | 'insurance' | 'financials' | 'communication' | 'scope' | 'files';

function buildTabs(isInsurance: boolean, hasInspection: boolean) {
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Lead Dashboard', icon: <User className="h-4 w-4" /> },
  ];
  if (hasInspection) {
    tabs.push({ id: 'inspection_flow', label: 'Proof Package Builder', icon: <FileText className="h-4 w-4" /> });
  }
  if (isInsurance) {
    tabs.push({ id: 'insurance', label: 'Insurance', icon: <Shield className="h-4 w-4" /> });
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
    customerPhone:        toStr(lead.customerPhone),
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
  insurance:       ['insuranceCarrier','policyNumber','claimNumber','dateOfLoss','inspectionDate','adjusterName','adjusterPhone','adjusterEmail','adjusterMeetingDate'],
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

function DashboardTab({
  form, onField, onCheck, isInsurance, lead, isManager,
}: {
  form: FormState;
  onField: (n: string, v: string) => void;
  onCheck: (n: string, v: boolean) => void;
  isInsurance: boolean;
  lead: FullLead;
  isManager: boolean;
}) {
  const workflowLabel = lead.workflow === 'insurance' ? 'Insurance' : 'Retail';
  const workflowColors = lead.workflow === 'insurance'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';

  const { data: sourcesData } = useGetLeadSources(lead.companyId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

      {/* ── Left: Property & Contact ─────────────────────────────────── */}
      <div className="space-y-6">

        {/* Photo + Address/AHJ/Type row */}
        <div className="flex gap-4 items-start">

          {/* Photo — half column */}
          <div className="w-1/2 shrink-0">
            {lead.photoUrl ? (
              <div className="rounded-xl overflow-hidden border aspect-video bg-muted">
                <img src={lead.photoUrl} alt="Property" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="rounded-xl border bg-muted/30 aspect-video flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <MapPin className="h-6 w-6 opacity-20" />
                <p className="text-xs">No photo</p>
              </div>
            )}
          </div>

          {/* Address + AHJ + Lead type */}
          <div className="flex-1 space-y-3 min-w-0 pt-0.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Address</p>
              <p className="text-sm text-foreground/80 leading-snug break-words">
                {lead.address ?? <span className="italic text-muted-foreground">No address</span>}
              </p>
            </div>

            {lead.ahjCheck?.jurisdiction && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">AHJ</p>
                <p className="text-sm text-foreground/80 leading-snug">{lead.ahjCheck.jurisdiction}</p>
              </div>
            )}

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Lead Type</p>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${workflowColors}`}>
                {workflowLabel}
              </span>
            </div>

            {/* ── File Handler Progression Tracker ── */}
            <div className="pt-2.5 border-t border-border/40 space-y-2">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">File Handlers</p>

              {/* Lead Source */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-0.5">Lead Source</p>
                {isManager ? (
                  <select
                    value={form.externalLeadSource}
                    onChange={e => onField('externalLeadSource', e.target.value)}
                    className="w-full text-[11px] border border-input rounded px-1.5 py-0.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Canvassing</option>
                    {(sourcesData?.leadSources ?? ["Angi's", 'Yelp', 'Call-In', 'Website']).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs font-medium">
                    {form.externalLeadSource || 'Canvassing'}
                  </p>
                )}
                {!form.externalLeadSource && lead.repName && (
                  <p className="text-[10px] text-muted-foreground">by {lead.repName}</p>
                )}
              </div>

              {/* Sales Rep */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-0.5">Sales Rep</p>
                <p className="text-xs font-medium">
                  {lead.repName ?? <span className="italic opacity-40 text-[11px]">—</span>}
                </p>
              </div>

              {/* Project Manager */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-0.5">Project Manager</p>
                {isManager ? (
                  <input
                    type="text"
                    value={form.projectManagerName}
                    onChange={e => onField('projectManagerName', e.target.value)}
                    placeholder="Assign PM…"
                    className="w-full text-[11px] border border-input rounded px-1.5 py-0.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <p className="text-xs font-medium">
                    {form.projectManagerName || <span className="italic opacity-40 text-[11px]">—</span>}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Non-owner occupied */}
        <div className="flex items-center gap-2">
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

        {form.nonOwnerOccupied && (
          <FieldGroup title="Mailing Address">
            <Field label="Street"  name="mailingAddress" value={form.mailingAddress} onChange={onField} span2 placeholder="123 Main St" />
            <Field label="City"    name="mailingCity"    value={form.mailingCity}    onChange={onField} placeholder="Dallas" />
            <Field label="State"   name="mailingState"   value={form.mailingState}   onChange={onField} placeholder="TX" />
            <Field label="ZIP"     name="mailingZip"     value={form.mailingZip}     onChange={onField} placeholder="75201" />
          </FieldGroup>
        )}

        <FieldGroup title="Primary Contact">
          <Field label="First Name" name="ownerFirstName" value={form.ownerFirstName} onChange={onField} />
          <Field label="Last Name"  name="ownerLastName"  value={form.ownerLastName}  onChange={onField} />
          <Field label="Email"      name="ownerEmail"     value={form.ownerEmail}     onChange={onField} type="email" />
          <Field label="Phone"      name="customerPhone"  value={form.customerPhone}  onChange={onField} type="tel" />
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
        </FieldGroup>

        {form.hasSecondOwner && (
          <FieldGroup title="Second Owner">
            <Field label="First Name" name="owner2FirstName" value={form.owner2FirstName} onChange={onField} />
            <Field label="Last Name"  name="owner2LastName"  value={form.owner2LastName}  onChange={onField} />
          </FieldGroup>
        )}
      </div>

      {/* ── Right: Lead Info ─────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Retail: appointment date (read-only, set by mobile) */}
        {lead.retailData?.appointmentDate && (
          <div className="rounded-xl border bg-card px-5 py-4 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Appointment</p>
            <p className="text-sm font-semibold">
              {new Date(lead.retailData.appointmentDate).toLocaleDateString('en-US', {
                weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
              })}
            </p>
          </div>
        )}

        {/* Retail: damage interests (read-only, set by mobile) */}
        {lead.retailData && (
          <FieldGroup title="Damage Interests">
            <div className="sm:col-span-2 flex flex-wrap gap-2">
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
            {lead.retailData.notes && (
              <div className="sm:col-span-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">
                {lead.retailData.notes}
              </div>
            )}
          </FieldGroup>
        )}
      </div>
    </div>
  );
}

function InsuranceTab({
  form,
  onField,
  pinId,
}: {
  form: FormState;
  onField: (n: string, v: string) => void;
  pinId: string;
}) {
  const { data: coData } = useListPinChangeOrders(pinId);
  const supplementCandidates = (coData?.changeOrders ?? []).filter(
    (co) => co.requiredToCompleteScope && !co.voidedAt,
  );

  return (
    <div className="space-y-8">
      <FieldGroup title="Policy">
        <Field label="Insurance Carrier" name="insuranceCarrier" value={form.insuranceCarrier} onChange={onField} placeholder="State Farm, Allstate…" />
        <Field label="Policy Number"     name="policyNumber"     value={form.policyNumber}     onChange={onField} />
        <Field label="Claim Number"      name="claimNumber"      value={form.claimNumber}      onChange={onField} />
        <Field label="Date of Loss"      name="dateOfLoss"       value={form.dateOfLoss}       onChange={onField} type="date" />
      </FieldGroup>
      <FieldGroup title="Inspection">
        <Field label="Inspection Date" name="inspectionDate" value={form.inspectionDate} onChange={onField} type="date" />
      </FieldGroup>
      <FieldGroup title="Adjuster">
        <Field label="Adjuster Name"         name="adjusterName"        value={form.adjusterName}        onChange={onField} />
        <Field label="Adjuster Phone"        name="adjusterPhone"       value={form.adjusterPhone}       onChange={onField} type="tel" />
        <Field label="Adjuster Email"        name="adjusterEmail"       value={form.adjusterEmail}       onChange={onField} type="email" />
        <Field label="Adjuster Meeting Date" name="adjusterMeetingDate" value={form.adjusterMeetingDate} onChange={onField} type="date" />
      </FieldGroup>

      {/* Supplement candidates — read-only; change orders marked as required
          to complete original scope are surfaced here for carrier pursuit. */}
      {supplementCandidates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Supplement Candidates</h3>
            <Badge className="bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 text-xs">
              {supplementCandidates.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The following change orders are marked as required to complete the original scope of work.
            These may be submitted to the carrier as supplement items for reimbursement.
          </p>
          <div className="space-y-2">
            {supplementCandidates.map((co) => (
              <div
                key={co.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
              >
                <div className="min-w-0">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCents(co.amountCents)}
                  </span>
                  {co.description && (
                    <span className="text-xs text-muted-foreground ml-2 truncate">
                      {co.description}
                    </span>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 ml-3 ${
                    co.status === 'approved'
                      ? 'border-green-500 text-green-600'
                      : 'border-amber-400 text-amber-600'
                  }`}
                >
                  {co.status === 'approved' ? 'Approved' : 'Pending approval'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
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

function InvoicingPanel({ pinId, isManager }: { pinId: string; isManager: boolean }) {
  const { toast } = useToast();

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

  const [showCreateInv, setShowCreateInv] = useState(false);
  const [cName,    setCName]    = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cType,    setCType]    = useState('initial_deposit');
  const [cDollars, setCDollars] = useState('');
  const [cNotes,   setCNotes]   = useState('');
  const [cError,   setCError]   = useState<string | null>(null);

  function resetCreateInv() {
    setCName(''); setCAddress(''); setCType('initial_deposit');
    setCDollars(''); setCNotes(''); setCError(null); setShowCreateInv(false);
  }

  async function handleCreateInvoice() {
    const cents = parseDollarToCents(cDollars);
    if (!cents)           { setCError('Enter a valid amount greater than $0.00'); return; }
    if (!cName.trim())    { setCError('Customer name is required');               return; }
    if (!cAddress.trim()) { setCError('Customer address is required');             return; }
    setCError(null);
    try {
      await createInvMutation.mutateAsync({
        pinId,
        data: {
          customerName: cName.trim(), customerAddress: cAddress.trim(),
          invoiceType:  cType as 'initial_deposit',
          amountCents:  cents, notes: cNotes || null,
        },
      });
      resetCreateInv();
      toast({ title: 'Invoice created' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create invoice.', variant: 'destructive' });
    }
  }

  const invPending = createInvMutation.isPending || deleteInvMutation.isPending ||
    sendInvMutation.isPending || markInvPaidMutation.isPending || voidInvMutation.isPending;

  const hasActivity = payments.length > 0 || invoices.length > 0;
  const isLoading   = paymentsLoading || invLoading;

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
            <Button size="sm" variant="outline" className="h-7 text-xs px-2"
              onClick={() => { setShowCreateInv(v => !v); setShowAddPayment(false); }}>
              <FileText className="h-3 w-3 mr-1" />Create Invoice
            </Button>
            <Button size="sm" className="h-7 text-xs px-2"
              onClick={() => { setShowAddPayment(v => !v); setShowCreateInv(false); }}>
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

      {/* Create-invoice inline form */}
      {showCreateInv && isManager && (
        <div className="border-b p-4 bg-muted/30 space-y-3">
          <p className="text-xs text-muted-foreground">Invoice number is auto-generated.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <select className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                value={cType} onChange={e => setCType(e.target.value)}>
                {INVOICE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input className="h-7 text-xs" placeholder="$0.00"
                value={cDollars} onChange={e => setCDollars(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Customer Name</Label>
              <Input className="h-7 text-xs" placeholder="Jane Smith"
                value={cName} onChange={e => setCName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Address</Label>
              <Input className="h-7 text-xs" placeholder="123 Main St"
                value={cAddress} onChange={e => setCAddress(e.target.value)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Notes (optional)</Label>
              <Input className="h-7 text-xs" placeholder="Reference…"
                value={cNotes} onChange={e => setCNotes(e.target.value)} />
            </div>
          </div>
          {cError && <p className="text-xs text-destructive">{cError}</p>}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetCreateInv}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleCreateInvoice}
              disabled={createInvMutation.isPending}>
              {createInvMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save Invoice
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
  key:      'leadAcquisitionCostCents' | 'referralFeeCents' | 'salesCommissionCents' | 'pmCommissionCents';
  label:    string;
  paidKey?: 'salesCommissionPaidDate' | 'pmCommissionPaidDate';
};

const COST_BREAKDOWN_FIELDS: CommissionField[] = [
  { key: 'leadAcquisitionCostCents', label: 'Lead Acquisition' },
  { key: 'referralFeeCents',         label: 'Referral Fee' },
  { key: 'salesCommissionCents',     label: 'Sales Commission', paidKey: 'salesCommissionPaidDate' },
  { key: 'pmCommissionCents',        label: 'PM Commission',    paidKey: 'pmCommissionPaidDate'   },
];

function CostBreakdownPanel({ pinId, isManager }: { pinId: string; isManager: boolean }) {
  const { toast } = useToast();
  const { data: leadData }         = useGetLead(pinId);
  const { data: profData }         = useGetPinProfitability(pinId);
  const updateMutation             = useUpdateCommissions();
  const salesMarkPaidMutation      = useMarkSalesCommissionPaid();
  const pmMarkPaidMutation         = useMarkPmCommissionPaid();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lead = leadData?.lead as any;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!lead) return;
    setDrafts({
      leadAcquisitionCostCents: lead.leadAcquisitionCostCents != null
        ? (lead.leadAcquisitionCostCents / 100).toFixed(2) : '',
      referralFeeCents: lead.referralFeeCents != null
        ? (lead.referralFeeCents / 100).toFixed(2) : '',
      salesCommissionCents: lead.salesCommissionCents != null
        ? (lead.salesCommissionCents / 100).toFixed(2) : '',
      pmCommissionCents: lead.pmCommissionCents != null
        ? (lead.pmCommissionCents / 100).toFixed(2) : '',
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
    const mutation = field.paidKey === 'salesCommissionPaidDate' ? salesMarkPaidMutation : pmMarkPaidMutation;
    try {
      await mutation.mutateAsync({ pinId });
      toast({ title: `${field.label} marked as paid` });
    } catch (err: unknown) {
      toast({ title: 'Error',
        description: (err as { message?: string })?.message ?? 'Failed to mark paid.',
        variant: 'destructive' });
    }
  }

  const p = profData?.profitability;
  const expensesCents = p?.totalExpenseCents ?? null;

  const commissionTotalCents = COST_BREAKDOWN_FIELDS.reduce((sum, f) => {
    const v = lead?.[f.key];
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);
  const totalCostCents = commissionTotalCents + (expensesCents ?? 0);

  return (
    <div className="rounded-lg border bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />
        <div>
          <h3 className="font-semibold text-sm">Cost Breakdown</h3>
          <p className="text-xs text-muted-foreground">Project expenses and commissions</p>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 divide-y">
        {COST_BREAKDOWN_FIELDS.map(field => {
          const paidDate  = field.paidKey ? lead?.[field.paidKey] : null;
          const amountSet = !!(lead?.[field.key]);
          const isPaid    = !!paidDate;

          return (
            <div key={field.key} className="flex items-center justify-between px-4 py-2.5 gap-3">
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
                    disabled={salesMarkPaidMutation.isPending || pmMarkPaidMutation.isPending}>
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

        {/* Invoices/Expenses — computed from profitability view */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm font-medium">Invoices/Expenses</span>
          <span className="text-sm tabular-nums font-semibold">
            {expensesCents != null ? formatCents(expensesCents) : '—'}
          </span>
        </div>

        {/* Total Costs */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
          <span className="text-sm font-bold">Total Costs</span>
          <span className="text-sm tabular-nums font-bold text-red-500">
            {formatCents(totalCostCents)}
          </span>
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

  const [editingContract, setEditingContract] = useState(false);
  const [contractDraft,   setContractDraft]   = useState(contractAmount);

  useEffect(() => {
    if (!editingContract) setContractDraft(contractAmount);
  }, [contractAmount, editingContract]);

  const contractCents  = parseDollarToCents(contractAmount.replace(/[$,\s]/g, '')) ??
    (contractAmount.trim() ? null : 0);
  const totalPayments  = p?.totalPaymentsCents ?? 0;
  const totalCosts     = p?.totalCostCents     ?? 0;
  const netProfit      = p?.netProfitCents      ?? 0;
  const balanceDue     = contractCents != null ? Math.max(0, contractCents - totalPayments) : null;

  // Both margins are server-computed from the pin_profitability view (migration 027).
  // projected uses expected_total_cents (insurance = GREATEST(contract,rcv), retail = contract).
  // Both return 0 from the view when the denominator is 0 — display only when > 0.
  const projectedMarginPct = (p?.projectedMarginPct ?? 0) > 0 || (p?.expectedTotalCents ?? 0) > 0
    ? (p?.projectedMarginPct ?? 0)
    : null;
  const cashMarginPct = (p?.totalPaymentsCents ?? 0) > 0
    ? (p?.cashMarginPct ?? 0)
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {/* Contract Value */}
      <div className="rounded-lg border bg-card border-l-[3px] border-l-green-500 p-4 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Contract Value</span>
          </div>
          <button className="text-muted-foreground hover:text-foreground"
            onClick={() => setEditingContract(v => !v)} title="Edit contract value">
            <Pencil className="h-3 w-3" />
          </button>
        </div>
        {editingContract ? (
          <Input
            className="h-7 text-sm mt-1"
            value={contractDraft}
            onChange={e => setContractDraft(e.target.value)}
            onBlur={() => { onField('contractAmount', contractDraft); setEditingContract(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onField('contractAmount', contractDraft); setEditingContract(false); }
              if (e.key === 'Escape') setEditingContract(false);
            }}
            autoFocus
            placeholder="0.00"
          />
        ) : (
          <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
            {contractAmount.trim()
              ? (contractCents != null ? formatCents(contractCents) : contractAmount)
              : '$0'}
          </p>
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

      {/* Net Profit */}
      <div className="rounded-lg border bg-card border-l-[3px] border-l-blue-500 p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
          <DollarSign className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Net Profit</span>
        </div>
        <p className={`text-2xl font-bold tabular-nums ${
          netProfit >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'
        }`}>
          {formatCents(netProfit)}
        </p>
        {(projectedMarginPct !== null || cashMarginPct !== null) && (
          <div className="space-y-0.5">
            {projectedMarginPct !== null && (
              <p className="text-xs text-blue-500">{projectedMarginPct.toFixed(1)}% projected margin</p>
            )}
            {cashMarginPct !== null && (
              <p className="text-xs text-blue-400">{cashMarginPct.toFixed(1)}% cash margin</p>
            )}
          </div>
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
}: {
  form: FormState;
  onField: (n: string, v: string) => void;
  pinId: string;
  isManager: boolean;
  isInsurance: boolean;
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

      {/* Zone 2 — Invoicing (left) + Cost Breakdown (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InvoicingPanel pinId={pinId} isManager={isManager} />
        <CostBreakdownPanel pinId={pinId} isManager={isManager} />
      </div>

      {/* Zone 3 — Expense Tracker, full width */}
      <ExpenseTrackerPanel
        pinId={pinId}
        isManager={isManager}
        onExportPdf={handleExportPdf}
        exportingPdf={exportingPdf}
      />

      {/* Zone 4 — Change Orders, full width */}
      <ChangeOrdersPanel pinId={pinId} isManager={isManager} isInsurance={isInsurance} />
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
              {activeTab === 'dashboard'       && lead && <DashboardTab form={form} onField={handleField} onCheck={handleCheckField} isInsurance={isInsurance} lead={lead} isManager={isManager} />}
              {activeTab === 'inspection_flow' && inspectionId && <InspectionFlowTab inspectionId={inspectionId} />}
              {activeTab === 'insurance'       && isInsurance && <InsuranceTab  form={form} onField={handleField} pinId={id!} />}
              {activeTab === 'financials'      && <FinancialsTab     form={form} onField={handleField} pinId={id!} isManager={isManager} isInsurance={isInsurance} />}
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

              {activeTab !== 'files' && activeTab !== 'inspection_flow' && (
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
