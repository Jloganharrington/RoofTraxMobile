import { useEffect } from "react";
import { useGetCurrentAuthUser, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { roleRank } from "@workspace/authz";
import type { Role } from "@workspace/authz";
import { AlertCircle, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { AccessDenied } from "./AccessDenied";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Optional minimum role required to render this route.
   * Uses roleRank from @workspace/authz — the same resolver used by the
   * sidebar and the server-side guard. If the authenticated user's role rank
   * is below this threshold they see AccessDenied rather than the page.
   *
   * Server-side enforcement is still authoritative (hard boundary 4).
   * This is a UI affordance only.
   */
  minRole?: Role;
}

export function ProtectedRoute({ children, minRole }: ProtectedRouteProps) {
  const { data: authEnvelope, isLoading: authLoading } = useGetCurrentAuthUser();
  const user = authEnvelope?.user;

  // Only fetch the profile once auth has resolved and there IS a user.
  // queryKey must be supplied explicitly when passing partial UseQueryOptions
  // in TanStack Query v5 (it's required by the type even though the generated
  // getGetMyProfileQueryOptions fills it in at runtime).
  const { data: profileEnvelope, isLoading: profileLoading, isError: profileError } = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey(), enabled: !!user },
  });

  const [location] = useLocation();

  // Show spinner while: auth is in-flight OR (role check needed AND profile loading)
  const isLoading = authLoading || (!!minRole && !!user && profileLoading);

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = `/api/login?returnTo=/axiomrestore-web${location}`;
    }
  }, [authLoading, user, location]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null; // redirect in flight via the useEffect above
  }

  // Fail CLOSED: if a role check is required but the profile query errored
  // (distinct from still-loading), render a recoverable error state rather
  // than silently rendering the protected page.  A transient network blip
  // must not read as "you lack access" (so we show retry, not AccessDenied)
  // and must not grant access either.
  if (minRole && !profileLoading && profileError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/20 gap-3">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Unable to verify your access level. This may be a temporary network issue.
        </p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  // Role gate — same roleRank resolver as the sidebar filter and the
  // server-side dashboardGuard.
  if (minRole && profileEnvelope?.profile) {
    if (roleRank(profileEnvelope.profile.role) < roleRank(minRole)) {
      return <AccessDenied requiredRole={minRole} />;
    }
  }

  return <>{children}</>;
}
