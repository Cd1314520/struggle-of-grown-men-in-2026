import { Menu as MenuIcon, Plus, Search, WifiOff } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { typing, useHotkeys } from "../../lib/hotkeys";
import { useOnline } from "../../lib/live";
import { href, navigate, useRoute, type Page } from "../../lib/router";
import { useTheme } from "../../lib/theme";
import { Count, Sheet } from "../ui";
import { AddPostingDialog } from "./add-posting";
import { CommandPalette } from "./command-palette";
import { NAV, navItem } from "./nav";
import { ShortcutsDialog } from "./shortcuts";
import { Logo, SidebarContent } from "./sidebar";
import { useShell } from "./state";

const TABS: readonly Page[] = ["overview", "review", "questions", "pipeline"];

// The phone's tab bar: the four places worked in daily, and the menu for the rest.
function TabBar() {
  const { page } = useRoute();
  const { data: s } = useSummary();
  const { setMenuOpen } = useShell();
  const onMenu = !TABS.includes(page);
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {TABS.map(p => {
        const item = navItem(p);
        if (!item) return null;
        const badge = s && item.badge?.(s);
        const on = page === p;
        return (
          <a
            key={p}
            href={href(p)}
            data-nav={p}
            aria-current={on ? "page" : undefined}
            className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium", on ? "text-fg" : "text-fg-subtle")}
          >
            <item.icon className="size-5" strokeWidth={on ? 2 : 1.75} />
            {item.label}
            {badge && badge.value > 0 && <Count value={badge.value} tone={badge.tone} className="absolute top-1.5 left-1/2 ml-1.5" />}
          </a>
        );
      })}
      <button
        type="button"
        onClick={() => {
          setMenuOpen(true);
        }}
        className={cn("flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium", onMenu ? "text-fg" : "text-fg-subtle")}
      >
        <MenuIcon className="size-5" strokeWidth={onMenu ? 2 : 1.75} />
        More
      </button>
    </nav>
  );
}

function TopBar() {
  const { page } = useRoute();
  const { setPaletteOpen, setAddOpen } = useShell();
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur lg:hidden">
      <Logo />
      {/* #job/<id> is the one page off the nav; its back link, just below, names its section. */}
      <span className="flex-1 truncate text-base font-semibold text-fg">{navItem(page)?.label ?? "Job"}</span>
      <button
        type="button"
        aria-label="Search"
        onClick={() => {
          setPaletteOpen(true);
        }}
        className="flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-subtle"
      >
        <Search className="size-4.5" />
      </button>
      <button
        type="button"
        aria-label="Add a posting"
        onClick={() => {
          setAddOpen(true);
        }}
        className="flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-subtle"
      >
        <Plus className="size-5" />
      </button>
    </header>
  );
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div id="offline" role="alert" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-sm text-warning-text">
      <WifiOff className="size-3.5" />
      Connection lost. What you see may be out of date. Reconnecting…
    </div>
  );
}

const GO = new Map(NAV.flatMap(n => (n.go ? [[n.go, n.page] as const] : [])));

export function AppShell({ children }: { children: ReactNode }) {
  const shell = useShell();
  const { page } = useRoute();
  const theme = useTheme();
  // "G then O" goes to Overview, and so on. Listened for before the page's own keys, so the second
  // letter never also reaches the page (where A approves).
  useEffect(() => {
    let pending = 0;
    const onKey = (ev: KeyboardEvent) => {
      if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey || document.querySelector("[role=dialog]")) return;
      const key = ev.key.toLowerCase();
      if (pending && Date.now() - pending < 1000) {
        pending = 0;
        const page = GO.get(key);
        if (!page) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        navigate(page);
      } else if (key === "g") pending = Date.now();
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
    };
  }, []);
  useHotkeys([
    {
      key: "mod+k",
      inFields: true,
      inDialogs: true,
      run: () => {
        shell.setPaletteOpen(!shell.paletteOpen);
      },
    },
    {
      key: "?",
      run: () => {
        shell.setShortcutsOpen(true);
      },
    },
  ]);
  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-canvas lg:block">
        <SidebarContent />
      </aside>
      <div className="lg:pl-60">
        <OfflineBanner />
        <TopBar />
        <main className="min-h-[calc(100dvh-3rem)] lg:min-h-dvh">{children}</main>
      </div>
      <TabBar />
      <Sheet open={shell.menuOpen} onOpenChange={shell.setMenuOpen} side="left" title="Navigation" className="bg-canvas">
        <SidebarContent
          onNavigate={() => {
            shell.setMenuOpen(false);
          }}
        />
      </Sheet>
      <CommandPalette />
      <AddPostingDialog />
      <ShortcutsDialog />
      <Toaster
        theme={theme}
        position="bottom-right"
        // Above an open job's decision bar (docked or floating), so a toast never covers the next job's Approve.
        // On a phone a job's own page floats its bar over the tab bar, so toasts sit above both.
        offset={{ bottom: 88, right: 16 }}
        mobileOffset={{ bottom: page === "job" ? 136 : 72 }}
        toastOptions={{
          classNames: {
            toast: "!rounded-lg !border !border-border !bg-surface !text-fg !shadow-lg !font-sans !text-sm",
            description: "!text-fg-muted",
            actionButton: "!bg-accent !text-accent-fg !font-medium",
            // The icon carries the tone; the toast itself stays a neutral surface.
            success: "[&_[data-icon]]:text-success-text",
            error: "[&_[data-icon]]:text-danger-text",
            warning: "[&_[data-icon]]:text-warning-text",
            info: "[&_[data-icon]]:text-info-text",
          },
        }}
      />
    </div>
  );
}
