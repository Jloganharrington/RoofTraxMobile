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
import { useState, useEffect, useMemo } from 'react';
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
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useGetLead, useUpdateLead, useGetMyProfile, useRecheckAhj, type FullLead } from '@/lib/claimHubApi';
import { InspectionFlowWizard } from '@/components/inspection/InspectionFlowWizard';
import {
  INSURANCE_STAGES,
  RETAIL_STAGES,
  STAGE_PROFILE_STATUSES,
  STAGE_DEFAULT_PROFILE_STATUS,
  getStageLabel,
} from '@/lib/pipelineStages';

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

type TabId = 'dashboard' | 'inspection_flow' | 'insurance' | 'financials' | 'communication' | 'scope' | 'files';

function buildTabs(isInsurance: boolean, hasInspection: boolean) {
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Lead Dashboard', icon: <User className="h-4 w-4" /> },
  ];
  if (hasInspection) {
    tabs.push({ id: 'inspection_flow', label: 'Inspection', icon: <FileText className="h-4 w-4" /> });
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
  // Financials
  contractAmount: string; depositAmount: string; depositDate: string; depositPaymentMethod: string;
  deductibleAmount: string; rcvAmount: string; acvAmount: string; supplementAmount: string; finalPaymentAmount: string;
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
    depositAmount:        toStr(lead.depositAmount),
    depositDate:          toDateStr(lead.depositDate),
    depositPaymentMethod: toStr(lead.depositPaymentMethod),
    deductibleAmount:     toStr(lead.deductibleAmount),
    rcvAmount:            toStr(lead.rcvAmount),
    acvAmount:            toStr(lead.acvAmount),
    supplementAmount:     toStr(lead.supplementAmount),
    finalPaymentAmount:   toStr(lead.finalPaymentAmount),
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
  financials:      ['contractAmount','depositAmount','depositDate','depositPaymentMethod','deductibleAmount','rcvAmount','acvAmount','supplementAmount','finalPaymentAmount'],
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
  form, onField, onCheck, isInsurance, lead,
}: {
  form: FormState;
  onField: (n: string, v: string) => void;
  onCheck: (n: string, v: boolean) => void;
  isInsurance: boolean;
  lead: FullLead;
}) {
  const workflowLabel = lead.workflow === 'insurance' ? 'Insurance' : 'Retail';
  const workflowColors = lead.workflow === 'insurance'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';

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

function InsuranceTab({ form, onField }: { form: FormState; onField: (n: string, v: string) => void }) {
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
    </div>
  );
}

function FinancialsTab({ form, onField }: { form: FormState; onField: (n: string, v: string) => void }) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Contract">
        <Field label="Contract Amount ($)" name="contractAmount"   value={form.contractAmount}   onChange={onField} placeholder="0.00" />
        <Field label="Deductible ($)"      name="deductibleAmount" value={form.deductibleAmount} onChange={onField} placeholder="0.00" />
      </FieldGroup>
      <FieldGroup title="Deposit">
        <Field label="Deposit Amount ($)"  name="depositAmount"        value={form.depositAmount}        onChange={onField} placeholder="0.00" />
        <Field label="Deposit Date"        name="depositDate"          value={form.depositDate}          onChange={onField} type="date" />
        <Field label="Payment Method"      name="depositPaymentMethod" value={form.depositPaymentMethod} onChange={onField} placeholder="Check, ACH, Credit Card…" span2 />
      </FieldGroup>
      <FieldGroup title="Insurance Settlement">
        <Field label="RCV Amount ($)"        name="rcvAmount"          value={form.rcvAmount}          onChange={onField} placeholder="0.00" />
        <Field label="ACV Amount ($)"        name="acvAmount"          value={form.acvAmount}          onChange={onField} placeholder="0.00" />
        <Field label="Supplement Amount ($)" name="supplementAmount"   value={form.supplementAmount}   onChange={onField} placeholder="0.00" />
        <Field label="Final Payment ($)"     name="finalPaymentAmount" value={form.finalPaymentAmount} onChange={onField} placeholder="0.00" />
      </FieldGroup>
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

function FilesTab() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground space-y-3">
      <FolderOpen className="h-10 w-10 opacity-30" />
      <p className="text-sm font-medium">File storage coming soon</p>
      <p className="text-xs max-w-xs">
        Contracts, measurement reports, signed documents, and photos will appear here once file management is wired up.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeadProfile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error } = useGetLead(id!);
  const { mutateAsync: updateLead, isPending: saving } = useUpdateLead(id!);
  const { data: profileData } = useGetMyProfile();

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
              {activeTab === 'dashboard'       && lead && <DashboardTab form={form} onField={handleField} onCheck={handleCheckField} isInsurance={isInsurance} lead={lead} />}
              {activeTab === 'inspection_flow' && inspectionId && <InspectionFlowTab inspectionId={inspectionId} />}
              {activeTab === 'insurance'       && isInsurance && <InsuranceTab  form={form} onField={handleField} />}
              {activeTab === 'financials'      && <FinancialsTab     form={form} onField={handleField} />}
              {activeTab === 'communication'   && <CommunicationTab  form={form} onField={handleField} />}
              {activeTab === 'scope'           && <ScopeTab          form={form} onField={handleField} />}
              {activeTab === 'files'           && <FilesTab />}

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
