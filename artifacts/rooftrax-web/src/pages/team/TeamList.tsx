import { useState } from "react";
import {
  useListTeamUsers,
  useGetAdminStats,
  getListTeamUsersQueryKey,
  Role,
  Department,
  WorkflowAssignment,
} from "@workspace/api-client-react";
import type { TeamUser } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Shell } from "@/components/layout/Shell";
import { UserEditDrawer } from "@/components/team/UserEditDrawer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import {
  Loader2, Users, ShieldAlert, FileText, CheckCircle2, Pencil, Search, ShieldCheck,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<Role, string> = {
  field_rep: "Field Rep",
  manager: "Manager",
  admin: "Admin",
  super_admin: "Super Admin",
};

const ROLE_COLORS: Record<Role, string> = {
  field_rep: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  manager: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  admin: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  super_admin: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

const DEPT_LABELS: Record<Department, string> = {
  canvasser: "Canvasser",
  inspector_canvasser: "Inspector",
  office: "Office",
};

const WORKFLOW_LABELS: Record<WorkflowAssignment, string> = {
  retail: "Retail",
  insurance: "Insurance",
  insurance_retail: "Ins + Retail",
};

// Role filter chips — "all" is a special sentinel value
const ROLE_FILTERS: { label: string; value: Role | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Field Rep", value: "field_rep" },
  { label: "Manager", value: "manager" },
  { label: "Admin", value: "admin" },
  { label: "Super Admin", value: "super_admin" },
];

function getInitials(firstName: string | null, lastName: string | null, email: string | null): string {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TeamList() {
  const { data: teamEnv, isLoading: isTeamLoading } = useListTeamUsers();
  const { data: statsEnv } = useGetAdminStats();
  const [, navigate] = useLocation();

  const users: TeamUser[] = teamEnv?.users ?? [];
  const stats = statsEnv?.stats;

  // Search + role filter state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");

  // Drawer state
  const [drawerUser, setDrawerUser] = useState<TeamUser | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(user: TeamUser) {
    setDrawerUser(user);
    setDrawerOpen(true);
  }

  // Client-side filtering
  const filtered = users.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  return (
    <Shell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Team Management</h1>
        <p className="text-muted-foreground">Oversee reps and manage roles, departments, and workflow assignments.</p>
      </div>

      {/* Stat cards */}
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <Users className="h-6 w-6 text-primary mb-2" />
            <div className="text-3xl font-bold">{stats?.fieldRepCount ?? 0}</div>
            <div className="text-sm text-muted-foreground">Field Reps</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <CheckCircle2 className="h-6 w-6 text-green-500 mb-2" />
            <div className="text-3xl font-bold">{stats?.totalPins ?? 0}</div>
            <div className="text-sm text-muted-foreground">Total Pins</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <ShieldAlert className="h-6 w-6 text-amber-500 mb-2" />
            <div className="text-3xl font-bold">{stats?.insurancePins ?? 0}</div>
            <div className="text-sm text-muted-foreground">Insurance Pins</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <FileText className="h-6 w-6 text-blue-500 mb-2" />
            <div className="text-3xl font-bold">{stats?.retailPins ?? 0}</div>
            <div className="text-sm text-muted-foreground">Retail Pins</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="flex-1">Team Members</CardTitle>
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          {/* Role filter chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ROLE_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRoleFilter(value)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  roleFilter === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Pins</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isTeamLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    {users.length === 0 ? "No team members found." : "No members match the current filter."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((user) => {
                  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
                  return (
                    <TableRow key={user.id}>
                      {/* Avatar + name */}
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold uppercase">
                            {getInitials(user.firstName, user.lastName, user.email)}
                          </div>
                          <span className="font-medium text-sm whitespace-nowrap">{fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{user.email ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {format(new Date(user.joinedAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{user.pinCount}</Badge>
                      </TableCell>
                      {/* Role badge */}
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${ROLE_COLORS[user.role]}`}>
                          {ROLE_LABELS[user.role]}
                        </span>
                      </TableCell>
                      {/* Department badge */}
                      <TableCell>
                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                          {DEPT_LABELS[user.department]}
                        </Badge>
                      </TableCell>
                      {/* Workflow badge */}
                      <TableCell>
                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                          {WORKFLOW_LABELS[user.workflowAssignment]}
                        </Badge>
                      </TableCell>
                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Manage permissions"
                            onClick={() => navigate(`/team/${user.id}/permissions`)}
                          >
                            <ShieldCheck className="h-4 w-4" />
                            <span className="sr-only">Manage permissions</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Edit user"
                            onClick={() => openDrawer(user)}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit user</span>
                          </Button>
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

      <UserEditDrawer
        user={drawerUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </Shell>
  );
}
