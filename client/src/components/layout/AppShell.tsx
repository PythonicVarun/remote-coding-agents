import { Link, NavLink, Outlet } from "react-router-dom";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/cn";

export function AppShell() {
  return (
    <div className="flex h-full min-h-screen flex-col bg-bg text-fg">
      <header className="flex h-12 items-center justify-between border-b border-border-subtle bg-bg-subtle px-4">
        <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Terminal className="h-3.5 w-3.5" />
          </span>
          <span>Remote Coding Agents</span>
        </Link>
        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-bg-muted text-fg"
                  : "text-fg-muted hover:bg-bg-muted hover:text-fg",
              )
            }
          >
            Projects
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
