import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentAuthUser, useGetMyProfile } from "@workspace/api-client-react";
import { roleRank } from "@workspace/authz";
import type { Role } from "@workspace/authz";
import {
  LayoutGrid,
  Store,
  Shield,
  Layers,
  List,
  Calendar,
  MapPin,
  BarChart2,
  BookOpen,
  Users,
  ShieldCheck,
  Settings,
  Plug,
  LogOut,
  Loader2,
  Search,
  X,
  Plus,
  Menu,
} from "lucide-react";
import { useSearch } from "@/lib/claimHubApi";
import { applyTheme, type ThemeValue } from "@/lib/applyTheme";
import { QuickAddLeadModal } from "@/components/dashboard/QuickAddLeadModal";

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
  /**
   * Minimum role required to see this nav item, checked against the
   * authenticated user's profile using roleRank from @workspace/authz —
   * the same resolver used by ProtectedRoute and the server-side guard.
   * Items without minRole are visible to every authenticated user.
   */
  minRole?: Role;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Navigation",
    items: [
      { label: "Dashboard",          path: "/",                   icon: LayoutGrid },
      { label: "Retail Pipeline",    path: "/retail-pipeline",    icon: Store },
      { label: "Insurance Pipeline", path: "/insurance-pipeline", icon: Shield },
      { label: "Project Pipeline",   path: "/project-pipeline",   icon: Layers },
      { label: "All Leads",          path: "/leads",              icon: List },
      { label: "Team Calendar",      path: "/team-calendar",      icon: Calendar },
      { label: "Map View",           path: "/map",                icon: MapPin },
    ],
  },
  {
    heading: "Data & Tools",
    items: [
      { label: "Reports",            path: "/reports",           icon: BarChart2,   minRole: 'manager' },
      { label: "Proof Package Builder", path: "/proof-packages", icon: BookOpen },
    ],
  },
  {
    heading: "Admin",
    items: [
      { label: "Team Management",    path: "/team",               icon: Users,       minRole: 'manager' },
      { label: "User Authorization", path: "/user-authorization", icon: ShieldCheck, minRole: 'manager' },
      { label: "Settings",           path: "/settings",           icon: Settings },
      { label: "Integrations",       path: "/integrations",       icon: Plug,        minRole: 'manager' },
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
  const { data: profileEnvelope } = useGetMyProfile();
  const [location] = useLocation();
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [drawerOpen, setDrawerOpen]   = useState(false);

  // ── Last-pipeline quick-jump ─────────────────────────────────────────────
  // Close the mobile drawer whenever the route changes
  useEffect(() => { setDrawerOpen(false); }, [location]);

  // Sync theme from the server profile on every authenticated load.
  // The pre-paint bootstrap already applied the localStorage value; this
  // re-syncs if the user changed their preference on another device.
  useEffect(() => {
    const serverTheme = profileEnvelope?.profile?.theme as ThemeValue | undefined;
    if (serverTheme === 'light' || serverTheme === 'dark' || serverTheme === 'system') {
      applyTheme(serverTheme);
    }
  }, [profileEnvelope?.profile?.theme]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const user = authEnvelope?.user;
  const profile = profileEnvelope?.profile;

  const handleLogout = () => {
    window.location.href = '/api/logout?returnTo=/rooftrax-web/';
  };

  /**
   * Filter nav sections using roleRank from @workspace/authz.
   * Items are hidden (not grayed out) when the user's role rank is below
   * the item's minRole. While the profile is still loading (profile===undefined),
   * gated items are hidden to prevent a flash of unauthorized content.
   * Sections with no visible items are omitted entirely.
   */
  const visibleSections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.minRole) return true;
        if (!profile) return false; // hide until role is known
        return roleRank(profile.role) >= roleRank(item.minRole);
      }),
    }))
    .filter((section) => section.items.length > 0);

  // Shared nav content rendered inside both the desktop sidebar and mobile drawer
  const navContent = (
    <>
      {/* Search */}
      <SearchBar />

      {/* + New Lead */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={() => { setNewLeadOpen(true); setDrawerOpen(false); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5 flex-shrink-0" />
          Add New Lead
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-3">
        {visibleSections.map((section) => (
          <div key={section.heading} className="mb-4">
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
              {(() => {
                const displayFirst = profile?.firstName ?? user.firstName;
                const displayLast  = profile?.lastName  ?? user.lastName;
                const avatarUrl    = profile?.profileImageUrl ?? user.profileImageUrl;
                const initials     = displayFirst?.charAt(0) || user.email?.charAt(0) || '?';
                return (
                  <>
                    <div className="h-7 w-7 flex-shrink-0 rounded-sm overflow-hidden flex-none">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-black uppercase">
                          {initials}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold truncate">{displayFirst} {displayLast}</span>
                      <span className="text-[10px] text-sidebar-foreground/50 truncate">{user.email}</span>
                    </div>
                  </>
                );
              })()}
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
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">

      {/* ── Mobile top bar (≥md hidden) ──────────────────────────────────────
          Fixed at the top; main content is padded below it via pt-12 md:pt-0.  */}
      <header className="fixed inset-x-0 top-0 z-10 h-12 flex items-center justify-between px-3 bg-sidebar border-b border-sidebar-border md:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0" strokeWidth={2.5} />
            <span className="text-base font-black tracking-widest uppercase" style={{ fontFamily: "var(--app-font-condensed)" }}>
              <span className="text-foreground">ROOF</span><span className="text-primary">TRAX</span>
            </span>
          </div>
        </div>
        <button
          onClick={() => setNewLeadOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5 flex-shrink-0" />
          New Lead
        </button>
      </header>

      {/* ── Mobile backdrop ───────────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* ── Sidebar (drawer on mobile, static on desktop) ─────────────────── */}
      <aside
        className={[
          // shared
          'flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border',
          // mobile: fixed drawer, slide in/out
          'fixed inset-y-0 left-0 z-30 w-72',
          'transition-transform duration-200 ease-in-out',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
          // desktop: static sidebar, pixel-identical to before
          'md:relative md:translate-x-0 md:w-56 md:z-auto md:flex-shrink-0',
        ].join(' ')}
      >
        {/* Logo — desktop only; mobile top bar handles branding */}
        <div className="hidden md:flex px-5 h-14 items-center border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" strokeWidth={2.5} />
            <span className="text-lg font-black tracking-widest uppercase" style={{ fontFamily: "var(--app-font-condensed)" }}>
              <span className="text-foreground">ROOF</span><span className="text-primary">TRAX</span>
            </span>
          </div>
        </div>

        {/* Mobile drawer header with close button */}
        <div className="md:hidden flex items-center justify-between px-4 h-12 border-b border-sidebar-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={2.5} />
            <span className="text-base font-black tracking-widest uppercase" style={{ fontFamily: "var(--app-font-condensed)" }}>
              <span className="text-foreground">ROOF</span><span className="text-primary">TRAX</span>
            </span>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {navContent}
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden pt-12 md:pt-0">
        <div className="flex-1 overflow-auto p-5 md:p-8">
          {children}
        </div>
      </main>

      <QuickAddLeadModal open={newLeadOpen} onOpenChange={setNewLeadOpen} />
    </div>
  );
}
