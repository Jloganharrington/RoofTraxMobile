import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentAuthUser, logoutBrowserSession } from "@workspace/api-client-react";
import { Home, ClipboardList, Users, BookOpen, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { data: authEnvelope, isLoading } = useGetCurrentAuthUser();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Handle protected route logic if user is not loaded
  // The route protection logic actually happens in App.tsx or inside the components, 
  // but Shell will be used by authenticated pages mostly. 
  // If not authenticated and we are here, we might just be rendering a public shell or waiting for redirect.
  const user = authEnvelope?.user;

  const handleLogout = () => {
    window.location.href = '/api/logout?returnTo=/rooftrax-web/';
  };

  const navItems = [
    { label: "Inspections", path: "/inspections", icon: ClipboardList },
    { label: "Team", path: "/team", icon: Users, managerOnly: true },
    { label: "Price Book", path: "/price-book", icon: BookOpen, adminOnly: true },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background">
      <aside className="w-full md:w-64 border-r bg-sidebar text-sidebar-foreground flex flex-col flex-shrink-0">
        <div className="p-6 h-16 flex items-center border-b border-sidebar-border">
          <h1 className="text-xl font-bold tracking-tight text-sidebar-primary flex items-center gap-2">
            <Home className="h-5 w-5" /> RoofTrax
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
             // Basic role checks for visibility
             // In reality we should check user role from profile, but since we don't have profile here we can rely on pages to reject or we fetch profile. 
             // We'll just show them and let pages handle permissions, or we could fetch profile. Let's just show them for now.
             
             // Check if active
             const isActive = location.startsWith(item.path);

             return (
               <Link key={item.path} href={item.path} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"}`}>
                 <item.icon className="h-4 w-4" />
                 {item.label}
               </Link>
             )
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          {user ? (
            <div className="flex flex-col space-y-3">
               <div className="flex items-center gap-3 px-2">
                  <div className="h-8 w-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-semibold uppercase">
                     {user.firstName?.charAt(0) || user.email?.charAt(0) || '?'}
                  </div>
                  <div className="flex flex-col text-sm truncate">
                     <span className="font-medium truncate">{user.firstName} {user.lastName}</span>
                     <span className="text-xs text-sidebar-foreground/60 truncate">{user.email}</span>
                  </div>
               </div>
               <Button variant="ghost" className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={handleLogout}>
                 <LogOut className="h-4 w-4 mr-2" />
                 Sign Out
               </Button>
            </div>
          ) : null}
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
