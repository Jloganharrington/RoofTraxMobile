import { Loader2 } from 'lucide-react';
import { useGetCurrentAuthUser } from '@workspace/api-client-react';
import Dashboard from '@/pages/Dashboard';
import Home from '@/pages/Home';

/**
 * Splits "/" between authenticated and unauthenticated users.
 *
 *  - Authenticated   → renders Dashboard; URL stays "/"
 *  - Unauthenticated → renders marketing Home
 *  - Loading         → shows a centered spinner
 *
 * No redirect, no setLocation. Auth resolution is synchronous from React Query
 * cache on every subsequent render, so there is no flash of wrong content
 * after the first load.
 *
 * This component is intentionally kept minimal (only three direct dependencies)
 * so it can be unit-tested without mocking the rest of the application.
 */
export function RootRoute() {
  const { data: authEnvelope, isLoading } = useGetCurrentAuthUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return authEnvelope?.user ? <Dashboard /> : <Home />;
}
