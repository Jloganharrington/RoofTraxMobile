import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Home from '@/pages/Home';
import LibraryPage from '@/pages/settings/LibraryPage';
import InspectionList from '@/pages/inspections/InspectionList';
import ClaimHub from '@/pages/ClaimHub';
import Summary from '@/pages/inspections/Summary';
import Estimate from '@/pages/inspections/Estimate';
import PhotoCuration from '@/pages/inspections/PhotoCuration';
import Pipeline from '@/pages/pipeline/Pipeline';
import Leads from '@/pages/leads/Leads';
import TeamList from '@/pages/team/TeamList';
import PriceBookList from '@/pages/price-book/PriceBookList';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

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
      <Route path="/" component={Home} />

      {/* Protected Routes */}
      <Route path="/pipeline">
        <ProtectedRoute><Pipeline /></ProtectedRoute>
      </Route>
      <Route path="/leads">
        <ProtectedRoute><Leads /></ProtectedRoute>
      </Route>
      <Route path="/inspections">
        <ProtectedRoute><InspectionList /></ProtectedRoute>
      </Route>
      {/* Claim Hub — primary claim surface */}
      <Route path="/inspections/:id">
        <ProtectedRoute><ClaimHub /></ProtectedRoute>
      </Route>
      {/* Legacy deep-link routes kept for backward compat */}
      <Route path="/inspections/:id/summary">
        <ProtectedRoute><Summary /></ProtectedRoute>
      </Route>
      <Route path="/inspections/:id/estimate">
        <ProtectedRoute><Estimate /></ProtectedRoute>
      </Route>
      <Route path="/inspections/:id/curation">
        <ProtectedRoute><PhotoCuration /></ProtectedRoute>
      </Route>
      <Route path="/team">
        <ProtectedRoute><TeamList /></ProtectedRoute>
      </Route>
      <Route path="/price-book">
        <ProtectedRoute><PriceBookList /></ProtectedRoute>
      </Route>
      <Route path="/settings/library">
        <ProtectedRoute><LibraryPage /></ProtectedRoute>
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
