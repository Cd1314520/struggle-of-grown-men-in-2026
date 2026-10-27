// One setting from config.yml as a row of the page, with the control its value takes. A change is saved to
// config.local.yml as soon as it is made (a typed value when the field is left, or on Enter); Reset hands
// the setting back to config.yml. One the app reads only at start says it waits for a restart.
import { RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Checkbox, Combobox, Input, Select, Switch, Tooltip, type Option } from "../../components/ui";
import { api, queryClient, refreshAll, useSettings } from "../../lib/api";
import { cn } from "../../lib/cn";
import { SettingRow } from "./parts";

export type FieldKind =
  | { kind: "bool" }
  | { kind: "number"; min?: number; step?: number; unit?: string }
  | { kind: "pair"; min?: number; step?: number; unit?: string }
  | { kind: "text"; type?: "text" | "url" | "email"; nullable?: boolean; placeholder?: string; mono?: boolean; short?: boolean }
  | { kind: "list"; placeholder?: string }
  | { kind: "choice"; options: readonly Option[] }
  | { kind: "choices"; options: readonly Option[] }
  | { kind: "time" }
  | { kind: "zone" };

const isSection = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const getIn = (v: unknown, path: readonly string[]) => path.reduce<unknown>((at, key) => (isSection(at) ? at[key] : undefined), v);
const under = (path: string, prefixes: readonly string[]) => prefixes.some(p => path === p || path.startsWith(`${p}.`));

// The time zones Intl knows, read once.
let zones: { value: string; label: string }[] | null = null;
const zoneOptions = () => (zones ??= Intl.supportedValuesOf("timeZone").map(z => ({ value: z, label: z.replaceAll("_", " ") })));

