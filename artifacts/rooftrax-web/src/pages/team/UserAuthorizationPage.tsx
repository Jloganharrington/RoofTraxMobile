import { useMemo, useState } from "react";
import { useListTeamUsers } from "@workspace/api-client-react";
import type { TeamUser } from "@workspace/api-client-react";
import {
  PERMISSION_REGISTRY,
  roleRank,
} from "@workspace/authz";
import type { PermissionEntry, Role } from "@workspace/authz";
import { Shell } from "@/components/layout/Shell";
import { UserEditDrawer } from "@/components/team/UserEditDrawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Check, Minus, AlertCircle, ChevronDown, ChevronRight, Pencil, Search } from "lucide-react";

// ---------------------------------------------------------------------------
// Role columns
// ---------------------------------------------------------------------------

const ROLE_COLUMNS: { role: Role; label: string }[] = [
  { role: "field_rep",   label: "Field Rep" },
  { role: "manager",     label: "Manager" },
  { role: "admin",       label: "Admin" },
  { role: "super_admin", label: "Super Admin" },
];

const ROLE_COLORS: Record<Role, string> = {
  field_rep:   "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  manager:     "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  admin:       "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  super_admin: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

// ---------------------------------------------------------------------------
// Access level helper — reads DefaultResolution directly (no context needed)
// ---------------------------------------------------------------------------

type AccessLevel = "full" | "partial" | "none";

function getAccessLevel(entry: PermissionEntry, role: Role): AccessLevel {
  const p = entry.default;
  if (p.kind === "selfOnly") return "full";
  if (p.kind === "minRole")   return roleRank(role) >= roleRank(p.minRole) ? "full" : "none";
  if (p.kind === "ownerOrRole") {
    if (roleRank(role) >= roleRank(p.minRole)) return "full";
    return "partial"; // field_rep can access their own resource
  }
  return "none";
}

function AccessIcon({ level }: { level: AccessLevel }) {
  if (level === "full")
    return <Check className="h-4 w-4 text-emerald-600 mx-auto" strokeWidth={2.5} />;
  if (level === "partial")
    return (
      <span className="inline-flex flex-col items-center gap-0.5" title="Owner access only">
        <AlertCircle className="h-4 w-4 text-amber-500 mx-auto" strokeWidth={2} />
        <span className="text-[9px] text-muted-foreground leading-tight">Owner</span>
      </span>
    );
  return <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
}

// ---------------------------------------------------------------------------
// Domain section
// ---------------------------------------------------------------------------

interface DomainSectionProps {
  domain: string;
  entries: PermissionEntry[];
}

function DomainSection({ domain, entries }: DomainSectionProps) {
  const [open, setOpen] = useState(entries.length <= 6);
  return (
    <div className="border rounded-md mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        <span className="font-mono text-sm font-semibold text-foreground">{domain}</span>
        <Badge variant="secondary" className="ml-1 text-xs">{entries.length}</Badge>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="min-w-[220px] py-2 text-xs">Key</TableHead>
                <TableHead className="min-w-[280px] py-2 text-xs">Description</TableHead>
                {ROLE_COLUMNS.map(({ role, label }) => (
                  <TableHead key={role} className="text-center min-w-[90px] py-2 text-xs">
                    <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${ROLE_COLORS[role]}`}>
                      {label}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.key}>
                  <TableCell className="font-mono text-xs text-muted-foreground py-2">
                    {entry.key}
                  </TableCell>
                  <TableCell className="text-xs py-2">{entry.label}</TableCell>
                  {ROLE_COLUMNS.map(({ role }) => (
                    <TableCell key={role} className="text-center py-2">
                      <AccessIcon level={getAccessLevel(entry, role)} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions matrix — live from the registry
// ---------------------------------------------------------------------------

function PermissionsMatrix() {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();

  const byDomain = useMemo(() => {
    const filtered = PERMISSION_REGISTRY.filter(
      (e) =>
        !q ||
        e.key.toLowerCase().includes(q) ||
        e.domain.toLowerCase().includes(q) ||
        e.label.toLowerCase().includes(q),
    );
    const map = new Map<string, PermissionEntry[]>();
    for (const e of filtered) {
      const arr = map.get(e.domain) ?? [];
      arr.push(e);
      map.set(e.domain, arr);
    }
    return map;
  }, [q]);

  const totalFiltered = useMemo(
    () => [...byDomain.values()].reduce((n, arr) => n + arr.length, 0),
    [byDomain],
  );

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>Permissions Registry</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {totalFiltered} of {PERMISSION_REGISTRY.length} keys across {byDomain.size} domain{byDomain.size !== 1 ? "s" : ""}.
              Live from <code className="text-xs">@workspace/authz</code> — no manual upkeep required.
            </p>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Filter by key or domain…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 text-sm h-9"
            />
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
            Full access
          </span>
          <span className="flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} />
            Owner only
          </span>
          <span className="flex items-center gap-1">
            <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />
            No access
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {byDomain.size === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No matching permissions.</p>
        ) : (
          [...byDomain.entries()].map(([domain, entries]) => (
            <DomainSection key={domain} domain={domain} entries={entries} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(firstName: string | null, lastName: string | null, email: string | null): string {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

// ---------------------------------------------------------------------------
// Users by role component
// ---------------------------------------------------------------------------

interface UsersByRoleProps {
  users: TeamUser[];
  onEdit: (user: TeamUser) => void;
}

function UsersByRole({ users, onEdit }: UsersByRoleProps) {
  const grouped = ROLE_COLUMNS.map(({ role, label }) => ({
    role,
    label,
    members: users.filter((u) => u.role === role),
  })).filter((g) => g.members.length > 0);

  if (grouped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">No team members found.</p>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(({ role, label, members }) => (
        <Card key={role}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${ROLE_COLORS[role]}`}>
                {label}
              </span>
              <span className="text-sm text-muted-foreground">
                {members.length} {members.length === 1 ? "member" : "members"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-t divide-y">
              {members.map((user) => {
                const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown";
                return (
                  <div key={user.id} className="flex items-center gap-4 px-6 py-3">
                    <div className="h-9 w-9 flex-shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold uppercase">
                      {getInitials(user.firstName, user.lastName, user.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fullName}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 flex-shrink-0"
                      onClick={() => onEdit(user)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UserAuthorizationPage() {
  const { data: teamEnv, isLoading } = useListTeamUsers();
  const users = teamEnv?.users ?? [];
  const [drawerUser, setDrawerUser] = useState<TeamUser | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(user: TeamUser) {
    setDrawerUser(user);
    setDrawerOpen(true);
  }

  return (
    <Shell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">User Authorization</h1>
        <p className="text-muted-foreground">
          Role-based permissions and team access levels — sourced live from the permission registry.
        </p>
      </div>

      <PermissionsMatrix />

      <div className="mb-4">
        <h2 className="text-xl font-semibold">Team Members by Role</h2>
        <p className="text-sm text-muted-foreground">Edit a member's role, department, or workflow assignment.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <UsersByRole users={users} onEdit={openDrawer} />
      )}

      <UserEditDrawer
        user={drawerUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </Shell>
  );
}

