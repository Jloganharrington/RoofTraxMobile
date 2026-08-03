import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import {
  LayoutGrid,
  Store,
  Shield,
  Layers,
  List,
  Calendar,
  MapPin,
  DollarSign,
  FileText,
  BarChart2,
  Receipt,
  Users,
  ShieldCheck,
  Settings,
  Plug,
  Bell,
  LogOut,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useSearch } from "@/lib/claimHubApi";

interface ShellProps {
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Nav structure
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  soon?: boolean;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Navigation",
    items: [
      { label: "Dashboard",                path: "/",                     icon: LayoutGrid },
      { label: "Retail Pipeline",          path: "/retail-pipeline",      icon: Store },
      { label: "Insurance Pipeline",       path: "/insurance-pipeline",   icon: Shield },
      { label: "Project Pipeline",         path: "/project-pipeline",     icon: Layers },
      { label: "All Leads",               path: "/leads",                icon: List },
      { label: "Team Calendar",           path: "/team-calendar",        icon: Calendar },
      { label: "Map View",                path: "/map",                  icon: MapPin },
    ],
  },
  {
    heading: "Data & Tools",
    items: [
      { label: "Price Book",        path: "/price-book",        icon: DollarSign },
      { label: "Templates",         path: "/templates",         icon: FileText },
      { label: "Reports",           path: "/reports",           icon: BarChart2 },
      { label: "Commission Report", path: "/commission-report", icon: Receipt },
    ],
  },
  {
    heading: "Admin",
    items: [
      { label: "Team Management",   path: "/team",               icon: Users },
      { label: "User Authorization",path: "/user-authorization", icon: ShieldCheck },
      { label: "Settings",          path: "/settings",           icon: Settings,   soon: true },
      { label: "Integrations",      path: "/integrations",       icon: Plug,        soon: true },
      { label: "Notifications",     path: "/notifications",      icon: Bell },
    ],
  },
];

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

function SearchBar() {
  const [query, setQuery]       = useState('');
  const [debouncedQ, setDQ]     = useState('');
  const [open, setOpen]         = useState(false);
  const wrapRef                 = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLInputElement>(null);
  const [, navigate]            = useLocation();
  const { data, isFetching }    = useSearch(debouncedQ);
  const results                 = data?.results ?? [];

  // Debounce: update debouncedQ 300 ms after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setDQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  const handleSelect = (id: string) => {
    navigate(`/inspections/${id}`);
    setQuery('');
    setDQ('');
    setOpen(false);
  };

  const clear = () => { setQuery(''); setDQ(''); inputRef.current?.focus(); };

  return (
    <div ref={wrapRef} className="relative px-3 py-2 border-b border-sidebar-border">
      <div className="flex items-center gap-2 bg-sidebar-accent/40 rounded-lg px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-sidebar-foreground/40 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search customers & properties…"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/30 outline-none min-w-0"
        />
        {query && (
          <button type="button" onClick={clear} className="text-sidebar-foreground/30 hover:text-sidebar-foreground/60 transition-colors">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && debouncedQ.length >= 2 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
          {isFetching ? (
            <p className="text-xs text-muted-foreground px-3 py-3">Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-3">No results for "{debouncedQ}"</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(r.id)}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                  >
                    {r.insuredName && (
                      <p className="text-xs font-semibold truncate">{r.insuredName}</p>
                    )}
                    {r.address && (
                      <p className={`text-[11px] truncate ${r.insuredName ? 'text-muted-foreground' : 'text-xs font-semibold'}`}>
                        {r.address}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active-path helper
// ---------------------------------------------------------------------------

function isNavItemActive(path: string, location: string): boolean {
  if (path === "/") return location === "/";
  return location === path || location.startsWith(path + "/");
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

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

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="w-full md:w-56 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col flex-shrink-0">

        {/* Logo */}
        <div className="px-5 h-14 flex items-center border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" strokeWidth={2.5} />
            <span className="text-lg font-black tracking-widest uppercase" style={{ fontFamily: "var(--app-font-condensed)" }}>
              <span className="text-foreground">ROOF</span><span className="text-primary">TRAX</span>
            </span>
          </div>
        </div>

        {/* Search */}
        <SearchBar />

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading} className="mb-4">
              {/* Section heading */}
              <p className="px-4 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
                {section.heading}
              </p>

              {section.items.map((item) => {
                const active = !item.soon && isNavItemActive(item.path, location);
                return (
                  <Link
                    key={item.path}
                    href={item.soon ? "#" : item.path}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                      item.soon
                        ? "opacity-40 cursor-default pointer-events-none"
                        : active
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    }`}
                    onClick={item.soon ? (e) => e.preventDefault() : undefined}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.soon && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide bg-sidebar-foreground/10 text-sidebar-foreground/50 px-1.5 py-0.5 rounded">
                        Soon
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-sidebar-border">
          {user ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 px-2 py-1">
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
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors rounded"
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
