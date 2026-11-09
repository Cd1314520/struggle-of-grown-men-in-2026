import { ChevronDown, Keyboard, Monitor, Moon, RefreshCw, Search, SquarePen, Sun } from "lucide-react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { api, refreshAll, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ago, MINUTE, plural } from "../../lib/format";
import type { Tone } from "../../lib/labels";
import { modKey } from "../../lib/hotkeys";
import { href, useRoute, type Page } from "../../lib/router";
import { setTheme, useTheme } from "../../lib/theme";
import { Count, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, StatusDot, Tooltip } from "../ui";
import { NAV, TABS, type NavItem } from "./nav";
import { useShell } from "./state";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-5 items-center justify-center rounded-[5px] bg-accent text-accent-fg", className)} aria-hidden>
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const about = summary && badge && badge.value > 0 ? item.describe?.(summary) : undefined;
  const Icon = item.icon;
  return (
    <Tooltip content={about} side="right">
      <a
        href={href(item.page)}
        data-nav={item.page}
        aria-current={active ? "page" : undefined}
        aria-description={about}
        onClick={onNavigate}
        className={cn(
          "group flex h-7 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors touch:h-10",
          active ? "bg-muted text-fg" : "text-fg-muted hover:bg-muted/40 hover:text-fg",
        )}
      >
        <Icon className={cn("size-4 shrink-0", active ? "text-fg" : "text-fg-muted group-hover:text-fg")} strokeWidth={1.75} />
        <span className="flex-1 truncate">{item.label}</span>
        {badge && <Count value={badge.value} tone={badge.tone} />}
      </a>
    </Tooltip>
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
      <MenuTrigger className="flex h-8 min-w-0 touch:h-10 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-accent/30">
        <Logo />
        <span className="min-w-0 truncate text-sm font-semibold text-fg">Auto Apply</span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </MenuTrigger>
      <MenuContent align="start" className="w-56">
        <MenuLabel>Theme</MenuLabel>
        {themes.map(([value, label, Icon]) => (
          <MenuItem
            key={value}
            icon={<Icon />}
            checked={theme === value}
            onSelect={() => {
              setTheme(value);
            }}
          >
            {label}
          </MenuItem>
        ))}
        <div className="[@media(pointer:coarse)]:hidden">
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
        </div>
      </MenuContent>
    </Menu>
  );
}

interface Health {
  label: string;
  tone: Tone;
  pulse?: boolean;
  to?: Page;
}

function health(s: Summary): Health | null {
  if (s.running.scan) return { label: "Scanning…", tone: "info", pulse: true };
  if (s.running.track) return { label: "Checking mail…", tone: "info", pulse: true };
  if (s.digest.enabled && (s.digest.deliveryState === "failed" || s.digest.deliveryState === "abandoned"))
    return { label: "Digest failing", tone: "danger", to: "settings" };
  if (!s.gmail.connected) return { label: "Mail not connected", tone: "warning", to: "setup" };
  if (s.setupRemaining) return { label: `${plural(s.setupRemaining, "setup step")} left`, tone: "warning", to: "setup" };
  if (s.scanMinutes && s.lastScan && Date.now() - Date.parse(s.lastScan) > 3 * s.scanMinutes * MINUTE)
    return { label: "Scans are behind", tone: "warning", to: "activity" };
  return null;
}

function SystemStatus({ summary, onNavigate }: { summary: Summary | undefined; onNavigate?: (() => void) | undefined }) {
  if (!summary) return null;
  const scanning = summary.running.scan;
  const problem = health(summary);
  const scanned = summary.lastScan ? `Last scan ${ago(summary.lastScan)}` : "Not scanned yet";
  const label = problem?.label ?? scanned;
  const detail = problem ? scanned : summary.autoApply.enabled ? "Auto-apply on" : !summary.scanMinutes ? "Scans run when you ask" : null;
  return (
    <div className="px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusDot tone={problem?.tone ?? "success"} pulse={problem?.pulse} />
        </span>
        {problem?.to ? (
          <a
            href={href(problem.to)}
            onClick={onNavigate}
            className={cn("flex-1 truncate text-sm font-medium hover:underline", problem.tone === "danger" ? "text-danger-text" : "text-warning-text")}
          >
            {label}
          </a>
        ) : (
          <span className="flex-1 truncate text-sm font-medium text-fg">{label}</span>
        )}
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
                () => undefined,
              );
            }}
            className="-mr-1 flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50 touch:-my-1.5 touch:-mr-2.5 touch:size-9"
          >
            <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} />
          </button>
        </Tooltip>
      </div>
      {detail && <p className="mt-0.5 pl-6 text-xs text-fg-subtle">{detail}</p>}
    </div>
  );
}

const HEAD_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-muted/40 hover:text-fg touch:size-10 [&_svg]:size-4";

export function SidebarContent({ onNavigate, more }: { onNavigate?: () => void; more?: boolean }) {
  const { page } = useRoute();
  const { data: summary } = useSummary();
  const { setPaletteOpen, setAddOpen } = useShell();
  const group = (g: NavItem["group"]) =>
    NAV.filter(n => n.group === g && !(more && TABS.includes(n.page))).map(item => (
      <NavLink key={item.page} item={item} active={page === item.page} summary={summary} onNavigate={onNavigate} />
    ));
  return (
    <div className="flex h-full flex-col gap-5 px-2.5 pt-2 pb-2.5">
      <div className="flex h-[50px] items-center gap-0.5">
        <WorkspaceMenu />
        {!more && (
          <>
            <Tooltip content="Search" shortcut={`${modKey} K`}>
              <button
                type="button"
                aria-label="Search"
                onClick={() => {
                  onNavigate?.();
                  setPaletteOpen(true);
                }}
                className={HEAD_BUTTON}
              >
                <Search />
              </button>
            </Tooltip>
            <Tooltip content="Add a posting">
              <button
                type="button"
                aria-label="Add a posting"
                onClick={() => {
                  onNavigate?.();
                  setAddOpen(true);
                }}
                className={cn(HEAD_BUTTON, "border border-border bg-surface shadow-xs hover:border-border-strong hover:bg-subtle")}
              >
                <SquarePen />
              </button>
            </Tooltip>
          </>
        )}
      </div>
      <nav aria-label="Sections" className="flex flex-col gap-px">
        {group("workspace")}
      </nav>
      <nav aria-label="Library" className="flex flex-col gap-px">
        <div className="flex h-7 items-center px-2 text-xs font-medium text-fg-subtle">Library</div>
        {group("library")}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <nav aria-label="System" className="flex flex-col gap-px">
          {group("system")}
        </nav>
        <SystemStatus summary={summary} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
