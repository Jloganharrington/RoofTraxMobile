/**
 * Sample Proof Package provisioner.
 * On mount, calls POST /api/sample-package/provision to ensure a real
 * inspection exists for this company, then redirects straight to the
 * normal LeadProfile so reps can add photos, fill inspection data, and
 * walk the full Proof Package Builder — just like any real lead.
 */
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Shell } from '@/components/layout/Shell';
import { Loader2 } from 'lucide-react';
import { useProvisionSamplePackage } from '@/lib/claimHubApi';

export default function SamplePackagePage() {
  const [, navigate] = useLocation();
  const { mutate: provision, isError } = useProvisionSamplePackage();

  useEffect(() => {
    provision(undefined, {
      onSuccess: ({ pinId }) => {
        if (pinId) navigate(`/leads/${pinId}`, { replace: true });
      },
    });
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isError) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
          <p className="text-sm">Could not set up the sample client. Please try again.</p>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-40" />
        <p className="text-sm">Setting up your sample client…</p>
      </div>
    </Shell>
  );
}
