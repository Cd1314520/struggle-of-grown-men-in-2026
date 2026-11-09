import { Menu as MenuIcon, Plus, Search, WifiOff } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { typing, useHotkeys } from "../../lib/hotkeys";
import { useOnline } from "../../lib/live";
import { href, navigate, useRoute } from "../../lib/router";
import { useTheme } from "../../lib/theme";
import { Count, Sheet } from "../ui";
import { AddPostingDialog } from "./add-posting";
import { CommandPalette } from "./command-palette";
import { NAV, navItem, TABS } from "./nav";
import { ShortcutsDialog } from "./shortcuts";
import { SidebarContent } from "./sidebar";
import { useShell } from "./state";

function TabBar() {
  const { page } = useRoute();
  const { data: s } = useSummary();
  const { setMenuOpen } = useShell();
  const onMenu = !TABS.includes(page);
  const behind = s ? NAV.filter(n => !TABS.includes(n.page)).reduce((sum, n) => sum + (n.badge?.(s)?.value ?? 0), 0) : 0;
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
            className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium", on ? "text-fg" : "text-fg-muted")}
          >
            <item.icon className="size-5" strokeWidth={on ? 2 : 1.75} />
            {item.label}
            {badge && badge.value > 0 && (
              <Count value={badge.value} tone={badge.tone} badge className="absolute top-1 left-[calc(50%+6px)] ring-2 ring-surface" />
            )}
          </a>
        );
      })}
      <button
        type="button"
        aria-label="More"
        aria-description={behind ? `${behind.toLocaleString()} waiting on you` : undefined}
        onClick={() => {
          setMenuOpen(true);
        }}
        className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium", onMenu ? "text-fg" : "text-fg-muted")}
      >
        <MenuIcon className="size-5" strokeWidth={onMenu ? 2 : 1.75} />
        More
        <Count value={behind} tone="warning" badge className="absolute top-1 left-[calc(50%+6px)] ring-2 ring-surface" />
      </button>
    </nav>
  );
}

function TopBar() {
  const { page } = useRoute();
  const { setPaletteOpen, setAddOpen } = useShell();
  return (
    <header className="sticky top-0 z-30 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b border-border bg-surface pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] lg:hidden">
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
        className="-mr-2 flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-subtle"
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
    <div
      id="offline"
      role="alert"
      className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-40 flex items-start justify-center gap-2 bg-warning-soft px-4 py-1.5 text-sm text-warning-text lg:top-0"
    >
      <WifiOff className="mt-[3px] size-3.5 shrink-0" />
      <span>
        Connection lost.<span className="max-sm:hidden"> What you see may be out of date.</span> Reconnecting…
      </span>
    </div>
  );
}

const GO = new Map(NAV.flatMap(n => (n.go ? [[n.go, n.page] as const] : [])));

export function AppShell({ children }: { children: ReactNode }) {
  const shell = useShell();
  const { page } = useRoute();
  const theme = useTheme();
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-canvas lg:block">
        <SidebarContent />
      </aside>
      <TopBar />
      <main
        id="main"
        className="min-h-[calc(100dvh-3rem)] bg-surface lg:fixed lg:inset-y-2 lg:right-2 lg:left-60 lg:min-h-0 lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:shadow-sm"
      >
        <OfflineBanner />
        {children}
      </main>
      <TabBar />
      <Sheet
        open={shell.menuOpen}
        onOpenChange={shell.setMenuOpen}
        side="left"
        title="Navigation"
        className="bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      >
        <SidebarContent
          more
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
        offset={{ bottom: page === "job" ? 88 : 24, right: 24 }}
        mobileOffset={{ bottom: `calc(${page === "job" ? 136 : 72}px + env(safe-area-inset-bottom))` }}
        toastOptions={{
          classNames: {
            toast: "!rounded-lg !border !border-border-strong !bg-surface dark:!bg-subtle !text-fg !shadow-lg !font-sans !text-sm",
            description: "!text-fg-muted",
            actionButton: "!bg-accent !text-accent-fg !font-medium !h-7 !px-2.5 !text-sm !rounded-md touch:!h-9",
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
