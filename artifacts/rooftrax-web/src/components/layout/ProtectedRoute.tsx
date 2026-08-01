import { useEffect } from "react";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { data: authEnvelope, isLoading } = useGetCurrentAuthUser();
  const [location] = useLocation();

  useEffect(() => {
    if (!isLoading && (!authEnvelope || !authEnvelope.user)) {
      window.location.href = `/api/login?returnTo=/rooftrax-web${location}`;
    }
  }, [isLoading, authEnvelope, location]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authEnvelope?.user) {
    return null; // Will redirect
  }

  return <>{children}</>;
}