// A typed value, kept as text while it is edited and sent when the field is left or Enter is pressed.
function Typed({
  value,
  parse,
  onCommit,
  disabled,
  className,
  ...props
}: {
  value: string;
  parse: (text: string) => { value: unknown } | { error: string };
  onCommit: (v: unknown) => Promise<boolean>;
  disabled: boolean;
  className?: string;
  "aria-label": string;
  type?: string;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(value);
  // A value saved (or changed elsewhere) since replaces the text.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const commit = async () => {
    if (draft === value) return;
    const parsed = parse(draft);
    if ("error" in parsed) {
      toast.error(parsed.error);
      setDraft(value);
    } else if (!(await onCommit(parsed.value))) setDraft(value);
  };
  return (
    <Input
      {...props}
      value={draft}
      disabled={disabled}
      onChange={e => {
        setDraft(e.target.value);
      }}
      onBlur={() => void commit()}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}

const number = (min: number | undefined, step: number | undefined) => (text: string) => {
  const n = Number(text);
  if (!text.trim() || !Number.isFinite(n)) return { error: "Enter a number" };
  if (min !== undefined && n < min) return { error: `Enter a number of at least ${min}` };
  if (step === 1 && !Number.isInteger(n)) return { error: "Enter a whole number" };
  return { value: n };
};

function Control({
  field,
  value,
  label,
  save,
  busy,
}: {
  field: FieldKind;
  value: unknown;
  label: string;
  save: (v: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  switch (field.kind) {
    case "bool":
      return <Switch aria-label={label} checked={value === true} disabled={busy} onCheckedChange={v => void save(v)} />;
    case "number":
      return (
        <>
          <Typed
            aria-label={label}
            type="number"
            value={typeof value === "number" ? String(value) : ""}
            min={field.min ?? 0}
            step={field.step ?? 1}
            parse={number(field.min ?? 0, field.step ?? 1)}
            onCommit={save}
            disabled={busy}
            className="tabular w-24 text-right"
          />
          <span className="w-12 text-fg-muted">{field.unit}</span>
        </>
      );
    case "pair": {
      const pair = Array.isArray(value) ? value : [];
      return (
        <>
          {[0, 1].map(i => (
            <Typed
              key={i}
              aria-label={`${label}, ${i ? "most" : "least"}`}
              type="number"
              value={typeof pair[i] === "number" ? String(pair[i]) : ""}
              min={field.min ?? 0}
              step={field.step ?? 1}
              parse={text => {
                const n = number(field.min ?? 0, field.step ?? 1)(text);
                return "error" in n ? n : { value: i ? [pair[0], n.value] : [n.value, pair[1]] };
              }}
              onCommit={save}
              disabled={busy}
              className="tabular w-20 text-right"
            />
          ))}
          <span className="w-12 text-fg-muted">{field.unit}</span>
        </>
      );
    }
    case "text":
      return (
        <Typed
          aria-label={label}
          type={field.type ?? "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder ?? (field.nullable ? "Not set" : "")}
          parse={text => {
            const v = text.trim();
            if (!v) return field.nullable ? { value: null } : { error: `${label} can't be empty` };
            return { value: v };
          }}
          onCommit={save}
          disabled={busy}
          className={cn(field.short ? "w-24" : "w-full sm:w-72", field.mono && "font-mono")}
        />
      );
    case "list":
      return (
        <Typed
          aria-label={label}
          value={Array.isArray(value) ? value.join(", ") : ""}
          placeholder={field.placeholder ?? "Comma-separated"}
          parse={text => ({
            value: text
              .split(",")
              .map(s => s.trim())
              .filter(Boolean),
          })}
          onCommit={save}
          disabled={busy}
          className="w-full sm:w-72"
        />
      );
    case "choice":
      return <Select aria-label={label} value={String(value)} options={field.options} onValueChange={v => void save(v)} disabled={busy} />;
    case "choices": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap items-center gap-4">
          {field.options.map(o => (
            <label key={o.value} className="flex items-center gap-2">
              <Checkbox
                checked={chosen.includes(o.value)}
                disabled={busy}
                onCheckedChange={on => void save(field.options.map(x => x.value).filter(v => (v === o.value ? on === true : chosen.includes(v))))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "time":
      return (
        <Typed
          aria-label={label}
          type="time"
          value={typeof value === "string" ? value : ""}
          parse={text => (/^\d\d:\d\d$/.test(text) ? { value: text } : { error: "Enter a time" })}
          onCommit={save}
          disabled={busy}
          className="tabular w-32"
        />
      );
    case "zone":
      return (
        <Combobox
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onValueChange={v => void save(v)}
          options={zoneOptions()}
          search="Search time zones…"
          empty="No time zone matches"
          disabled={busy}
          className="w-full sm:w-64"
        />
      );
  }
}

// `path`: the setting's keys, dotted ("schedule.scanMinutes").
export function ConfigRow({ path, label, description, field }: { path: string; label: string; description?: ReactNode; field: FieldKind }) {
  const { data } = useSettings();
  const [busy, setBusy] = useState(false);
  const keys = path.split(".");
  const value = getIn(data?.values, keys);
  const changed = getIn(data?.local, keys) !== undefined;
  const restart = under(path, data?.restart ?? []);
  const waiting = under(path, data?.pending ?? []) && changed;
  const save = async (next: unknown) => {
    setBusy(true);
    try {
      const r = await api.setSetting(keys, next);
      toast.success(next === undefined ? `${label} reset` : `${label} saved`, r.restart ? { description: "Used from the next restart." } : undefined);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      void refreshAll();
      return true;
    } catch {
      // the request showed why; the value stays as it was
      return false;
    } finally {
      setBusy(false);
    }
  };
  const wide = (field.kind === "text" && !field.short) || field.kind === "pair" || field.kind === "list" || field.kind === "zone" || field.kind === "choices";
  return (
    <SettingRow
      stack={wide}
      label={label}
      description={
        (description || restart) && (
          <>
            {description}
            {restart && (
              <span className={cn("block", waiting && "text-warning-text")}>
                {waiting ? "Saved. The app uses it after a restart." : "Read when the app starts: a change waits for a restart."}
              </span>
            )}
          </>
        )
      }
    >
      {data && (
        <>
          {changed && (
            <Tooltip content="Back to config.yml's value">
              <Button size="icon-sm" variant="ghost" aria-label={`Reset ${label} to config.yml's value`} disabled={busy} onClick={() => void save(undefined)}>
                <RotateCcw />
              </Button>
            </Tooltip>
          )}
          <Control field={field} value={value} label={label} save={save} busy={busy} />
        </>
      )}
    </SettingRow>
  );
}
