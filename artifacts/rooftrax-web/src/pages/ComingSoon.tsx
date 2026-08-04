import { type ElementType } from "react";
import { Shell } from "@/components/layout/Shell";
import { Wrench } from "lucide-react";

interface ComingSoonProps {
  icon?: ElementType;
  title: string;
  description: string;
}

export function ComingSoon({ icon: Icon = Wrench, title, description }: ComingSoonProps) {
  return (
    <Shell>
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
        {/* Icon halo */}
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl scale-150" />
          <div className="relative h-24 w-24 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Icon className="h-10 w-10 text-primary" strokeWidth={1.5} />
          </div>
        </div>

        {/* Badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 mb-5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Coming Soon
        </span>

        {/* Heading */}
        <h1 className="text-3xl font-black tracking-tight mb-3">{title}</h1>

        {/* Description */}
        <p className="text-muted-foreground text-base max-w-md leading-relaxed">
          {description}
        </p>

        {/* Divider decoration */}
        <div className="mt-10 flex items-center gap-3 text-muted-foreground/20">
          <div className="h-px w-16 bg-current" />
          <div className="h-1.5 w-1.5 rounded-full bg-current" />
          <div className="h-px w-16 bg-current" />
        </div>

        <p className="mt-4 text-xs text-muted-foreground/40 tracking-wide">
          This feature is actively being built.
        </p>
      </div>
    </Shell>
  );
}
