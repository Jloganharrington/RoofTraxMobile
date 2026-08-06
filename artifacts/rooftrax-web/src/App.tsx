import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import {
  Calendar, MapPin, FileText, BarChart2, Receipt,
  ShieldCheck, Settings, Plug, Bell,
  Loader2,
} from 'lucide-react';
import { useGetCurrentAuthUser } from '@workspace/api-client-react';

import Home from '@/pages/Home';
import Dashboard from '@/pages/Dashboard';
import LibraryPage from '@/pages/settings/LibraryPage';
import AhjWizardPage from '@/pages/settings/AhjWizardPage';
import InspectionList from '@/pages/inspections/InspectionList';
import ClaimHub from '@/pages/ClaimHub';
import Estimate from '@/pages/inspections/Estimate';
import PhotoCuration from '@/pages/inspections/PhotoCuration';
import Pipeline from '@/pages/pipeline/Pipeline';
import InsurancePipeline from '@/pages/pipeline/InsurancePipeline';
import SamplePackagePage from '@/pages/pipeline/SamplePackagePage';
import ProjectPipeline from '@/pages/pipeline/ProjectPipeline';
import RetailPipeline from '@/pages/pipeline/RetailPipeline';
import Leads from '@/pages/leads/Leads';
import LeadProfile from '@/pages/leads/LeadProfile';
import TeamList from '@/pages/team/TeamList';
import { ComingSoon } from '@/pages/ComingSoon';
import SettingsPage from '@/pages/settings/SettingsPage';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import UserAuthorizationPage from '@/pages/team/UserAuthorizationPage';
import MapPage from '@/pages/MapPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Splits "/" between authenticated and unauthenticated users.
 * - Authenticated  → render Dashboard; URL stays "/"
 * - Unauthenticated → render marketing Home
 * No redirect, no setLocation. Auth resolution is synchronous from React Query
 * cache on every subsequent render, so there is no flash of wrong content
 * after the first load.
 */
function RootRoute() {
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

function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-zinc-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold">404 - Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you are looking for does not exist.
        </p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* "/" serves Dashboard for authenticated users, marketing Home for unauthenticated */}
      <Route path="/" component={RootRoute} />

      {/* /dashboard redirects to "/" — sidebar nav already targets "/" */}
      <Route path="/dashboard">
        <Redirect to="/" />
      </Route>

      <Route path="/pipeline">
        <ProtectedRoute><Pipeline /></ProtectedRoute>
      </Route>
      <Route path="/insurance-pipeline">
        <ProtectedRoute><InsurancePipeline /></ProtectedRoute>
      </Route>
      <Route path="/sample-package">
        <ProtectedRoute><SamplePackagePage /></ProtectedRoute>
      </Route>
      <Route path="/project-pipeline">
        <ProtectedRoute><ProjectPipeline /></ProtectedRoute>
      </Route>
      <Route path="/retail-pipeline">
        <ProtectedRoute><RetailPipeline /></ProtectedRoute>
      </Route>
      <Route path="/leads">
        <ProtectedRoute><Leads /></ProtectedRoute>
      </Route>
      <Route path="/leads/:id">
        <ProtectedRoute><LeadProfile /></ProtectedRoute>
      </Route>
      <Route path="/inspections">
        <ProtectedRoute><InspectionList /></ProtectedRoute>
      </Route>
      {/* Claim Hub — primary claim surface */}
      <Route path="/inspections/:id">
        <ProtectedRoute><ClaimHub /></ProtectedRoute>
      </Route>
      {/* Legacy deep-link: /inspections/:id/summary → ClaimHub (F-10) */}
      <Route path="/inspections/:id/summary">
        {(params) => <Redirect to={`/inspections/${params.id}`} />}
      </Route>
      <Route path="/inspections/:id/estimate">
        <ProtectedRoute><Estimate /></ProtectedRoute>
      </Route>
      <Route path="/inspections/:id/curation">
        <ProtectedRoute><PhotoCuration /></ProtectedRoute>
      </Route>
      <Route path="/team">
        <ProtectedRoute minRole="manager"><TeamList /></ProtectedRoute>
      </Route>
      <Route path="/price-book">
        <Redirect to="/settings" />
      </Route>
      <Route path="/settings/library">
        <ProtectedRoute><LibraryPage /></ProtectedRoute>
      </Route>
      <Route path="/settings/library/ahj-wizard">
        <ProtectedRoute><AhjWizardPage /></ProtectedRoute>
      </Route>

      {/* Coming-soon routes — all tabs stay inside the portal */}
      <Route path="/team-calendar">
        <ProtectedRoute>
          <ComingSoon icon={Calendar} title="Team Calendar"
            description="Schedule inspections, track rep availability, and manage your team's field calendar in one shared view." />
        </ProtectedRoute>
      </Route>
      <Route path="/map">
        <ProtectedRoute><MapPage /></ProtectedRoute>
      </Route>
      <Route path="/templates">
        <Redirect to="/settings" />
      </Route>
      <Route path="/reports">
        <ProtectedRoute minRole="manager">
          <ComingSoon icon={BarChart2} title="Reports"
            description="Company-wide performance dashboards, claim conversion rates, and pipeline analytics at a glance." />
        </ProtectedRoute>
      </Route>
      <Route path="/commission-report">
        <ProtectedRoute minRole="manager">
          <ComingSoon icon={Receipt} title="Commission Reports"
            description="Track rep earnings, commission tiers, and payout history across your entire team." />
        </ProtectedRoute>
      </Route>
      <Route path="/user-authorization">
        <ProtectedRoute minRole="admin"><UserAuthorizationPage /></ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute><SettingsPage /></ProtectedRoute>
      </Route>
      <Route path="/integrations">
        <ProtectedRoute minRole="manager">
          <ComingSoon icon={Plug} title="Integrations"
            description="Connect your CRM, accounting software, and field tools to keep all your data in sync." />
        </ProtectedRoute>
      </Route>
      <Route path="/notifications">
        <ProtectedRoute>
          <ComingSoon icon={Bell} title="Notifications"
            description="Configure automated alerts for claim milestones, team activity, and pipeline changes." />
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
    </QueryClientProvider>
  );
}

export default App;
