import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import {
  Calendar, MapPin, FileText,
  ShieldCheck, Settings, Plug,
  Loader2,
} from 'lucide-react';
import { useGetCurrentAuthUser } from '@workspace/api-client-react';

import Home from '@/pages/Home';
import Dashboard from '@/pages/Dashboard';
import LibraryPage from '@/pages/settings/LibraryPage';
import AhjWizardPage from '@/pages/settings/AhjWizardPage';
import TrialPage from '@/pages/settings/TrialPage';
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
import UserPermissionsPage from '@/pages/team/UserPermissionsPage';
import { ComingSoon } from '@/pages/ComingSoon';
import TeamCalendar from '@/pages/TeamCalendar';
import { ReportsPage } from '@/pages/ReportsPage';
import SettingsPage from '@/pages/settings/SettingsPage';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import UserAuthorizationPage from '@/pages/team/UserAuthorizationPage';
import MapPage from '@/pages/MapPage';
import { RootRoute } from '@/routes/RootRoute';
import Signup from '@/pages/Signup';
import ProofPackage from '@/pages/trial/ProofPackage';
import TrialStart from '@/pages/trial/TrialStart';
import TrialSubmit from '@/pages/trial/TrialSubmit';
import TrialStatus from '@/pages/trial/TrialStatus';
import TrialWaitlist from '@/pages/trial/TrialWaitlist';
import TrialQueue from '@/pages/admin/TrialQueue';
import TrialQueueDetail from '@/pages/admin/TrialQueueDetail';
import PricingPage from '@/pages/pricing/PricingPage';
import PricingSuccessPage from '@/pages/pricing/PricingSuccessPage';
import ProductOverview from '@/pages/marketing/product/ProductOverview';
import ProofPackagesPage from '@/pages/marketing/product/ProofPackagesPage';
import CrmPage from '@/pages/marketing/product/CrmPage';
import MobilePage from '@/pages/marketing/product/MobilePage';
import CanvassingPage from '@/pages/marketing/product/CanvassingPage';
import AhjLibraryPage from '@/pages/marketing/product/AhjLibraryPage';
import CompanyPage from '@/pages/marketing/CompanyPage';
import DemoPage from '@/pages/marketing/DemoPage';
import ResourcesPage from '@/pages/marketing/ResourcesPage';
import AccuLynxPage from '@/pages/marketing/switch/AccuLynxPage';
import JobNimbusPage from '@/pages/marketing/switch/JobNimbusPage';
import PPRegisterPage, { PPRegisterConfirmPage } from '@/pages/pp/PPRegisterPage';
import PPLoginPage, { PPResetPasswordPage } from '@/pages/pp/PPLoginPage';
import PPPortalPlaceholder from '@/pages/pp/PPPortalPlaceholder';
import { PPProtectedRoute } from '@/components/layout/PPProtectedRoute';
import { PPShell } from '@/components/layout/PPShell';
import MyInspectionsPage from '@/pages/pp/MyInspectionsPage';
import MyPackagesPage from '@/pages/pp/MyPackagesPage';
import PPSettingsPage from '@/pages/pp/PPSettingsPage';
import PPUpgradePage from '@/pages/pp/PPUpgradePage';
import PPUpgradeSuccessPage from '@/pages/pp/PPUpgradeSuccessPage';
import PPWizardPage from '@/pages/pp/PPWizardPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

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

      {/* Marketing: beta application form — always public */}
      <Route path="/signup" component={Signup} />

      {/* Marketing site — public, no auth required */}
      <Route path="/product" component={ProductOverview} />
      <Route path="/product/proof-packages" component={ProofPackagesPage} />
      <Route path="/product/crm" component={CrmPage} />
      <Route path="/product/mobile" component={MobilePage} />
      <Route path="/product/canvassing" component={CanvassingPage} />
      <Route path="/product/ahj-library" component={AhjLibraryPage} />
      <Route path="/company" component={CompanyPage} />
      <Route path="/demo" component={DemoPage} />
      <Route path="/resources" component={ResourcesPage} />
      <Route path="/switch/acculynx" component={AccuLynxPage} />
      <Route path="/switch/jobnimbus" component={JobNimbusPage} />
      
      {/* Pricing Pages */}
      <Route path="/pricing" component={PricingPage} />
      <Route path="/pricing/success" component={PricingSuccessPage} />

      {/* PP Subscriber self-serve registration and auth — public routes */}
      <Route path="/pp/register" component={PPRegisterPage} />
      <Route path="/pp/register/confirm" component={PPRegisterConfirmPage} />
      <Route path="/pp/login" component={PPLoginPage} />
      <Route path="/pp/reset-password" component={PPResetPasswordPage} />
      {/* PP portal — /pp/portal is the email-verify redirect target; send to inspections */}
      <Route path="/pp/portal" component={PPPortalPlaceholder} />

      {/* PP Portal — authenticated subscriber pages */}
      <Route path="/pp/inspections">
        <PPProtectedRoute>
          <PPShell><MyInspectionsPage /></PPShell>
        </PPProtectedRoute>
      </Route>
      <Route path="/pp/packages">
        <PPProtectedRoute>
          <PPShell><MyPackagesPage /></PPShell>
        </PPProtectedRoute>
      </Route>
      <Route path="/pp/settings">
        <PPProtectedRoute>
          <PPShell><PPSettingsPage /></PPShell>
        </PPProtectedRoute>
      </Route>
      {/* PP Package Generation Wizard — full wizard is a downstream task */}
      <Route path="/pp/wizard/:id">
        <PPProtectedRoute>
          <PPShell><PPWizardPage /></PPShell>
        </PPProtectedRoute>
      </Route>
      {/* PP upgrade — accessible to unauthenticated visitors too */}
      <Route path="/pp/upgrade/success" component={PPUpgradeSuccessPage} />
      <Route path="/pp/upgrade" component={PPUpgradePage} />

      {/* Trial Proof Package — public marketing + trial-session flow */}
      <Route path="/proof-package" component={ProofPackage} />
      <Route path="/proof-package/start" component={TrialStart} />
      <Route path="/proof-package/submit" component={TrialSubmit} />
      <Route path="/proof-package/status/:id" component={TrialStatus} />
      <Route path="/proof-package/waitlist" component={TrialWaitlist} />

      {/* Trial admin queue — server enforces admin (team.view_stats) */}
      <Route path="/admin/trial-queue">
        <ProtectedRoute minRole="admin"><TrialQueue /></ProtectedRoute>
      </Route>
      <Route path="/admin/trial-queue/:id">
        <ProtectedRoute minRole="admin"><TrialQueueDetail /></ProtectedRoute>
      </Route>

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
      <Route path="/team/:userId/permissions">
        <ProtectedRoute minRole="manager"><UserPermissionsPage /></ProtectedRoute>
      </Route>
      <Route path="/team">
        <ProtectedRoute minRole="manager"><TeamList /></ProtectedRoute>
      </Route>
      <Route path="/price-book">
        <Redirect to="/settings" />
      </Route>
      <Route path="/trial">
        <ProtectedRoute><TrialPage /></ProtectedRoute>
      </Route>
      <Route path="/settings/library">
        <ProtectedRoute><LibraryPage /></ProtectedRoute>
      </Route>
      <Route path="/settings/library/ahj-wizard">
        <ProtectedRoute><AhjWizardPage /></ProtectedRoute>
      </Route>

      {/* Coming-soon routes — all tabs stay inside the portal */}
      <Route path="/team-calendar">
        <ProtectedRoute><TeamCalendar /></ProtectedRoute>
      </Route>
      <Route path="/map">
        <ProtectedRoute><MapPage /></ProtectedRoute>
      </Route>
      <Route path="/templates">
        <Redirect to="/settings" />
      </Route>
      <Route path="/reports">
        <ProtectedRoute minRole="manager">
          <ReportsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/commission-report">
        <Redirect to="/reports" />
      </Route>
      <Route path="/user-authorization">
        <ProtectedRoute minRole="manager"><UserAuthorizationPage /></ProtectedRoute>
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
      {/* /notifications was a standalone page; now lives in Settings → Personal */}
      <Route path="/notifications">
        <Redirect to="/settings" />
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
