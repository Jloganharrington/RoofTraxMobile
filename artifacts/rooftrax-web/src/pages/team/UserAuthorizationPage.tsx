import { useState } from "react";
import { useListTeamUsers, Role } from "@workspace/api-client-react";
import type { TeamUser } from "@workspace/api-client-react";
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
import { Loader2, Check, Minus, Pencil } from "lucide-react";

// ---------------------------------------------------------------------------
// Permissions matrix definition (derived from api-server/src/lib/permissions.ts)
// ---------------------------------------------------------------------------

const ROLE_COLUMNS: { role: Role; label: string }[] = [
  { role: "field_rep", label: "Field Rep" },
  { role: "manager", label: "Manager" },
  { role: "admin", label: "Admin" },
  { role: "super_admin", label: "Super Admin" },
];

interface Capability {
  label: string;
  /** Which roles fully have this capability */
  grantedTo: Role[];
  /** Roles with partial access — rendered with a note */
  partialTo?: Role[];
  partialNote?: string;
}

const CAPABILITIES: Capability[] = [
  {
    label: "Manage team members",
    grantedTo: ["manager", "admin", "super_admin"],
  },
  {
    label: "Delete pins",
    grantedTo: ["manager", "admin", "super_admin"],
  },
  {
    label: "Change workflow assignment",
    // Admins & super_admins can change anyone's; managers can change field reps only.
    grantedTo: ["admin", "super_admin"],
    partialTo: ["manager"],
    partialNote: "Field reps only",
  },
  {
    label: "Access inspection module",
    // super_admin always; others only when their department is inspector_canvasser.
    grantedTo: ["super_admin"],
    partialTo: ["field_rep", "manager", "admin"],
    partialNote: "Inspector / Canvasser dept",
  },
];

// ---------------------------------------------------------------------------
// Role helpers
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

function getInitials(firstName: string | null, lastName: string | null, email: string | null): string {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

// ---------------------------------------------------------------------------
// Permissions matrix component
// ---------------------------------------------------------------------------

function PermissionsMatrix() {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Permissions Matrix</CardTitle>
        <p className="text-sm text-muted-foreground">
          What each role can do across the platform.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-t overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Capability</TableHead>
                {ROLE_COLUMNS.map(({ role, label }) => (
                  <TableHead key={role} className="text-center min-w-[120px]">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[role]}`}>
                      {label}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CAPABILITIES.map((cap) => (
                <TableRow key={cap.label}>
                  <TableCell className="font-medium text-sm">{cap.label}</TableCell>
                  {ROLE_COLUMNS.map(({ role }) => {
                    const granted = cap.grantedTo.includes(role);
                    const partial = cap.partialTo?.includes(role);
                    return (
                      <TableCell key={role} className="text-center">
                        {granted ? (
                          <span className="inline-flex flex-col items-center gap-0.5">
                            <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
                          </span>
                        ) : partial ? (
                          <span className="inline-flex flex-col items-center gap-0.5" title={cap.partialNote}>
                            <Check className="h-4 w-4 text-amber-500" strokeWidth={2.5} />
                            {cap.partialNote && (
                              <span className="text-[10px] text-muted-foreground leading-tight max-w-[90px] text-center">
                                {cap.partialNote}
                              </span>
                            )}
                          </span>
                        ) : (
                          <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Users by role component
// ---------------------------------------------------------------------------

interface UsersByRoleProps {
  users: TeamUser[];
  onEdit: (user: TeamUser) => void;
}

function UsersByRole({ users, onEdit }: UsersByRoleProps) {
  // Group users by role, in role-rank order
  const grouped = ROLE_COLUMNS.map(({ role, label }) => ({
    role,
    label,
    members: users.filter((u) => u.role === role),
  })).filter((g) => g.members.length > 0);

  if (grouped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No team members found.
      </p>
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
          Role-based permissions and team access levels.
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
