import { useState } from "react";
import { useListTeamUsers, useGetAdminStats, useUpdateTeamUser, useRemoveTeamUser, getListTeamUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Shell } from "@/components/layout/Shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users, UserMinus, ShieldAlert, FileText, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Role } from "@workspace/api-client-react";

export default function TeamList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: teamEnv, isLoading: isTeamLoading } = useListTeamUsers();
  const { data: statsEnv } = useGetAdminStats();
  
  const updateUser = useUpdateTeamUser();
  const removeUser = useRemoveTeamUser();

  const users = teamEnv?.users || [];
  const stats = statsEnv?.stats;

  const handleRoleChange = (userId: string, newRole: Role) => {
    updateUser.mutate(
      { userId, data: { role: newRole } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTeamUsersQueryKey() });
          toast({ title: "Role updated", description: "User role has been changed." });
        },
        onError: () => {
          toast({ title: "Update failed", description: "Could not change role.", variant: "destructive" });
        }
      }
    );
  };

  const handleRemove = (userId: string) => {
    if(!window.confirm("Are you sure you want to remove this user from the company?")) return;
    removeUser.mutate(
      { userId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTeamUsersQueryKey() });
          toast({ title: "User removed", description: "User has been removed from the team." });
        },
        onError: () => {
          toast({ title: "Remove failed", description: "Could not remove user.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Shell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Team Management</h1>
        <p className="text-muted-foreground">Oversee reps and manage roles.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <Users className="h-6 w-6 text-primary mb-2" />
            <div className="text-3xl font-bold">{stats?.fieldRepCount || 0}</div>
            <div className="text-sm text-muted-foreground">Field Reps</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <CheckCircle2 className="h-6 w-6 text-green-500 mb-2" />
            <div className="text-3xl font-bold">{stats?.totalPins || 0}</div>
            <div className="text-sm text-muted-foreground">Total Pins</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <ShieldAlert className="h-6 w-6 text-amber-500 mb-2" />
            <div className="text-3xl font-bold">{stats?.insurancePins || 0}</div>
            <div className="text-sm text-muted-foreground">Insurance Pins</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <FileText className="h-6 w-6 text-blue-500 mb-2" />
            <div className="text-3xl font-bold">{stats?.retailPins || 0}</div>
            <div className="text-sm text-muted-foreground">Retail Pins</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isTeamLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-2" />
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No team members found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(user.joinedAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{user.pinCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <Select 
                        value={user.role} 
                        onValueChange={(val) => handleRoleChange(user.id, val as Role)}
                        disabled={updateUser.isPending}
                      >
                        <SelectTrigger className="h-8 w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="field_rep">Field Rep</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemove(user.id)} disabled={removeUser.isPending}>
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </Shell>
  );
}
