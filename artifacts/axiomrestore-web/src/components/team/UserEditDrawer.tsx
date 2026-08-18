import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useUpdateTeamUser,
  useRemoveTeamUser,
  useGetCurrentAuthUser,
  getListTeamUsersQueryKey,
  Role,
  Department,
  WorkflowAssignment,
} from "@workspace/api-client-react";
import type { TeamUser } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";

interface UserEditDrawerProps {
  user: TeamUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

function getInitials(firstName: string | null, lastName: string | null, email: string | null): string {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

function getRoleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    field_rep: "Field Rep",
    manager: "Manager",
    admin: "Admin",
    super_admin: "Super Admin",
  };
  return labels[role] ?? role;
}

function getDepartmentLabel(dept: Department): string {
  const labels: Record<Department, string> = {
    canvasser: "Canvasser",
    inspector_canvasser: "Inspector / Canvasser",
    office: "Office",
  };
  return labels[dept] ?? dept;
}

function getWorkflowLabel(wf: WorkflowAssignment): string {
  const labels: Record<WorkflowAssignment, string> = {
    retail: "Retail Only",
    insurance: "Insurance Only",
    insurance_retail: "Insurance & Retail",
  };
  return labels[wf] ?? wf;
}

export function UserEditDrawer({ user, open, onOpenChange, onDone }: UserEditDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: authEnvelope } = useGetCurrentAuthUser();
  const currentUserId = authEnvelope?.user?.id;

  const updateUser = useUpdateTeamUser();
  const removeUser = useRemoveTeamUser();

  const [role, setRole] = useState<Role>("field_rep");
  const [department, setDepartment] = useState<Department>("canvasser");
  const [workflowAssignment, setWorkflowAssignment] = useState<WorkflowAssignment>("insurance_retail");
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  // Sync form state whenever the selected user changes
  useEffect(() => {
    if (user) {
      setRole(user.role);
      setDepartment(user.department);
      setWorkflowAssignment(user.workflowAssignment);
    }
  }, [user]);

  const isSelf = !!currentUserId && !!user && currentUserId === user.id;
  const isDisabled = isSelf || updateUser.isPending;

  function handleSave() {
    if (!user) return;
    const changed: { role?: Role; department?: Department; workflowAssignment?: WorkflowAssignment } = {};
    if (role !== user.role) changed.role = role;
    if (department !== user.department) changed.department = department;
    if (workflowAssignment !== user.workflowAssignment) changed.workflowAssignment = workflowAssignment;

    if (Object.keys(changed).length === 0) {
      onOpenChange(false);
      return;
    }

    updateUser.mutate(
      { userId: user.id, data: changed },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTeamUsersQueryKey() });
          toast({ title: "User updated", description: "Changes saved successfully." });
          onOpenChange(false);
          onDone?.();
        },
        onError: () => {
          toast({ title: "Update failed", description: "Could not save changes.", variant: "destructive" });
        },
      }
    );
  }

  function handleRemoveConfirm() {
    if (!user) return;
    removeUser.mutate(
      { userId: user.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTeamUsersQueryKey() });
          toast({ title: "User removed", description: "User has been removed from the team." });
          setConfirmRemoveOpen(false);
          onOpenChange(false);
          onDone?.();
        },
        onError: () => {
          toast({ title: "Remove failed", description: "Could not remove user.", variant: "destructive" });
          setConfirmRemoveOpen(false);
        },
      }
    );
  }

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Unknown";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex flex-col gap-0 p-0 overflow-y-auto">
          {/* Header */}
          <SheetHeader className="p-6 border-b">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 flex-shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-lg font-bold uppercase">
                {user ? getInitials(user.firstName, user.lastName, user.email) : "?"}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base leading-tight">{fullName}</SheetTitle>
                <SheetDescription className="text-xs mt-0.5 truncate">{user?.email ?? ""}</SheetDescription>
              </div>
            </div>
            {isSelf && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 mt-3">
                You cannot edit your own role, department, or workflow assignment.
              </p>
            )}
          </SheetHeader>

          {/* Form */}
          <div className="flex-1 p-6 space-y-5">
            {/* Role */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Role</label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={isDisabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(Role).map((r) => (
                    <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Department */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Department</label>
              <Select value={department} onValueChange={(v) => setDepartment(v as Department)} disabled={isDisabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(Department).map((d) => (
                    <SelectItem key={d} value={d}>{getDepartmentLabel(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Workflow Assignment */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Workflow Assignment</label>
              <Select
                value={workflowAssignment}
                onValueChange={(v) => setWorkflowAssignment(v as WorkflowAssignment)}
                disabled={isDisabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(WorkflowAssignment).map((w) => (
                    <SelectItem key={w} value={w}>{getWorkflowLabel(w)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Save */}
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={isDisabled}
            >
              {updateUser.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              ) : "Save Changes"}
            </Button>

            {/* Permissions link */}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                onOpenChange(false);
                navigate(`/team/${user!.id}/permissions`);
              }}
            >
              <ShieldCheck className="h-4 w-4" />
              Manage Permissions
            </Button>
          </div>

          {/* Danger Zone */}
          {!isSelf && (
            <div className="mx-6 mb-6 border border-destructive/30 rounded-lg p-4 space-y-2">
              <p className="text-sm font-semibold text-destructive">Danger Zone</p>
              <p className="text-xs text-muted-foreground">
                Removing this user will revoke their access to the company workspace.
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => setConfirmRemoveOpen(true)}
                disabled={removeUser.isPending}
              >
                {removeUser.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Removing…</>
                ) : "Remove from Team"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm Remove Dialog */}
      <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{fullName}</strong> will lose access to the company workspace. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeUser.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveConfirm}
              disabled={removeUser.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeUser.isPending ? "Removing…" : "Yes, Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
