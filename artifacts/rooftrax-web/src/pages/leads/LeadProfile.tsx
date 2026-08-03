/**
 * Lead Profile — full detail view for a single door-knock lead/pin.
 * Six-tab navigation: Lead Dashboard · Financials · Insurance ·
 *   Communication · Selections & Scope · Files
 */
import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { Shell } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
} from 'lucide-react';
import { useGetLead, useUpdateLead, type FullLead } from '@/lib/claimHubApi';

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

type TabId =
  | 'dashboard'
  | 'financials'
  | 'insurance'
  | 'communication'
  | 'scope'
  | 'files';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard',     label: 'Lead Dashboard',      icon: <User className="h-4 w-4" /> },
  { id: 'financials',    label: 'Financials',           icon: <DollarSign className="h-4 w-4" /> },
  { id: 'insurance',     label: 'Insurance',            icon: <Shield className="h-4 w-4" /> },
  { id: 'communication', label: 'Communication',        icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'scope',         label: 'Selections & Scope',   icon: <Clipboard className="h-4 w-4" /> },
  { id: 'files',         label: 'Files',                icon: <FolderOpen className="h-4 w-4" /> },
];

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

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
  span2 = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, val: string) => void;
  type?: string;
  placeholder?: string;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <Label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder ?? label}
        className="h-9"
      />
    </div>
  );
}

