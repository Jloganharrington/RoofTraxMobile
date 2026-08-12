import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useParams, Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { 
  useTrialDetail, 
  useApproveTrial, 
  useRejectTrial, 
  useUpdateTrialStatus,
  useUpdateTrialNotes,
  useUploadDeliverable,
  useSendDeliverable
} from "@/hooks/use-trial-queue";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  Loader2, ArrowLeft, Building2, MapPin, AlertTriangle, 
  CheckCircle2, XCircle, Clock, UploadCloud, Download,
  Send, ExternalLink, FileText, Image as ImageIcon,
  DollarSign, History, ShieldCheck
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  paid: { label: "Needs Review", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  in_review: { label: "In Review", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  building: { label: "Building", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  ready: { label: "Ready to Deliver", color: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  delivered: { label: "Delivered", color: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300" },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function TrialQueueDetail() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  
  const { data, isLoading, refetch } = useTrialDetail(id);
  const approve = useApproveTrial();
  const reject = useRejectTrial();
  const setStatus = useUpdateTrialStatus();
  const saveNotes = useUpdateTrialNotes();
  const uploadDeliverable = useUploadDeliverable();
  const sendDeliverable = useSendDeliverable();

  // Local state for interactive elements
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [deliverableFile, setDeliverableFile] = useState<File | null>(null);
  
  // Checklist state
  const [checks, setChecks] = useState({
    contractor: false,
    notPa: false,
    inArea: false,
    realData: false,
    coverageConfirm: false,
    photoSet: false,
  });

  const allChecked = Object.values(checks).every(Boolean);

  // Sync notes from server
  const initialized = useRef(false);
  useEffect(() => {
    if (data?.submission && !initialized.current) {
      setNotes(data.submission.adminNotes || "");
      initialized.current = true;
      
      // Auto-transition paid -> in_review on first open
      if (data.submission.status === "paid") {
        setStatus.mutate({ id, status: "in_review" }, {
          onSuccess: () => refetch()
        });
      }
    }
  }, [data, id, setStatus, refetch]);

  const handleSaveNotes = () => {
    saveNotes.mutate({ id, notes }, {
      onSuccess: () => toast({ title: "Notes saved" }),
      onError: (e) => toast({ title: "Failed to save", description: e.message, variant: "destructive" })
    });
  };

  const handleApprove = () => {
    approve.mutate(id, {
      onSuccess: () => {
        toast({ title: "Submission approved" });
        refetch();
      },
      onError: (e) => toast({ title: "Approval failed", description: e.message, variant: "destructive" })
    });
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    reject.mutate({ id, reason: rejectReason }, {
      onSuccess: (res: any) => {
        toast({ title: "Submission rejected" });
        setRejectDialogOpen(false);
        if (res.refund && !res.refund.ok) {
          toast({ 
            title: "Manual Refund Required", 
            description: `Auto-refund failed: ${res.refund.detail}. Please refund manually in Stripe.`, 
            variant: "destructive",
            duration: 10000 
          });
        }
        refetch();
      },
      onError: (e) => toast({ title: "Rejection failed", description: e.message, variant: "destructive" })
    });
  };

  const handleUpload = () => {
    if (!deliverableFile) return;
    uploadDeliverable.mutate({ id, file: deliverableFile }, {
      onSuccess: () => {
        toast({ title: "Deliverable uploaded" });
        setDeliverableFile(null);
        refetch();
      },
      onError: (e) => toast({ title: "Upload failed", description: e.message, variant: "destructive" })
    });
  };

  const handleSend = () => {
    sendDeliverable.mutate(id, {
      onSuccess: () => {
        toast({ title: "Deliverable sent to customer" });
        refetch();
      },
      onError: (e) => toast({ title: "Failed to send", description: e.message, variant: "destructive" })
    });
  };

  if (isLoading || !data) {
    return (
      <Shell>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  const { submission, account, uploads, accountHistory, coverage, excludedZip } = data;
  const conf = STATUS_CONFIG[submission.status] || { label: submission.status, color: "bg-gray-100 text-gray-800" };
  const isReviewPhase = submission.status === "in_review" || submission.status === "paid";
  
  return (
    <Shell>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-3 text-muted-foreground hover:text-foreground">
          <Link href="/admin/trial-queue">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Queue
          </Link>
        </Button>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold tracking-tight">#{String(submission.sequenceNum).padStart(4, '0')}</h1>
              <Badge variant="outline" className={`text-xs font-semibold border-none ${conf.color}`}>
                {conf.label}
              </Badge>
              {excludedZip && (
                <Badge variant="destructive" className="text-xs">Excluded Zip Code</Badge>
              )}
            </div>
            <div className="text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" /> {account.companyName}
              <span className="text-border">•</span>
              <MapPin className="h-4 w-4" /> {submission.propertyAddress} ({submission.propertyCounty}, {submission.propertyState})
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 justify-end">
            {/* Status-driven Action Bar */}
            {isReviewPhase && (
              <>
                <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="gap-2">
                      <XCircle className="h-4 w-4" /> Reject & Refund
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reject Submission</DialogTitle>
                      <DialogDescription>
                        This will automatically issue a refund to the customer and mark the trial as rejected.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Rejection Reason (Internal)</Label>
                        <Textarea 
                          value={rejectReason} 
                          onChange={e => setRejectReason(e.target.value)} 
                          placeholder="Why was this rejected?"
                          rows={3}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
                      <Button variant="destructive" onClick={handleReject} disabled={reject.isPending || !rejectReason.trim()}>
                        {reject.isPending ? "Processing..." : "Confirm Rejection"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
                <Button 
                  onClick={handleApprove} 
                  disabled={!allChecked || approve.isPending}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <CheckCircle2 className="h-4 w-4" /> 
                  {approve.isPending ? "Approving..." : "Approve for Build"}
                </Button>
              </>
            )}

            {submission.status === "approved" && (
              <Button onClick={() => setStatus.mutate({ id, status: "building" })} disabled={setStatus.isPending} variant="secondary">
                Start Building
              </Button>
            )}

            {submission.status === "building" && submission.deliverableFileKey && (
              <Button onClick={() => setStatus.mutate({ id, status: "ready" })} disabled={setStatus.isPending} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> Mark Ready
              </Button>
            )}

            {submission.status === "building" && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button className="gap-2"><UploadCloud className="h-4 w-4" /> Upload Package</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Upload Completed Package</DialogTitle>
                    <DialogDescription>Select the finalized PDF package. This does not send it to the customer yet.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <Input type="file" accept="application/pdf" onChange={(e) => setDeliverableFile(e.target.files?.[0] || null)} />
                  </div>
                  <DialogFooter>
                    <Button onClick={handleUpload} disabled={!deliverableFile || uploadDeliverable.isPending}>
                      {uploadDeliverable.isPending ? "Uploading..." : "Upload File"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {submission.status === "ready" && (
              <Button onClick={handleSend} disabled={sendDeliverable.isPending} className="gap-2">
                <Send className="h-4 w-4" /> {sendDeliverable.isPending ? "Sending..." : "Send to Customer"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN - Primary Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Info */}
          <Card>
            <CardHeader>
              <CardTitle>Intake Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Property Description</h4>
                  <p className="text-sm">{submission.propertyDescription || "None provided"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Carrier Notes</h4>
                  <p className="text-sm">{submission.carrierNotes || "None provided"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Customer Goal</h4>
                  <p className="text-sm">{submission.customerGoal || "None provided"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Damage Description</h4>
                  <p className="text-sm">{submission.damageDescription || "None provided"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Media / Files */}
          <Card>
            <CardHeader>
              <CardTitle>Uploaded Evidence ({uploads.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {uploads.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-md border-dashed">No files uploaded</p>
              ) : (
                <ScrollArea className="h-[300px] border rounded-md p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {uploads.map((file: any) => {
                      const isImage = file.fileType.startsWith('image/');
                      return (
                        <a key={file.id} href={file.signedUrl} target="_blank" rel="noreferrer" className="group block relative aspect-square bg-muted rounded-md overflow-hidden border hover:border-primary transition-colors">
                          {isImage ? (
                            <img src={file.signedUrl} alt={file.fileName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center text-muted-foreground">
                              <FileText className="h-8 w-8 mb-2" />
                              <span className="text-xs truncate w-full px-1">{file.fileName}</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                            <ExternalLink className="h-6 w-6" />
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN - Meta, Notes, Checklist */}
        <div className="space-y-6">
          
          {/* Checklist (only active in review) */}
          {isReviewPhase && (
            <Card className="border-primary/20 shadow-sm bg-primary/5 dark:bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" /> Screening Checklist
                </CardTitle>
                <CardDescription>All items must be confirmed before approval.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start space-x-3">
                  <Checkbox id="c-1" checked={checks.contractor} onCheckedChange={(c) => setChecks({...checks, contractor: !!c})} />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor="c-1" className="cursor-pointer">Legitimate contractor</Label>
                    <p className="text-[11px] text-muted-foreground">License verifiable / online presence</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <Checkbox id="c-2" checked={checks.notPa} onCheckedChange={(c) => setChecks({...checks, notPa: !!c})} />
                  <Label htmlFor="c-2" className="cursor-pointer font-normal">Not a Public Adjuster firm</Label>
                </div>
                <div className="flex items-start space-x-3">
                  <Checkbox id="c-3" checked={checks.inArea} onCheckedChange={(c) => setChecks({...checks, inArea: !!c})} />
                  <Label htmlFor="c-3" className="cursor-pointer font-normal">Not in an excluded service area</Label>
                </div>
                <div className="flex items-start space-x-3">
                  <Checkbox id="c-4" checked={checks.realData} onCheckedChange={(c) => setChecks({...checks, realData: !!c})} />
                  <Label htmlFor="c-4" className="cursor-pointer font-normal">Real claim data (no test content)</Label>
                </div>
                <div className="flex items-start space-x-3">
                  <Checkbox id="c-5" checked={checks.coverageConfirm} onCheckedChange={(c) => setChecks({...checks, coverageConfirm: !!c})} />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor="c-5" className="cursor-pointer">AHJ coverage confirmed</Label>
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Current DB status: {coverage ? coverage.status.toUpperCase() : "UNKNOWN"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <Checkbox id="c-6" checked={checks.photoSet} onCheckedChange={(c) => setChecks({...checks, photoSet: !!c})} />
                  <Label htmlFor="c-6" className="cursor-pointer font-normal">Photo set sufficient for assessment</Label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Account Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Contact</span>
                <span className="font-medium text-right">{account.contactName}<br/><span className="text-xs font-normal text-muted-foreground">{account.phone}</span></span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">License</span>
                <span className="font-medium">{account.licenseNumber || "—"} ({account.licenseState || "—"})</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Size Band</span>
                <span className="font-medium">{account.companySizeBand || "—"} / {account.monthlyClaimBand || "—"}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Payment</span>
                <span className="font-medium flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5"/> {formatCurrency(submission.amountPaidCents)}</span>
              </div>
              
              {accountHistory.length > 1 && (
                <div className="pt-2">
                  <h4 className="font-medium text-xs text-muted-foreground mb-2 flex items-center gap-1.5 uppercase tracking-wider"><History className="h-3 w-3"/> Previous Submissions</h4>
                  <div className="space-y-2">
                    {accountHistory.filter((h:any) => h.id !== id).map((h:any) => (
                      <Link key={h.id} href={`/admin/trial-queue/${h.id}`} className="flex items-center justify-between group hover:bg-muted p-1.5 -mx-1.5 rounded transition-colors text-xs">
                        <span className="font-mono group-hover:underline">#{String(h.sequenceNum).padStart(4,'0')}</span>
                        <Badge variant="outline" className="text-[10px] uppercase h-5">{h.status}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Admin Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Admin Notes</CardTitle>
              <CardDescription>Internal scratchpad. Not visible to customer.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes about this trial..."
                className="min-h-[150px] resize-y text-sm bg-muted/50 border-muted-foreground/20 focus-visible:ring-muted-foreground/30"
              />
            </CardContent>
            <CardFooter>
              <Button variant="secondary" size="sm" className="w-full" onClick={handleSaveNotes} disabled={saveNotes.isPending}>
                {saveNotes.isPending ? "Saving..." : "Save Notes"}
              </Button>
            </CardFooter>
          </Card>
          
          {submission.deliverableFileKey && (
            <Card className="border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="bg-violet-100 dark:bg-violet-900 p-2 rounded-md">
                    <FileText className="h-5 w-5 text-violet-700 dark:text-violet-300" />
                  </div>
                  <div>
                    <h4 className="font-medium text-violet-900 dark:text-violet-100">Package Uploaded</h4>
                    <p className="text-xs text-violet-700/80 dark:text-violet-300/80 mt-1">
                      Ready for delivery or already delivered.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {submission.rejectReason && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-destructive flex items-center gap-2"><XCircle className="h-4 w-4"/> Rejection Reason</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-destructive/90">{submission.rejectReason}</p>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </Shell>
  );
}
