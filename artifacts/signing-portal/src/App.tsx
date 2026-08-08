import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router as WouterRouter, Switch, Route } from 'wouter';
import { Toaster } from 'sonner';
import AccessCodeEntry from '@/pages/AccessCodeEntry';
import ContractView from '@/pages/ContractView';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Page not found.</p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={AccessCodeEntry} />
      <Route path="/contract/:code" component={ContractView} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