function TextareaField({
  label,
  name,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, val: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="sm:col-span-2">
      <Label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder ?? label}
        rows={rows}
        className="resize-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form state shape (all nullable fields as strings for controlled inputs)
// ---------------------------------------------------------------------------

type FormState = {
  // Dashboard
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  owner2FirstName: string;
  owner2LastName: string;
  customerName: string;
  customerPhone: string;
  pipelineStage: string;
  notes: string;
  // Insurance
  insuranceCarrier: string;
  policyNumber: string;
  claimNumber: string;
  dateOfLoss: string;
  inspectionDate: string;
  adjusterName: string;
  adjusterPhone: string;
  adjusterEmail: string;
  adjusterMeetingDate: string;
  // Financials
  contractAmount: string;
  depositAmount: string;
  depositDate: string;
  depositPaymentMethod: string;
  deductibleAmount: string;
  rcvAmount: string;
  acvAmount: string;
  supplementAmount: string;
  finalPaymentAmount: string;
  // Scope
  contractScope: string;
  squareFootage: string;
  roofPitch: string;
  measurementVendor: string;
  measurementReportUrl: string;
  materialBrand: string;
  materialColor: string;
  materialStyle: string;
  // Communication (notes re-used)
  communicationNotes: string;
};

function toStr(v: string | null | undefined): string {
  return v ?? '';
}

// Convert an ISO timestamp to a date input value (yyyy-MM-dd)
function toDateInput(v: string | null | undefined): string {
  if (!v) return '';
  try {
    return new Date(v).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function initForm(lead: FullLead): FormState {
  return {
    ownerFirstName: toStr(lead.ownerFirstName),
    ownerLastName: toStr(lead.ownerLastName),
    ownerEmail: toStr(lead.ownerEmail),
    owner2FirstName: toStr(lead.owner2FirstName),
    owner2LastName: toStr(lead.owner2LastName),
    customerName: toStr(lead.customerName),
    customerPhone: toStr(lead.customerPhone),
    pipelineStage: toStr(lead.pipelineStage),
    notes: toStr(lead.notes),
    insuranceCarrier: toStr(lead.insuranceCarrier),
    policyNumber: toStr(lead.policyNumber),
    claimNumber: toStr(lead.claimNumber),
    dateOfLoss: toDateInput(lead.dateOfLoss),
    inspectionDate: toDateInput(lead.inspectionDate),
    adjusterName: toStr(lead.adjusterName),
    adjusterPhone: toStr(lead.adjusterPhone),
    adjusterEmail: toStr(lead.adjusterEmail),
    adjusterMeetingDate: toDateInput(lead.adjusterMeetingDate),
    contractAmount: toStr(lead.contractAmount),
    depositAmount: toStr(lead.depositAmount),
    depositDate: toDateInput(lead.depositDate),
    depositPaymentMethod: toStr(lead.depositPaymentMethod),
    deductibleAmount: toStr(lead.deductibleAmount),
    rcvAmount: toStr(lead.rcvAmount),
    acvAmount: toStr(lead.acvAmount),
    supplementAmount: toStr(lead.supplementAmount),
    finalPaymentAmount: toStr(lead.finalPaymentAmount),
    contractScope: toStr(lead.contractScope),
    squareFootage: toStr(lead.squareFootage),
    roofPitch: toStr(lead.roofPitch),
    measurementVendor: toStr(lead.measurementVendor),
    measurementReportUrl: toStr(lead.measurementReportUrl),
    materialBrand: toStr(lead.materialBrand),
    materialColor: toStr(lead.materialColor),
    materialStyle: toStr(lead.materialStyle),
    communicationNotes: toStr(lead.notes),
  };
}

// Tab field keys — used to build the partial patch payload per tab
const TAB_FIELDS: Record<TabId, (keyof FormState)[]> = {
  dashboard: [
    'ownerFirstName', 'ownerLastName', 'ownerEmail',
    'owner2FirstName', 'owner2LastName',
    'customerName', 'customerPhone',
    'pipelineStage', 'notes',
  ],
  financials: [
    'contractAmount', 'depositAmount', 'depositDate', 'depositPaymentMethod',
    'deductibleAmount', 'rcvAmount', 'acvAmount', 'supplementAmount', 'finalPaymentAmount',
  ],
  insurance: [
    'insuranceCarrier', 'policyNumber', 'claimNumber',
    'dateOfLoss', 'inspectionDate',
    'adjusterName', 'adjusterPhone', 'adjusterEmail', 'adjusterMeetingDate',
  ],
  communication: ['communicationNotes'],
  scope: [
    'contractScope', 'squareFootage', 'roofPitch',
    'measurementVendor', 'measurementReportUrl',
    'materialBrand', 'materialColor', 'materialStyle',
  ],
  files: [],
};

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function DashboardTab({
  form,
  onField,
}: {
  form: FormState;
  onField: (name: string, val: string) => void;
}) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Primary Owner">
        <Field label="First Name" name="ownerFirstName" value={form.ownerFirstName} onChange={onField} />
        <Field label="Last Name"  name="ownerLastName"  value={form.ownerLastName}  onChange={onField} />
        <Field label="Email"      name="ownerEmail"     value={form.ownerEmail}     onChange={onField} type="email" />
        <Field label="Phone"      name="customerPhone"  value={form.customerPhone}  onChange={onField} type="tel" />
      </FieldGroup>
      <FieldGroup title="Secondary Owner">
        <Field label="First Name" name="owner2FirstName" value={form.owner2FirstName} onChange={onField} />
        <Field label="Last Name"  name="owner2LastName"  value={form.owner2LastName}  onChange={onField} />
      </FieldGroup>
      <FieldGroup title="Pipeline">
        <Field label="Pipeline Stage" name="pipelineStage" value={form.pipelineStage} onChange={onField} placeholder="e.g. inspection_scheduled" />
        <Field label="Customer Name (display)" name="customerName" value={form.customerName} onChange={onField} />
      </FieldGroup>
      <FieldGroup title="Notes">
        <TextareaField label="Internal Notes" name="notes" value={form.notes} onChange={onField} rows={5} placeholder="Add notes about this lead…" />
      </FieldGroup>
    </div>
  );
}

function FinancialsTab({
  form,
  onField,
}: {
  form: FormState;
  onField: (name: string, val: string) => void;
}) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Contract">
        <Field label="Contract Amount ($)" name="contractAmount" value={form.contractAmount} onChange={onField} placeholder="0.00" />
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

function InsuranceTab({
  form,
  onField,
}: {
  form: FormState;
  onField: (name: string, val: string) => void;
}) {
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

function CommunicationTab({
  form,
  onField,
}: {
  form: FormState;
  onField: (name: string, val: string) => void;
}) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Notes & Activity">
        <TextareaField
          label="Communication Notes"
          name="communicationNotes"
          value={form.communicationNotes}
          onChange={onField}
          rows={10}
          placeholder="Log calls, emails, and other interactions here…"
        />
      </FieldGroup>
    </div>
  );
}

