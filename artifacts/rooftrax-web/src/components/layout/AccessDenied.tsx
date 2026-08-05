import { ShieldOff } from "lucide-react";
import { Link } from "wouter";

interface AccessDeniedProps {
  /** Human-readable role name, e.g. "manager" or "admin". */
  requiredRole?: string;
}

/**
 * Shown by ProtectedRoute when the authenticated user's role is below the
 * route's minRole threshold. Never redirects — gives the user a clear dead-end
 * with a way back.
 */
export function AccessDenied({ requiredRole }: AccessDeniedProps) {
  const label = requiredRole
    ? requiredRole.replace(/_/g, " ")
    : undefined;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-8 text-center">
      {/* Icon block */}
      <div className="h-16 w-16 border border-border/40 flex items-center justify-center text-muted-foreground/30">
        <ShieldOff className="h-8 w-8" strokeWidth={1.5} />
      </div>

      {/* Copy */}
      <div className="space-y-3">
        <h1
          className="text-2xl font-black uppercase tracking-wide text-foreground"
          style={{ fontFamily: "var(--app-font-condensed)" }}
        >
          Access Restricted
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
          {label
            ? <>This page requires <strong className="text-foreground font-semibold">{label}</strong> access or above.</>
            : "You don't have permission to view this page."}
        </p>
      </div>

      {/* Escape hatch */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-xs font-bold uppercase tracking-widest text-foreground hover:border-primary hover:text-primary transition-colors"
      >
        ← Back to Dashboard
      </Link>
    </div>
  );
}
