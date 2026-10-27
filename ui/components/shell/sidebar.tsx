import { Check, ChevronsUpDown, Keyboard, Monitor, Moon, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { api, refreshAll, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ago } from "../../lib/format";
import { modKey } from "../../lib/hotkeys";
import { href, useRoute } from "../../lib/router";
import { setTheme, useTheme } from "../../lib/theme";
import { Count, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, StatusDot, Tooltip } from "../ui";
import { NAV, type NavItem } from "./nav";
import { useShell } from "./state";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-6 items-center justify-center rounded-md bg-accent text-accent-fg shadow-sm", className)} aria-hidden>
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  );
}

function NavLink({
  item,
  active,
  summary,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  summary: Summary | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const badge = summary && item.badge?.(summary);
  const Icon = item.icon;
  return (
    <a
      href={href(item.page)}
      data-nav={item.page}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors touch:h-10",
        active ? "bg-surface text-fg shadow-xs ring-1 ring-border" : "text-fg-muted hover:bg-muted/70 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-fg" : "text-fg-subtle group-hover:text-fg-muted")} strokeWidth={1.75} />
      <span className="flex-1 truncate">{item.label}</span>
      {badge && <Count value={badge.value} tone={badge.tone} />}
    </a>
  );
}

function WorkspaceMenu() {
  const theme = useTheme();
  const { setShortcutsOpen } = useShell();
  const themes = [
    ["light", "Light", Sun],
    ["dark", "Dark", Moon],
    ["system", "System", Monitor],
  ] as const;
  return (
    <Menu>
      <MenuTrigger className="flex h-9 min-w-0 touch:h-10 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-accent/30">
        <Logo />
        <span className="flex-1 truncate text-sm font-semibold text-fg">Auto Apply</span>
        <ChevronsUpDown className="size-3.5 text-fg-subtle" />
      </MenuTrigger>
      <MenuContent align="start" className="w-56">
        <MenuLabel>Theme</MenuLabel>
        {themes.map(([value, label, Icon]) => (
          <MenuItem
            key={value}
            icon={<Icon />}
            onSelect={() => {
              setTheme(value);
            }}
          >
            <span className="flex items-center justify-between">
              {label}
              {theme === value && <Check className="size-3.5 text-accent-text" />}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          icon={<Keyboard />}
          shortcut="?"
          onSelect={() => {
            setShortcutsOpen(true);
          }}
        >
          Keyboard shortcuts
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

// What the machine is doing, at the foot of the sidebar: how it applies, the last scan, and a way to scan now.
function SystemStatus({ summary }: { summary: Summary | undefined }) {
  if (!summary) return null;
  const scanning = summary.running.scan;
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-xs">
      <div className="flex items-center gap-2">
        <StatusDot tone={scanning ? "info" : summary.setupRemaining ? "warning" : "success"} pulse={scanning} />
        <span className="flex-1 text-sm font-medium text-fg">
          {scanning ? "Scanning…" : `${summary.approval === "auto" ? "Auto-apply" : "Gated"}${summary.targets.holdBack ? ", targets held" : ""}`}
        </span>
        <Tooltip content="Scan job boards now">
          <button
            type="button"
            aria-label="Scan now"
            disabled={scanning}
            onClick={() => {
              api.run("scan").then(
                () => {
                  toast.success("Scan started");
                  void refreshAll();
                },
                // The request already showed the server's refusal (e.g. the profile isn't filled in).
                () => undefined,
              );
            }}
            className="flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-subtle hover:text-fg disabled:opacity-50 touch:-my-1.5 touch:size-9"
          >
            <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} />
          </button>
        </Tooltip>
      </div>
      <p className="mt-1 pl-4 text-xs text-fg-subtle">{summary.lastScan ? `Last scan ${ago(summary.lastScan)}` : "Not scanned yet"}</p>
    </div>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { page } = useRoute();
  const { data: summary } = useSummary();
  const { setPaletteOpen, setAddOpen } = useShell();
  const group = (g: NavItem["group"]) =>
    NAV.filter(n => n.group === g).map(item => <NavLink key={item.page} item={item} active={page === item.page} summary={summary} onNavigate={onNavigate} />);
  return (
    <div className="flex h-full flex-col gap-4 px-3 pt-3 pb-3">
      <div className="flex items-center gap-1">
        <WorkspaceMenu />
        <Tooltip content="Add a posting">
          <button
            type="button"
            aria-label="Add a posting"
            onClick={() => {
              onNavigate?.();
              setAddOpen(true);
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-fg-muted shadow-xs hover:bg-subtle hover:text-fg touch:size-10"
          >
            <Plus className="size-4" />
          </button>
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          setPaletteOpen(true);
        }}
        className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-fg-subtle shadow-xs transition-colors hover:border-border-strong touch:h-10"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search</span>
        <Kbd size="sm" className="touch:hidden">
          {modKey}
        </Kbd>
        <Kbd size="sm" className="touch:hidden">
          K
        </Kbd>
      </button>
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {group("workspace")}
      </nav>
      <nav aria-label="Library" className="flex flex-col gap-0.5">
        <div className="px-2 pb-1 text-xs font-medium text-fg-subtle">Library</div>
        {group("library")}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <nav aria-label="System" className="flex flex-col gap-0.5">
          {group("system")}
        </nav>
        <SystemStatus summary={summary} />
      </div>
    </div>
  );
}
