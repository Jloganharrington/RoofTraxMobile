/**
 * PPShell — layout shell for the PP Subscriber Portal.
 *
 * Provides a sidebar with PP-specific navigation (My Inspections, My Packages,
 * Account Settings), a mobile top bar + drawer, user info footer, and logout.
 * Fetches the PP session from /api/pp/me to populate user / company info.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutList,
  Package,
  Settings,
  LogOut,
  Loader2,
  Menu,
  X,
} from 'lucide-react';
import logoDark from '@/assets/logo-dark.png';
import type { PPUser, PPCompany } from './PPProtectedRoute';

interface PPShellProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const PP_NAV: NavItem[] = [
  { label: 'My Inspections', path: '/pp/inspections', icon: LayoutList },
  { label: 'My Packages',    path: '/pp/packages',    icon: Package },
  { label: 'Account Settings', path: '/pp/settings',  icon: Settings },
];

function isActive(path: string, location: string): boolean {
  return location === path || location.startsWith(path + '/');
}

export function PPShell({ children }: PPShellProps) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [user, setUser] = useState<PPUser | null>(null);
  const [company, setCompany] = useState<PPCompany | null>(null);
  const [loading, setLoading] = useState(true);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location]);

  useEffect(() => {
    fetch('/api/pp/me', { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) {
          const body = await r.json() as { user: PPUser; company: PPCompany };
          setUser(body.user);
          setCompany(body.company);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = () => {
    fetch('/api/pp/logout', { method: 'POST', credentials: 'include' }).finally(() => {
      window.location.href = '/axiomrestore-web/pp/login';
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';
  const initials = (user?.firstName?.charAt(0) ?? user?.email?.charAt(0) ?? '?').toUpperCase();

  const navContent = (
    <>
      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-4">
        <p className="px-4 mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 select-none">
          PP Portal
        </p>
        {PP_NAV.map((item) => {
          const active = isActive(item.path, location);
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-orange-500/20 text-orange-400 border-r-2 border-orange-500'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
              }`}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-zinc-800">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="h-7 w-7 flex-shrink-0 rounded-sm overflow-hidden bg-orange-500 flex items-center justify-center text-white text-xs font-black uppercase">
              {initials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold truncate text-zinc-200">{displayName}</span>
              <span className="text-[10px] text-zinc-500 truncate">{company?.name}</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors rounded"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-zinc-950">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-10 h-12 flex items-center justify-between px-3 bg-zinc-900 border-b border-zinc-800 md:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center">
            <img src={logoDark} alt="AxiomRestore" className="h-5 w-auto" />
          </div>
        </div>
      </header>

      {/* Mobile backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'flex flex-col bg-zinc-900 border-r border-zinc-800',
          'fixed inset-y-0 left-0 z-30 w-72',
          'transition-transform duration-200 ease-in-out',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0 md:w-56 md:z-auto md:flex-shrink-0',
        ].join(' ')}
      >
        {/* Desktop logo */}
        <div className="hidden md:flex px-5 h-14 items-center border-b border-zinc-800">
          <img src={logoDark} alt="AxiomRestore" className="h-7 w-auto" />
        </div>

        {/* Mobile drawer header */}
        <div className="md:hidden flex items-center justify-between px-4 h-12 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center">
            <img src={logoDark} alt="AxiomRestore" className="h-6 w-auto" />
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {navContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden pt-12 md:pt-0">
        <div className="flex-1 overflow-auto p-5 md:p-8 text-zinc-100">
          {children}
        </div>
      </main>
    </div>
  );
}
