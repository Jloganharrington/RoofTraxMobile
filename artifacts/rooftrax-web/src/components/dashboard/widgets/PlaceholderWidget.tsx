import { Timer } from 'lucide-react';

interface Props {
  label?: string;
}

/** Shared base for widgets that are not yet implemented. */
export function PlaceholderWidget({ label = 'Coming soon' }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/30">
      <Timer className="h-5 w-5" />
      <p className="text-[10px] font-bold uppercase tracking-widest">{label}</p>
    </div>
  );
}
