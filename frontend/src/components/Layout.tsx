import { Outlet, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary-foreground/15 text-primary-foreground"
      : "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
  );

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="bg-primary text-primary-foreground shadow">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
          <span className="mr-6 text-lg font-semibold">React SPA</span>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Home
            </NavLink>
            <NavLink to="/editor" className={navLinkClass}>
              Editor
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
