/**
 * Notifications preferences tab — lives inside Settings → Personal.
 *
 * Spec constraints:
 *  - Only render types the server returned (never the full catalog client-side).
 *  - Email and Push are independent toggles per type.
 *  - Frequency selector on email only; daily and weekly are disabled with a
 *    short "coming soon" label (not silently missing, not selectable-but-broken).
 *  - Saved immediately on change (no separate Save button).
 *  - Optimistic update so the toggle snaps instantly; reverts on API error.
 */

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNotificationPreferences,
  usePatchNotificationPreferences,
  getGetNotificationPreferencesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Group display metadata
// ---------------------------------------------------------------------------

const GROUPS = [
  {
    id:          "money",
    label:       "Money & Contracts",
    description: "Payments, contracts, and change orders.",
  },
  {
    id:          "claims",
    label:       "Claims",
    description: "Insurance claim milestones.",
  },
  {
    id:          "my_work",
    label:       "My Work",
    description: "Work assigned directly to you.",
  },
  {
    id:          "attention",
    label:       "Attention Items",
    description: "Items that require manager action.",
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotifFrequency = 'immediate' | 'daily' | 'weekly' | 'off';

type NotifPref = {
  type:           string;
  label:          string;
  group:          string;
  recipientRule:  string;
  emailEnabled:   boolean;
  pushEnabled:    boolean;
  frequency:      NotifFrequency;
  supportsDigest: boolean;
};

type PrefMap = Map<string, NotifPref>;

// ---------------------------------------------------------------------------
// Individual notification row
// ---------------------------------------------------------------------------

interface NotifRowProps {
  pref:     NotifPref;
  disabled: boolean;
  onUpdate: (type: string, changes: Partial<Pick<NotifPref, "emailEnabled" | "pushEnabled" | "frequency">>) => void;
}

function NotifRow({ pref, disabled, onUpdate }: NotifRowProps) {
  return (
    <div className="flex items-center gap-4 py-2 min-h-[2.75rem]">
      {/* Label — takes remaining space */}
      <span className="flex-1 text-sm">{pref.label}</span>

      {/* Email toggle */}
      <div className="flex items-center justify-center w-14">
        <Switch
          checked={pref.emailEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => onUpdate(pref.type, { emailEnabled: checked })}
          aria-label={`Email: ${pref.label}`}
        />
      </div>

      {/* Push toggle */}
      <div className="flex items-center justify-center w-14">
        <Switch
          checked={pref.pushEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => onUpdate(pref.type, { pushEnabled: checked })}
          aria-label={`Push: ${pref.label}`}
        />
      </div>

      {/* Frequency — email only; only for types that could ever support digests */}
      <div className="w-36 shrink-0">
        {pref.supportsDigest ? (
          <Select
            value={pref.frequency === "off" ? "immediate" : pref.frequency}
            disabled={disabled || !pref.emailEnabled}
            onValueChange={(v) => onUpdate(pref.type, { frequency: v as NotifFrequency })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Immediate</SelectItem>
              {/* Daily and weekly are stored but not dispatched in v1 */}
              <SelectItem value="daily" disabled>
                Daily — coming soon
              </SelectItem>
              <SelectItem value="weekly" disabled>
                Weekly — coming soon
              </SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground pl-1">Immediate only</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column header row (desktop only)
// ---------------------------------------------------------------------------

function ColumnHeaders() {
  return (
    <div className="flex items-center gap-4 px-6 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="flex-1">Event</span>
      <span className="w-14 text-center">Email</span>
      <span className="w-14 text-center">Push</span>
      <span className="w-36">Frequency</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function NotificationsSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
      </Card>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function NotificationsTab() {
  const { toast }       = useToast();
  const qc              = useQueryClient();
  const { data, isLoading } = useGetNotificationPreferences();
  const mutation        = usePatchNotificationPreferences();

  // Local optimistic copy — synced from server on load and on successful save.
  const [localPrefs, setLocalPrefs] = useState<PrefMap>(new Map());

  useEffect(() => {
    if (!data?.preferences) return;
    setLocalPrefs(new Map(data.preferences.map((p) => [p.type, p as NotifPref])));
  }, [data]);

  const updatePref = useCallback(
    (
      type:    string,
      changes: Partial<Pick<NotifPref, "emailEnabled" | "pushEnabled" | "frequency">>,
    ) => {
      // Optimistic update
      setLocalPrefs((prev) => {
        const next = new Map(prev);
        const existing = next.get(type);
        if (existing) next.set(type, { ...existing, ...changes });
        return next;
      });

      mutation.mutate(
        { data: { updates: [{ type, ...changes }] } },
        {
          onError: () => {
            // Revert to last confirmed server data
            if (data?.preferences) {
              setLocalPrefs(new Map(data.preferences.map((p) => [p.type, p as NotifPref])));
            }
            toast({ title: "Failed to save preference", variant: "destructive" });
          },
          onSuccess: (responseData) => {
            // Sync with server's authoritative response
            setLocalPrefs(new Map(responseData.preferences.map((p) => [p.type, p as NotifPref])));
            qc.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() });
          },
        },
      );
    },
    [mutation, data, toast, qc],
  );

  if (isLoading) return <NotificationsSkeleton />;

  if (!data?.preferences?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>No notification types are available for your role.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isMutating = mutation.isPending;

  return (
    <div className="space-y-4">
      {/* Intro card */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Control how and when you receive alerts. Changes are saved instantly.
            Only event types relevant to your role are shown.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Column headers */}
      <ColumnHeaders />

      {/* One card per group */}
      {GROUPS.map((group) => {
        const prefs = [...localPrefs.values()].filter((p) => p.group === group.id);
        if (prefs.length === 0) return null;

        return (
          <Card key={group.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{group.label}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border px-6">
              {prefs.map((pref) => (
                <NotifRow
                  key={pref.type}
                  pref={pref}
                  disabled={isMutating}
                  onUpdate={updatePref}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Footer note about push */}
      <p className="text-xs text-muted-foreground px-1">
        Push notifications require a supported mobile app build. They are not
        available in Expo Go.
      </p>
    </div>
  );
}