function ScopeTab({
  form,
  onField,
}: {
  form: FormState;
  onField: (name: string, val: string) => void;
}) {
  return (
    <div className="space-y-8">
      <FieldGroup title="Scope of Work">
        <TextareaField
          label="Contract Scope"
          name="contractScope"
          value={form.contractScope}
          onChange={onField}
          rows={5}
          placeholder="Describe the scope of work…"
        />
      </FieldGroup>
      <FieldGroup title="Measurements">
        <Field label="Square Footage"      name="squareFootage"       value={form.squareFootage}       onChange={onField} placeholder="e.g. 28 squares" />
        <Field label="Roof Pitch"          name="roofPitch"           value={form.roofPitch}           onChange={onField} placeholder="e.g. 4/12" />
        <Field label="Measurement Vendor"  name="measurementVendor"   value={form.measurementVendor}   onChange={onField} placeholder="EagleView, GAF QuickMeasure…" />
        <Field label="Measurement Report URL" name="measurementReportUrl" value={form.measurementReportUrl} onChange={onField} placeholder="https://…" span2 />
      </FieldGroup>
      <FieldGroup title="Material Selections">
        <Field label="Brand"  name="materialBrand" value={form.materialBrand} onChange={onField} placeholder="GAF, Owens Corning…" />
        <Field label="Color"  name="materialColor" value={form.materialColor} onChange={onField} placeholder="Charcoal, Barkwood…" />
        <Field label="Style"  name="materialStyle" value={form.materialStyle} onChange={onField} placeholder="Timberline HDZ, Duration…" />
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

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [form, setForm] = useState<FormState | null>(null);

  // Initialize form when data arrives (only once)
  useEffect(() => {
    if (data?.lead && !form) {
      setForm(initForm(data.lead));
    }
  }, [data, form]);

  function handleField(name: string, val: string) {
    setForm((prev) => (prev ? { ...prev, [name]: val } : prev));
  }

  async function handleSave() {
    if (!form) return;
    const keys = TAB_FIELDS[activeTab];
    if (keys.length === 0) return;

    // Build partial payload for this tab's fields only
    const payload: Record<string, string | null> = {};
    for (const k of keys) {
      const raw = form[k];
      // Map communicationNotes → notes on the server
      const serverKey = k === 'communicationNotes' ? 'notes' : k;
      payload[serverKey] = raw === '' ? null : raw;
    }

    try {
      await updateLead(payload);
      toast({ title: 'Saved', description: 'Lead profile updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save changes.', variant: 'destructive' });
    }
  }

  // Helpers
  const lead = data?.lead;
  const displayName = lead
    ? [lead.ownerFirstName, lead.ownerLastName].filter(Boolean).join(' ') ||
      lead.customerName ||
      'Unnamed Lead'
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
        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-background border-b px-4 sm:px-6">
          {/* Top bar */}
          <div className="flex items-center gap-3 py-3">
            <button
              onClick={() => navigate('/leads')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
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
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        WORKFLOW_COLORS[lead.workflow] ?? ''
                      }`}
                    >
                      {lead.workflow.charAt(0).toUpperCase() + lead.workflow.slice(1)}
                    </span>
                  )}
                  {lead?.pipelineStage && (
                    <Badge variant="outline" className="text-[10px]">
                      {lead.pipelineStage.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                {lead?.address && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />
                    {lead.address}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Tab navigation */}
          <div className="flex gap-0 overflow-x-auto scrollbar-none">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {tab.icon}
                {tab.label}
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
              {activeTab === 'dashboard'     && <DashboardTab     form={form} onField={handleField} />}
              {activeTab === 'financials'    && <FinancialsTab    form={form} onField={handleField} />}
              {activeTab === 'insurance'     && <InsuranceTab     form={form} onField={handleField} />}
              {activeTab === 'communication' && <CommunicationTab form={form} onField={handleField} />}
              {activeTab === 'scope'         && <ScopeTab         form={form} onField={handleField} />}
              {activeTab === 'files'         && <FilesTab />}

              {/* Save button (hidden on Files tab) */}
              {activeTab !== 'files' && (
                <div className="mt-8 flex justify-end border-t pt-6">
                  <Button onClick={handleSave} disabled={saving} className="min-w-28">
                    {saving ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                    ) : (
                      <><Save className="h-4 w-4 mr-2" />Save Changes</>
                    )}
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
