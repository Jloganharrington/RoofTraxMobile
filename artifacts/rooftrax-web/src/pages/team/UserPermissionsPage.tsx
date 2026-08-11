/**
 * UserPermissionsPage — per-user permission override management.
 *
 * Route: /team/:userId/permissions
 * Min role: manager (enforced by ProtectedRoute + API)
 *
 * Shows every permission in the registry grouped by domain, with the user's
 * effective state and any active override. Actors who outrank the target can
 * grant, revoke, or reset individual permissions (and whole domains) after
 * supplying a mandatory audit note. Non-overridable permissions and
 * insufficient-rank actors always see controls rendered disabled — never hidden.
 */
import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetTeamUserPermissions,
  useGetTeamUserPermissionHistory,
  useSetTeamUserPermission,
  useClearTeamUserPermission,
  useListTeamUsers,
  useGetMyProfile,
  getGetTeamUserPermissionsQueryKey,
  getGetTeamUserPermissionHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PERMISSION_MAP } from "@workspace/authz";
import type { Role } from "@workspace/authz";
import { Shell } from "@/components/layout/Shell";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Shield,
  ShieldOff,
  RotateCcw,
  History,
  Info,
  Lock,
} from "lucide-react";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverrideShape {
  granted: boolean;
  note: string | null;
  grantedByUserId: string;
  createdAt: string;
}

type PermissionState = "default" | "granted" | "revoked";

type PendingAction =
  | { type: "grant"; key: string }
  | { type: "revoke"; key: string }
  | { type: "reset"; key: string }
  | { type: "domain_reset"; domain: string; keys: string[] };

