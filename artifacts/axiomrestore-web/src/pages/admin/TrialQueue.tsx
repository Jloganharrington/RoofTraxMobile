import { useState } from "react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { useTrialQueue, useAhjCoverage, useUpsertAhjCoverage } from "@/hooks/use-trial-queue";
import { formatDistanceToNow, format } from "date-fns";
import { Loader2, Search, Filter, AlertCircle, CheckCircle2, XCircle, Clock, MapPin, Building2, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  paid: { label: "Paid - Needs Review", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  in_review: { label: "In Review", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  building: { label: "Building", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  ready: { label: "Ready to Deliver", color: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  delivered: { label: "Delivered", color: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300" },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

function CoverageDialog() {
  const { data: coverageItems, isLoading } = useAhjCoverage();
  const upsert = useUpsertAhjCoverage();
  const { toast } = useToast();
  
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState<"covered" | "in_progress" | "none">("covered");
  const [codeCycle, setCodeCycle] = useState("");
  
  const handleUpsert = () => {
    if (!state.trim() || !county.trim()) {
      toast({ title: "Error", description: "State and county are required.", variant: "destructive" });
      return;
    }
    upsert.mutate(
      { state, county, status, codeCycle },
      {
        onSuccess: () => {
          toast({ title: "Coverage Updated", description: `${county}, ${state} has been saved.` });
          setState("");
          setCounty("");
          setCodeCycle("");
        },
        onError: (err) => {
          toast({ title: "Update Failed", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MapPin className="h-4 w-4" />
          Manage AHJ Coverage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>AHJ Coverage Directory</DialogTitle>
          <DialogDescription>
            Manage coverage status for states and counties to guide the approval process.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-4 bg-muted/30 p-4 rounded-lg border">
            <h4 className="font-semibold text-sm">Add / Update Coverage</h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>State</Label>
                <Input value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="e.g. TX" maxLength={2} />
              </div>
              <div className="space-y-1">
                <Label>County</Label>
                <Input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="e.g. Harris" />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="covered">Covered</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="none">Not Covered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Code Cycle (Optional)</Label>
                <Input value={codeCycle} onChange={(e) => setCodeCycle(e.target.value)} placeholder="e.g. 2021 IBC" />
              </div>
              <Button className="w-full" onClick={handleUpsert} disabled={upsert.isPending}>
                {upsert.isPending ? "Saving..." : "Save Coverage"}
              </Button>
            </div>
          </div>
          
          <div className="md:col-span-2">
            <div className="rounded-md border h-[400px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Code Cycle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : coverageItems?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                        No coverage entries found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    coverageItems?.map((item) => (
                      <TableRow key={item.id} className="cursor-pointer" onClick={() => {
                        setState(item.state);
                        setCounty(item.county);
                        setStatus(item.status);
                        setCodeCycle(item.codeCycle || "");
                      }}>
                        <TableCell className="font-medium">{item.county}, {item.state}</TableCell>
                        <TableCell>
                          <Badge variant={item.status === 'covered' ? 'default' : item.status === 'in_progress' ? 'secondary' : 'destructive'} className="text-xs">
                            {item.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.codeCycle || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TrialQueue() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  
  const { data: queue, isLoading } = useTrialQueue(statusFilter);

  const filtered = (queue || []).filter((item) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!item.company.toLowerCase().includes(q) && 
          !item.email.toLowerCase().includes(q) &&
          !item.county.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  return (
    <Shell>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proof Package Control Room</h1>
          <p className="text-muted-foreground mt-1">Review, approve, and deliver paid trial submissions.</p>
        </div>
        <div>
          <CoverageDialog />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search company, email, or county..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder="Filter Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="paid">Needs Review (Paid)</SelectItem>
                  <SelectItem value="in_review">In Review</SelectItem>
                  <SelectItem value="approved">Approved / Queue</SelectItem>
                  <SelectItem value="building">Building</SelectItem>
                  <SelectItem value="ready">Ready to Deliver</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seq</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Age (Days)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No submissions found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((item) => {
                  const conf = STATUS_CONFIG[item.status] || { label: item.status, color: "bg-gray-100 text-gray-800" };
                  const isStale = item.ageDays > 2 && !['delivered', 'rejected', 'ready'].includes(item.status);
                  
                  return (
                    <TableRow key={item.id} className="group relative">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{String(item.sequenceNum).padStart(4, '0')}
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/trial-queue/${item.id}`} className="font-medium hover:underline focus:outline-none focus-visible:underline after:absolute after:inset-0">
                          {item.company}
                        </Link>
                        <div className="text-xs text-muted-foreground">{item.email}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.county}, {item.state}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs font-semibold border-none ${conf.color}`}>
                          {conf.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(item.submittedAt), "MMM d, yyyy h:mm a")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`inline-flex items-center gap-1.5 text-sm font-medium ${isStale ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                          {isStale && <Clock className="h-3.5 w-3.5" />}
                          {item.ageDays}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </Shell>
  );
}
