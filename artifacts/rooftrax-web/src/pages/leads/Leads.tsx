/**
 * All Leads — unified list of retail pins, insurance pins, and inspection
 * claims across all three pipelines.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import { format } from "date-fns";
import { useGetLeads, type UnifiedLead } from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PIPELINE_CONFIG: Record<
  string,
  { label: string; colors: string }
> = {
  retail: {
    label: 'Retail',
    colors: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  insurance: {
    label: 'Insurance',
    colors: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  project: {
    label: 'Project',
    colors: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  },
};

type FilterTab = 'all' | 'retail' | 'insurance' | 'project';

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'retail',    label: 'Retail' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'project',   label: 'Project' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Leads() {
  const { data, isLoading } = useGetLeads();
  const [, navigate] = useLocation();
  const [search, setSearch]       = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const leads: UnifiedLead[] = data?.leads ?? [];

  // Demo leads filter (persistent across page loads, synced with pipeline pages)
  const [hideDemos, setHideDemos] = useState(
    () => localStorage.getItem('rt_hide_demos') === 'true',
  );
  const visibleLeads = hideDemos ? leads.filter((l) => !l.isDemo) : leads;
  const demoCount = leads.filter((l) => l.isDemo).length;

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return visibleLeads.filter((lead) => {
      const matchesPipeline =
        activeTab === 'all' || lead.pipeline === activeTab;

      const matchesSearch =
        !term ||
        (lead.name?.toLowerCase().includes(term) ?? false) ||
        (lead.address?.toLowerCase().includes(term) ?? false) ||
        (lead.stage?.toLowerCase().includes(term) ?? false);

      return matchesPipeline && matchesSearch;
    });
  }, [visibleLeads, search, activeTab]);

  // Count per tab (from visible leads only)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: visibleLeads.length };
    for (const lead of visibleLeads) {
      c[lead.pipeline] = (c[lead.pipeline] ?? 0) + 1;
    }
    return c;
  }, [visibleLeads]);

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">All Leads</h1>
            <p className="text-sm text-muted-foreground">
              Retail, insurance, and project pipeline leads in one list.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Hide demo toggle */}
            {demoCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={hideDemos}
                  onChange={(e) => {
                    setHideDemos(e.target.checked);
                    localStorage.setItem('rt_hide_demos', String(e.target.checked));
                  }}
                  className="rounded border-border"
                />
                Hide demo
                <span className="text-[10px] tabular-nums bg-muted px-1.5 py-0.5 rounded-full">
                  {demoCount}
                </span>
              </label>
            )}
            <div className="relative w-full md:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, address, or stage…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Pipeline filter tabs */}
        <div className="flex gap-1 border-b">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {tab.label}
              {counts[tab.id] !== undefined && (
                <span className="ml-1.5 text-[11px] font-normal opacity-60">
                  {counts[tab.id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Rep</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    {leads.length === 0
                      ? 'No leads yet. Field reps drop pins from the mobile app.'
                      : 'No leads match your filter.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((lead) => {
                  const pipelineCfg = PIPELINE_CONFIG[lead.pipeline] ?? {
                    label: lead.pipeline,
                    colors: 'bg-zinc-100 text-zinc-600',
                  };

                  return (
                    <TableRow
                      key={`${lead.recordType}-${lead.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(lead.detailPath)}
                    >
                      {/* Name */}
                      <TableCell className="text-sm font-medium">
                        <div className="space-y-0.5">
                          <div>{lead.name ?? <span className="text-muted-foreground italic">—</span>}</div>
                          {lead.phone && (
                            <div className="text-xs text-muted-foreground">{lead.phone}</div>
                          )}
                        </div>
                      </TableCell>

                      {/* Address */}
                      <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                        {lead.address ?? '—'}
                      </TableCell>

                      {/* Pipeline badge */}
                      <TableCell>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${pipelineCfg.colors}`}
                        >
                          {pipelineCfg.label}
                        </span>
                      </TableCell>

                      {/* Stage */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {lead.stage}
                      </TableCell>

                      {/* Rep */}
                      <TableCell className="text-sm text-muted-foreground">
                        {lead.repName ?? '—'}
                      </TableCell>

                      {/* Date */}
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {lead.createdAt
                          ? format(new Date(lead.createdAt), 'MMM d, yyyy')
                          : '—'}
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
