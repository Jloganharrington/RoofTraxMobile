import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { Kanban, MapPin, ClipboardList, Users, BookOpen, LogOut, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { data: authEnvelope, isLoading } = useGetCurrentAuthUser();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const user = authEnvelope?.user;

  const handleLogout = () => {
    window.location.href = '/api/logout?returnTo=/rooftrax-web/';
  };

  const navItems = [
    { label: "Pipeline",     path: "/pipeline",     icon: Kanban },
    { label: "Leads",        path: "/leads",        icon: MapPin },
    { label: "Inspections",  path: "/inspections",  icon: ClipboardList },
    { label: "Team",         path: "/team",         icon: Users },
    { label: "Price Book",   path: "/price-book",   icon: BookOpen },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="w-full md:w-60 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-5 h-14 flex items-center border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" strokeWidth={2.5} />
            <span className="text-lg font-black tracking-widest uppercase" style={{ fontFamily: "var(--app-font-condensed)" }}>
              <span className="text-foreground">ROOF</span><span className="text-primary">TRAX</span>
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map((item) => {
            // Pipeline and Inspections: active when path starts with /pipeline or /inspections
            // but /inspections/:id should highlight Pipeline, not Inspections
            const isActive = location === item.path ||
              (item.path === "/pipeline" && (location.startsWith("/pipeline") || (location.startsWith("/inspections/") && !location.includes("/estimate") && !location.includes("/summary") && !location.includes("/curation")))) ||
              (item.path !== "/pipeline" && location.startsWith(item.path) && item.path !== "/inspections") ||
              (item.path === "/inspections" && location === "/inspections");

            return (
              <Link
                key={item.path}
                href={item.path}
                data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
                className={`flex items-center gap-3 px-3 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-sidebar-border">
          {user ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-2 py-1">
                <div className="h-7 w-7 flex-shrink-0 bg-primary flex items-center justify-center text-primary-foreground text-xs font-black uppercase">
                  {user.firstName?.charAt(0) || user.email?.charAt(0) || '?'}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold truncate">{user.firstName} {user.lastName}</span>
                  <span className="text-[10px] text-sidebar-foreground/50 truncate">{user.email}</span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                data-testid="button-sign-out"
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-5 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
