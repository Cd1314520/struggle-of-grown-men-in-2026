import { RotateCcw, RotateCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Checkbox, Combobox, ConfirmDialog, Input, Select, Switch, Textarea, Tooltip, type Option } from "../../components/ui";
import { api, queryClient, refreshAll, useSettings } from "../../lib/api";
import { cn } from "../../lib/cn";
import { SettingRow } from "./parts";

export type FieldKind =
  | { kind: "bool" }
  | { kind: "number"; min?: number; step?: number; unit?: string }
  | { kind: "pair"; min?: number; step?: number; unit?: string }
  | { kind: "text"; type?: "text" | "url" | "email"; nullable?: boolean; placeholder?: string; mono?: boolean; short?: boolean }
  | { kind: "words"; placeholder?: string }
  | { kind: "list"; placeholder?: string }
  | { kind: "choice"; options: readonly Option[] }
  | { kind: "choices"; options: readonly Option[] }
  | { kind: "time" }
  | { kind: "zone" };

const isSection = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const getIn = (v: unknown, path: readonly string[]) => path.reduce<unknown>((at, key) => (isSection(at) ? at[key] : undefined), v);
const under = (path: string, prefixes: readonly string[]) => prefixes.some(p => path === p || path.startsWith(`${p}.`));

let zones: { value: string; label: string }[] | null = null;
const zoneOptions = () => (zones ??= Intl.supportedValuesOf("timeZone").map(z => ({ value: z, label: z.replaceAll("_", " ") })));

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
  multiline?: boolean | "wrap";
}) {
  const [draft, setDraft] = useState(value);
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
  const { multiline, ...rest } = props;
  const editing = {
    value: draft,
    disabled,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
    },
    onBlur: () => void commit(),
    onKeyDown: (e: { key: string; ctrlKey: boolean; metaKey: boolean; currentTarget: HTMLElement; preventDefault: () => void }) => {
      if (e.key === "Enter" && (multiline !== true || e.ctrlKey || e.metaKey)) {
        if (multiline) e.preventDefault();
        e.currentTarget.blur();
      }
      if (e.key === "Escape") {
        setDraft(value);
        e.currentTarget.blur();
      }
    },
    className,
  };
  return multiline ? <Textarea {...rest} {...editing} /> : <Input {...rest} {...editing} />;
}

const spinless = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

function Unit({ unit, children }: { unit: string | undefined; children: ReactNode }) {
  if (!unit) return children;
  return (
    <span className="relative inline-flex">
      {children}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-fg-muted">
        {unit}
      </span>
    </span>
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
        <Unit unit={field.unit}>
          <Typed
            aria-label={field.unit ? `${label}, ${field.unit}` : label}
            type="number"
            value={typeof value === "number" ? String(value) : ""}
            min={field.min ?? 0}
            step={field.step ?? 1}
            parse={number(field.min ?? 0, field.step ?? 1)}
            onCommit={save}
            disabled={busy}
            className={cn("tabular text-right", spinless, field.unit ? "w-32 pr-14" : "w-24")}
          />
        </Unit>
      );
    case "pair": {
      const pair = Array.isArray(value) ? value : [];
      return (
        <>
          {[0, 1].map(i => (
            <Unit key={i} unit={field.unit}>
              <Typed
                aria-label={`${label}, ${i ? "most" : "least"}${field.unit ? `, ${field.unit}` : ""}`}
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
                className={cn("tabular text-right", spinless, field.unit ? "w-24 pr-9" : "w-20")}
              />
            </Unit>
          ))}
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
    case "words":
      return (
        <Typed
          multiline
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder ?? "Not set"}
          parse={text => ({ value: text.trim().replace(/\s+/g, " ") || null })}
          onCommit={save}
          disabled={busy}
          className="h-14 min-h-0 w-full max-sm:h-15.5 touch:h-15.5 focus:h-28!"
        />
      );
    case "list":
      return (
        <Typed
          multiline="wrap"
          aria-label={label}
          value={Array.isArray(value) ? value.join(", ") : ""}
          placeholder={field.placeholder ?? "Comma-separated"}
          parse={text => ({
            value: text
              .split(/[,\n]/)
              .map(s => s.trim())
              .filter(Boolean),
          })}
          onCommit={save}
          disabled={busy}
          className="field-sizing-content min-h-8 w-full resize-none py-1 sm:w-72 touch:min-h-10 touch:py-2"
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
          className="tabular w-36"
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
          className="w-full sm:w-72"
        />
      );
  }
}

export interface Confirm {
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  then?: () => Promise<unknown>;
}

export function ConfigRow({
  path,
  label,
  description,
  field,
  confirm,
}: {
  path: string;
  label: string;
  description?: ReactNode;
  field: FieldKind;
  confirm?: (next: unknown) => Confirm | null;
}) {
  const { data } = useSettings();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ next: unknown; spec: Confirm } | null>(null);
  const keys = path.split(".");
  const value = getIn(data?.values, keys);
  const changed = getIn(data?.local, keys) !== undefined;
  const restart = under(path, data?.restart ?? []);
  const waiting = under(path, data?.pending ?? []) && changed;
  const save = async (next: unknown, then?: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = await api.setSetting(keys, next);
      await then?.();
      toast.success(next === undefined ? `${label} reset` : `${label} saved`, r.restart ? { description: "Used from the next restart." } : undefined);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      void refreshAll();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };
  const ask = (next: unknown) => {
    const spec = confirm?.(next);
    if (!spec) return save(next);
    setAsking({ next, spec });
    return Promise.resolve(false);
  };
  return (
    <SettingRow
      stack={field.kind !== "bool" && field.kind !== "choice"}
      block={field.kind === "words"}
      label={label}
      tag={
        restart &&
        !waiting && (
          <Tooltip content="Read when the app starts: a change waits for a restart">
            <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal text-fg-subtle">
              <RotateCw className="size-3" aria-hidden />
              Restart
            </span>
          </Tooltip>
        )
      }
      description={
        (description || waiting) && (
          <>
            {description}
            {waiting && <span className="block text-warning-text">Saved. The app uses it after a restart.</span>}
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
          <Control field={field} value={value} label={label} save={ask} busy={busy} />
        </>
      )}
      {asking && (
        <ConfirmDialog
          open
          onOpenChange={open => {
            if (!open) setAsking(null);
          }}
          title={asking.spec.title}
          description={asking.spec.description}
          confirm={asking.spec.confirm}
          danger={asking.spec.danger ?? false}
          onConfirm={() => void save(asking.next, asking.spec.then)}
        />
      )}
    </SettingRow>
  );
}
