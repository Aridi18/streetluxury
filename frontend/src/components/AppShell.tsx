import {
  Activity,
  GitCompareArrows,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { PageLoader } from "./ui/misc";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/new", label: "New analysis", icon: Plus },
  { to: "/app/history", label: "History", icon: History },
  { to: "/app/compare", label: "Compare", icon: GitCompareArrows },
  { to: "/app/system", label: "Models & system", icon: ServerCog },
  { to: "/app/settings", label: "Privacy & settings", icon: ShieldCheck },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
              isActive ? "bg-accent/12 text-ink" : "text-muted hover:bg-raised hover:text-ink",
            )
          }
        >
          {({ isActive }) => (
            <>
              <n.icon className={cn("size-[17px]", isActive ? "text-accent-soft" : "text-faint group-hover:text-ink-soft")} aria-hidden />
              {n.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);

  if (user === undefined) return <PageLoader />;
  if (user === null) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-6 pt-5">
        <Logo />
      </div>
      <div className="flex-1 px-3">
        <NavItems onNavigate={() => setOpen(false)} />
      </div>
      <div className="m-3 rounded-xl border border-line bg-elevated p-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-full bg-accent/20 text-[12px] font-semibold text-accent-ink">
            {(user.display_name || user.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{user.display_name || "Investigator"}</div>
            <div className="truncate text-[11.5px] text-muted">{user.email}</div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sign out"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface animate-fade-in">
            <button className="absolute right-3 top-4 rounded-md p-1.5 text-muted hover:bg-raised" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur lg:hidden">
          <button className="rounded-md p-1.5 text-ink-soft hover:bg-raised" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <Logo />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-9">
          <Outlet />
        </main>
        <footer className="border-t border-line px-6 py-4 text-center text-[11.5px] text-faint lg:px-10">
          <Activity className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
          Findings are indicators for expert review, not proof. A clean result does not prove authenticity.
        </footer>
      </div>
    </div>
  );
}
