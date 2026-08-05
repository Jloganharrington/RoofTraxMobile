import { Link } from 'wouter';
import { Plus, Navigation, ClipboardList } from 'lucide-react';

/** Quick navigation actions — accessible to all users. */
export function QuickAddWidget() {
  return (
    <div className="flex flex-col gap-2">
      <Link href="/leads">
        <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold uppercase tracking-wide border border-border rounded hover:border-primary hover:text-primary transition-colors text-left">
          <Plus className="h-3.5 w-3.5 flex-shrink-0" />
          New Lead
        </button>
      </Link>
      <Link href="/map">
        <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold uppercase tracking-wide border border-border rounded hover:border-primary hover:text-primary transition-colors text-left">
          <Navigation className="h-3.5 w-3.5 flex-shrink-0" />
          Start Canvass
        </button>
      </Link>
      <Link href="/inspections">
        <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold uppercase tracking-wide border border-border rounded hover:border-primary hover:text-primary transition-colors text-left">
          <ClipboardList className="h-3.5 w-3.5 flex-shrink-0" />
          Inspections
        </button>
      </Link>
    </div>
  );
}
