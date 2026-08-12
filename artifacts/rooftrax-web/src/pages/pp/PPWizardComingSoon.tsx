/**
 * /pp/wizard/:id — Package Generation Wizard placeholder.
 *
 * The full wizard is implemented in the downstream "PP Generation Wizard &
 * Per-Package Billing" task. This placeholder ensures the "Generate Package"
 * button on My Inspections has a valid, PP-protected destination.
 */
import { PackagePlus } from 'lucide-react';
import { useLocation } from 'wouter';

export default function PPWizardComingSoon() {
  const [, navigate] = useLocation();

  return (
    <div className="max-w-lg mx-auto flex flex-col items-center justify-center py-24 gap-6 text-center">
      <div className="h-16 w-16 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
        <PackagePlus className="h-8 w-8 text-orange-400" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-white">Package Wizard</h1>
        <p className="text-sm text-zinc-400 max-w-sm">
          The Proof Package generation wizard is coming soon. You'll be able to build,
          customize, and download your package directly from here.
        </p>
      </div>
      <button
        onClick={() => navigate('/pp/inspections')}
        className="px-4 py-2 text-sm font-semibold border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors"
      >
        ← Back to Inspections
      </button>
    </div>
  );
}