interface NormalisedPerm {
  key: string;
  domain: string;
  label: string;
  note: string | null;
  override: OverrideShape | null;
  effective: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<Role, string> = {
  field_rep:   "Field Rep",
  manager:     "Manager",
  admin:       "Admin",
  super_admin: "Super Admin",
};

const ROLE_COLORS: Record<Role, string> = {
  field_rep:   "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  manager:     "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  admin:       "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  super_admin: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

// ---------------------------------------------------------------------------
// Statebadge
// ---------------------------------------------------------------------------

function StateBadge({ state }: { state: PermissionState }) {
  if (state === "granted") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-[10px] px-1.5 py-0">
        Granted
      </Badge>
    );
  }
  if (state === "revoked") {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-[10px] px-1.5 py-0">
        Revoked
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
      Default
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Note modal — required before any mutation
// ---------------------------------------------------------------------------

interface NoteModalProps {
  action: PendingAction | null;
  onSubmit: (note: string) => void;
  onCancel: () => void;
  isPending: boolean;
}

function NoteModal({ action, onSubmit, onCancel, isPending }: NoteModalProps) {
  const [note, setNote] = useState("");

  function close() {
    setNote("");
    onCancel();
  }

  function handleOpenChange(open: boolean) {
    if (!open) close();
  }

  function handleSubmit() {
    if (!note.trim()) return;
    onSubmit(note.trim());
    setNote("");
  }

  const title =
    !action ? "" :
    action.type === "grant"        ? `Grant: ${action.key}` :
    action.type === "revoke"       ? `Revoke: ${action.key}` :
    action.type === "reset"        ? `Reset: ${action.key}` :
                                     `Reset domain — ${action.domain}`;

  const description =
    !action ? "" :
    action.type === "domain_reset"
      ? `This will remove all ${action.keys.length} active override(s) in the "${action.domain}" domain and restore registry defaults.`
      : action.type === "grant"
      ? "Explicitly grant this permission — overrides the role default."
      : action.type === "revoke"
      ? "Explicitly revoke this permission — overrides the role default."
      : "Remove the manual override and restore the registry default for this permission.";

  const submitLabel =
    !action ? "Save" :
    action.type === "grant"        ? "Grant" :
    action.type === "revoke"       ? "Revoke" :
                                     "Reset";

  return (
    <Dialog open={!!action} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <Textarea
            placeholder="Explain why this override is being applied — stored in the audit log."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="text-sm resize-none"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            This note is permanent and cannot be edited after saving.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!note.trim() || isPending}
            variant={action?.type === "revoke" ? "destructive" : "default"}
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
            ) : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Permission row
// ---------------------------------------------------------------------------

interface PermissionRowProps {
  perm: NormalisedPerm;
  actorCanOverride: boolean;
  readOnlyReason: string | null;
  onGrant: () => void;
  onRevoke: () => void;
  onReset: () => void;
}

function PermissionRow({
  perm,
  actorCanOverride,
  readOnlyReason,
  onGrant,
  onRevoke,
  onReset,
}: PermissionRowProps) {
  const state: PermissionState = perm.override === null
    ? "default"
    : perm.override.granted ? "granted" : "revoked";

  // Look up registry entry for overridable flag
  const registryEntry = (PERMISSION_MAP as Record<string, typeof PERMISSION_MAP[keyof typeof PERMISSION_MAP] | undefined>)[perm.key];
  const notOverridable = registryEntry?.overridable === false;

  const disabledReason =
    notOverridable
      ? (registryEntry?.note ?? "This permission cannot be overridden per security policy.")
      : readOnlyReason ?? (!actorCanOverride ? "You do not outrank this user." : null);

  const controlsDisabled = notOverridable || !actorCanOverride || !!readOnlyReason;

  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-muted/10 transition-colors ${
        state !== "default" ? "bg-muted/5" : ""
      }`}
    >
      {/* Key + label area */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-muted-foreground">{perm.key}</span>
          <StateBadge state={state} />
          {state === "default" && (
            <span className={`text-[9px] font-medium ${perm.effective ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
              {perm.effective ? "✓ role allows" : "✗ role denies"}
            </span>
          )}
          {state !== "default" && (
            <span className={`text-[9px] font-medium ${perm.effective ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              → {perm.effective ? "allowed" : "denied"}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground mt-0.5 leading-snug">{perm.label}</p>
        {perm.override && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {state === "granted" ? "Granted" : "Revoked"}{" "}
            {format(new Date(perm.override.createdAt), "MMM d, yyyy")}
            {perm.override.note ? <> · <em>{perm.override.note}</em></> : null}
          </p>
        )}
        {perm.note && !notOverridable && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-0.5">
            <Info className="h-2.5 w-2.5 flex-shrink-0" />
            {perm.note}
          </p>
        )}
      </div>

      {/* Controls */}
      <TooltipProvider>
        <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5">
          {notOverridable ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-dashed text-muted-foreground cursor-not-allowed select-none">
                  <Lock className="h-2.5 w-2.5" />
                  Non-overridable
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-xs">{disabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <>
              {/* Grant */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      disabled={controlsDisabled || state === "granted"}
                      onClick={onGrant}
                    >
                      <Shield className="h-3 w-3" />
                      Grant
                    </Button>
                  </span>
                </TooltipTrigger>
                {controlsDisabled && disabledReason ? (
                  <TooltipContent className="max-w-[240px] text-xs">{disabledReason}</TooltipContent>
                ) : state === "granted" ? (
                  <TooltipContent className="text-xs">Already explicitly granted</TooltipContent>
                ) : null}
              </Tooltip>

              {/* Revoke */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 text-red-700 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                      disabled={controlsDisabled || state === "revoked"}
                      onClick={onRevoke}
                    >
                      <ShieldOff className="h-3 w-3" />
                      Revoke
                    </Button>
                  </span>
                </TooltipTrigger>
                {controlsDisabled && disabledReason ? (
                  <TooltipContent className="max-w-[240px] text-xs">{disabledReason}</TooltipContent>
                ) : state === "revoked" ? (
                  <TooltipContent className="text-xs">Already explicitly revoked</TooltipContent>
                ) : null}
              </Tooltip>

              {/* Reset */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      disabled={controlsDisabled || state === "default"}
                      onClick={onReset}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </Button>
                  </span>
                </TooltipTrigger>
                {controlsDisabled && disabledReason ? (
                  <TooltipContent className="max-w-[240px] text-xs">{disabledReason}</TooltipContent>
                ) : state === "default" ? (
                  <TooltipContent className="text-xs">No override — already at registry default</TooltipContent>
                ) : null}
              </Tooltip>
            </>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Domain section (collapsible)
// ---------------------------------------------------------------------------

interface DomainSectionProps {
  domain: string;
  perms: NormalisedPerm[];
  actorCanOverride: boolean;
  readOnlyReason: string | null;
  onAction: (action: PendingAction) => void;
}

function DomainSection({
  domain,
  perms,
  actorCanOverride,
  readOnlyReason,
  onAction,
}: DomainSectionProps) {
  const [open, setOpen] = useState(true);
  const overriddenKeys = perms.filter(p => p.override !== null).map(p => p.key);
  const overriddenCount = overriddenKeys.length;

  return (
    <div className="border rounded-md mb-3 overflow-hidden">
      <div className="flex items-center px-4 py-2.5 bg-muted/40">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
          <span className="font-mono text-sm font-semibold">{domain}</span>
          <Badge variant="secondary" className="text-xs ml-1">{perms.length}</Badge>
          {overriddenCount > 0 && (
            <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0">
              {overriddenCount} override{overriddenCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </button>

        {/* Domain-level reset — always shown when overrides exist; disabled when actor lacks authority */}
        {overriddenCount > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 ml-2 flex-shrink-0"
                    disabled={!actorCanOverride || !!readOnlyReason}
                    onClick={() =>
                      onAction({ type: "domain_reset", domain, keys: overriddenKeys })
                    }
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset domain
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-xs">
                {!actorCanOverride || readOnlyReason
                  ? (readOnlyReason ?? "You do not have override authority for this user.")
                  : `Clear all ${overriddenCount} override${overriddenCount !== 1 ? "s" : ""} in "${domain}" and restore defaults`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {open && (
        <div>
          {perms.map(perm => (
            <PermissionRow
              key={perm.key}
              perm={perm}
              actorCanOverride={actorCanOverride}
              readOnlyReason={readOnlyReason}
              onGrant={() => onAction({ type: "grant", key: perm.key })}
              onRevoke={() => onAction({ type: "revoke", key: perm.key })}
              onReset={() => onAction({ type: "reset", key: perm.key })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History panel (lazy-loaded, collapsed by default)
// ---------------------------------------------------------------------------

function HistoryPanel({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetTeamUserPermissionHistory(userId, {
    query: { enabled: open, queryKey: getGetTeamUserPermissionHistoryQueryKey(userId) },
  });
  const history = data?.history ?? [];

  return (
    <Card className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 p-4 text-left"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold text-sm">Override Audit Log</span>
        {history.length > 0 && (
          <Badge variant="secondary" className="text-xs">{history.length}</Badge>
        )}
      </button>

      {open && (
        <CardContent className="pt-0 pb-4 px-4">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No override history yet.
            </p>
          ) : (
            <div className="space-y-2">
              {history.map(entry => (
                <div key={entry.id} className="border rounded-md p-3 text-xs space-y-1 bg-muted/10">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold">{entry.permission}</span>
                    <span className="text-muted-foreground">
                      {entry.previousState ?? "none"}{" → "}{entry.newState ?? "none"}
                    </span>
                    <span className="text-muted-foreground ml-auto whitespace-nowrap">
                      {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                    </span>
                  </div>
                  <p className="text-muted-foreground italic">{entry.note}</p>
                  <p className="text-muted-foreground text-[10px]">actor: {entry.actorUserId}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function UserPermissionsPage() {
  const { userId } = useParams<{ userId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Data
  const { data: permData, isLoading: permsLoading } = useGetTeamUserPermissions(userId);
  const { data: teamData } = useListTeamUsers();
  const { data: profileData } = useGetMyProfile();

  // Mutations
  const setMutation   = useSetTeamUserPermission();
  const clearMutation = useClearTeamUserPermission();
  const isMutating    = setMutation.isPending || clearMutation.isPending;

  // Pending action (drives note modal)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Derive user info
  const targetUser  = teamData?.users?.find(u => u.id === userId);
  const actorRole   = ((profileData?.profile?.role ?? "field_rep") as Role);
  const targetRole  = ((targetUser?.role ?? "field_rep") as Role);

  // actorCanOverride is server-authoritative — it encodes both the rank gate
  // and the manager-assignment gate so the UI never has to replicate that logic.
  // Fall back to false while data is loading to keep controls disabled.
  const actorCanOverride = permData?.actorCanOverride ?? false;
  const readOnlyReason   = permsLoading
    ? null   // don't show the banner while loading
    : actorCanOverride
    ? null
    : "You do not have override authority for this user. Managers can only apply overrides to their direct reports; admins and above can override anyone they outrank.";

  // Group permissions by domain preserving registry order
  const byDomain = useMemo(() => {
    const perms = permData?.permissions ?? [];
    const map = new Map<string, NormalisedPerm[]>();
    for (const p of perms) {
      const arr = map.get(p.domain) ?? [];
      arr.push({
        key:      p.key,
        domain:   p.domain,
        label:    p.label,
        note:     p.note,
        override: p.override as OverrideShape | null,
        effective: p.effective,
        reason:   p.reason,
      });
      map.set(p.domain, arr);
    }
    return map;
  }, [permData?.permissions]);

  // Cache invalidation
  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: getGetTeamUserPermissionsQueryKey(userId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetTeamUserPermissionHistoryQueryKey(userId),
    });
  }

  // Action handler — called after note modal confirms
  async function handleSubmit(note: string) {
    if (!pendingAction) return;

    if (pendingAction.type === "grant" || pendingAction.type === "revoke") {
      setMutation.mutate(
        {
          userId,
          data: {
            permission: pendingAction.key,
            granted:    pendingAction.type === "grant",
            note,
          },
        },
        {
          onSuccess: () => {
            toast({ title: `Permission ${pendingAction.type === "grant" ? "granted" : "revoked"}` });
            invalidate();
            setPendingAction(null);
          },
          onError: (err: any) => {
            toast({
              title: "Error",
              description: err?.message ?? "Failed to save override.",
              variant: "destructive",
            });
            setPendingAction(null);
          },
        },
      );
      return;
    }

    if (pendingAction.type === "reset") {
      clearMutation.mutate(
        { userId, permissionKey: pendingAction.key, data: { note } },
        {
          onSuccess: () => {
            toast({ title: "Override cleared — restored to default" });
            invalidate();
            setPendingAction(null);
          },
          onError: (err: any) => {
            toast({
              title: "Error",
              description: err?.message ?? "Failed to clear override.",
              variant: "destructive",
            });
            setPendingAction(null);
          },
        },
      );
      return;
    }

    if (pendingAction.type === "domain_reset") {
      let succeeded = 0;
      let failed    = 0;
      for (const key of pendingAction.keys) {
        await new Promise<void>((resolve) => {
          clearMutation.mutate(
            { userId, permissionKey: key, data: { note } },
            {
              onSuccess: () => { succeeded++; resolve(); },
              onError:   () => { failed++;    resolve(); },
            },
          );
        });
      }
      invalidate();
      setPendingAction(null);
      if (failed === 0) {
        toast({ title: `Domain reset — ${succeeded} override(s) cleared` });
      } else {
        toast({
          title:   `Partial reset — ${succeeded} cleared, ${failed} failed`,
          variant: "destructive",
        });
      }
    }
  }

  const fullName = targetUser
    ? [targetUser.firstName, targetUser.lastName].filter(Boolean).join(" ") ||
      targetUser.email ||
      userId
    : userId;

  return (
    <Shell>
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => navigate("/team")}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back to team</span>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight truncate">{fullName}</h1>
            {targetUser && (
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[targetRole]}`}
              >
                {ROLE_LABELS[targetRole]}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Permission overrides</p>
        </div>
      </div>

      {/* ── Read-only banner ── */}
      {readOnlyReason && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Read-only view.</strong>{" "}
            {actorRole === "manager"
              ? "Managers can only apply overrides to their direct reports. "
              : ""}
            You do not outrank this user in the role hierarchy — controls are shown below but disabled.
          </span>
        </div>
      )}

      {/* ── Permission list ── */}
      {permsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : byDomain.size === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No permissions found.</p>
      ) : (
        [...byDomain.entries()].map(([domain, perms]) => (
          <DomainSection
            key={domain}
            domain={domain}
            perms={perms}
            actorCanOverride={actorCanOverride}
            readOnlyReason={readOnlyReason}
            onAction={setPendingAction}
          />
        ))
      )}

      {/* ── Audit log ── */}
      <HistoryPanel userId={userId} />

      {/* ── Note modal ── */}
      <NoteModal
        action={pendingAction}
        onSubmit={handleSubmit}
        onCancel={() => setPendingAction(null)}
        isPending={isMutating}
      />
    </Shell>
  );
}
