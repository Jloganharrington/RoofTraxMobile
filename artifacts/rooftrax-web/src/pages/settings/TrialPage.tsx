/**
 * Proof Package Data Wizard — standalone page at /trial.
 * Linked from the marketing nav "Proof Package" item.
 * Pre-populates the review step with the hard-coded CRM library values,
 * substituting the company's name from their profile.
 */
import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useGetMyProfile } from '@workspace/api-client-react';
import { Shell } from '@/components/layout/Shell';
import { ProofPackageWizard } from './ProofPackageWizard';
import { buildHardcodedLibraryItems } from '@/lib/hardcodedLibraryItems';

export default function TrialPage() {
  const { data: profile, isLoading } = useGetMyProfile();

  const preloadedItems = useMemo(() => {
    const name = profile?.profile.companyName;
    if (!name) return undefined;
    return buildHardcodedLibraryItems(name);
  }, [profile?.profile.companyName]);

  return (
    <Shell>
      <div className="max-w-3xl mx-auto space-y-6 py-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proof Package Data Wizard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review the pre-loaded CRM library values below — standards, detriment entries, and the
            Repairability Field Protocol boilerplate — then click <strong>Apply</strong> to save them
            to your library. Deselect any items you don't want to save, or go back to add your own
            content first.
          </p>
        </div>

        {isLoading || !preloadedItems ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
          </div>
        ) : (
          <ProofPackageWizard mode="standalone" preloadedItems={preloadedItems} />
        )}
      </div>
    </Shell>
  );
}
