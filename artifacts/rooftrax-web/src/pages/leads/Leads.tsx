/**
 * Leads — table of all door-knock pins for the company.
 * Filterable by result type; links to the Claim Hub when an inspection exists.
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ExternalLink, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useGetLeads } from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESULT_LABELS: Record<string, string> = {
  no_answer: 'No Answer',
  no_appointment: 'No Appointment',
  appointment: 'Appointment',
};

const RESULT_COLORS: Record<string, string> = {
  no_answer: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  no_appointment: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  appointment: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
};

const CONTACT_LABELS: Record<string, string> = {
  no_soliciting: 'No Soliciting',
  priority_inspection: 'Priority',
  call_to_schedule: 'Call to Schedule',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Leads() {
  const { data, isLoading } = useGetLeads();
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');

  const leads = data?.leads ?? [];

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchesResult =
        resultFilter === 'all' || lead.doorKnockResult === resultFilter;

      const term = search.toLowerCase();
      const matchesSearch =
        !term ||
        (lead.address?.toLowerCase().includes(term) ?? false) ||
        (lead.customerName?.toLowerCase().includes(term) ?? false) ||
        (lead.retailData?.ownerName1?.toLowerCase().includes(term) ?? false);

      return matchesResult && matchesSearch;
    });
  }, [leads, search, resultFilter]);

  return (
    <Shell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
            <p className="text-sm text-muted-foreground">
              Door-knock contacts from the field.
            </p>
          </div>

          <div className="flex gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name or address…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={resultFilter} onValueChange={setResultFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All results" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All results</SelectItem>
                <SelectItem value="appointment">Appointment</SelectItem>
                <SelectItem value="no_appointment">No Appointment</SelectItem>
                <SelectItem value="no_answer">No Answer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Interests</TableHead>
                <TableHead>Rep</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24">Claim</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                    {leads.length === 0
                      ? 'No leads found. Field reps capture leads from the mobile app.'
                      : 'No leads match your filter.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((lead) => {
                  const name =
                    lead.customerName ||
                    lead.retailData?.ownerName1 ||
                    '—';
                  const interests = [
                    lead.retailData?.interestedRoof && 'Roof',
                    lead.retailData?.interestedSiding && 'Siding',
                    lead.retailData?.interestedWindows && 'Windows',
                    lead.retailData?.interestedDoors && 'Doors',
                  ].filter(Boolean);

                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="text-sm font-medium max-w-48 truncate">
                        {lead.address ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="space-y-0.5">
                          <div className="font-medium">{name}</div>
                          {lead.customerPhone && (
                            <div className="text-xs text-muted-foreground">{lead.customerPhone}</div>
                          )}
                          {lead.contactOutcome && (
                            <Badge variant="outline" className="text-[10px]">
                              {CONTACT_LABELS[lead.contactOutcome] ?? lead.contactOutcome}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {lead.doorKnockResult ? (
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              RESULT_COLORS[lead.doorKnockResult] ?? ''
                            }`}
                          >
                            {RESULT_LABELS[lead.doorKnockResult] ?? lead.doorKnockResult}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {interests.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {interests.map((i) => (
                              <Badge key={i as string} variant="secondary" className="text-[10px]">
                                {i as string}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {lead.repName ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {lead.createdAt
                          ? format(new Date(lead.createdAt), 'MMM d, yyyy')
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {lead.inspectionId ? (
                          <Link href={`/inspections/${lead.inspectionId}`}>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Open
                            </Button>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && (
          <p className="text-xs text-muted-foreground text-right">
            {filtered.length} of {leads.length} lead{leads.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </Shell>
  );
}
