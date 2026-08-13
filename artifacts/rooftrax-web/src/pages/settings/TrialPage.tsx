/**
 * Proof Package Data Wizard — standalone page at /trial.
 * Linked from the marketing nav "Proof Package" item.
 */
import { Shell } from '@/components/layout/Shell';
import { ProofPackageWizard } from './ProofPackageWizard';

export default function TrialPage() {
  return (
    <Shell>
      <div className="max-w-3xl mx-auto space-y-6 py-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proof Package Data Wizard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload documents or paste text — the AI classifies each chunk and routes it into the
            correct library (boilerplate, standards, detriment, or AHJ packs) for you to review
            before saving.
          </p>
        </div>
        <ProofPackageWizard mode="standalone" />
      </div>
    </Shell>
  );
}
