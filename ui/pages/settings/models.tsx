// Models: which model each kind of agent work runs on. The list is what omp and Claude Code can reach on
// this machine; a choice is saved to config.local.yml and used from that stage's next run.
import { FileCog, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { CatalogModel, ModelCatalog, ModelStage } from "../../../src/api-types";
import { Button, Combobox, ListNotice, SkeletonRows, type ComboOption } from "../../components/ui";
import { api, queryClient, refreshAll, useModels } from "../../lib/api";
import { SettingRow, SettingsGroup, SettingsPanel } from "./parts";

// What each stage does, and what that asks of a model. In the order a job meets them.
export const STAGES: readonly { stage: ModelStage; label: string; description: string; core: boolean }[] = [
  { stage: "triage", label: "Triage", description: "Reads raw titles 50 at a time on every scan. A fast, cheap model is right.", core: true },
  { stage: "screen", label: "Screen", description: "Reads each posting for plain dealbreakers before the full assessment. Cheap and quick.", core: true },
  { stage: "prep", label: "Assess and tailor", description: "Scores each posting against the rubric and tailors the resume. Quality shows here.", core: true },
  { stage: "fill", label: "Fill", description: "Fills application forms in the browser. Needs a capable model that reads pages well.", core: true },
  { stage: "track", label: "Track mail", description: "Reads replies in the mailbox and records next steps and outcomes.", core: false },
  { stage: "discover", label: "Discover", description: "Searches the web for more companies and boards to watch.", core: false },
  { stage: "locate", label: "Locate", description: "Finds the employer's own posting for a LinkedIn or Indeed job.", core: false },
  {
    stage: "recheck",
    label: "Recheck questions",
    description: "Adds the answers you keep to your answers, and answers parked questions once the profile settles them.",
    core: false,
  },
  { stage: "import", label: "Resume import", description: "Turns uploaded files into your Typst resume.", core: false },
];

const DEFAULT = "__default__";
// Each harness: its name, and how to sign it in on this machine.
const HARNESSES: { id: keyof ModelCatalog["errors"]; label: string; login: string }[] = [
  { id: "omp", label: "omp", login: "omp login" },
  { id: "claude-code", label: "Claude Code", login: "claude auth login" },
  { id: "codex", label: "Codex", login: "bun run codex:login" },
];
const price = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2));
const option = (m: CatalogModel): ComboOption => ({
  value: m.selector,
  label: m.selector.slice(m.provider.length + 1) || m.selector,
  selected: m.selector,
  group: m.provider,
  ...(m.cost ? { hint: `$${price(m.cost.input)} / $${price(m.cost.output)}` } : {}),
});

function StageRow({
  stage,
  label,
  description,
  value,
  options,
}: {
  stage: ModelStage;
  label: string;
  description: string;
  value: string | null;
  options: ComboOption[];
}) {
  const [saving, setSaving] = useState(false);
  const choose = async (v: string) => {
    const model = v === DEFAULT ? null : v;
    setSaving(true);
    try {
      await api.setModel(stage, model);
      toast.success(`${label} now uses ${model ?? "omp's default"}`, { description: "From its next run." });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      void refreshAll();
    } catch {
      // the request showed why; the choice stays as it was
    } finally {
      setSaving(false);
    }
  };
  // A model named in the config that is not listed still shows as chosen.
  const all = value && !options.some(o => o.value === value) ? [...options, { value, label: value, group: "Not listed" }] : options;
  return (
    <SettingRow stack label={label} description={description}>
      <Combobox
        aria-label={`${label} model`}
        value={value ?? DEFAULT}
        onValueChange={v => void choose(v)}
        options={all}
        search="Search models…"
        empty="No model matches. Type its full name to use it anyway."
        custom={typed => `Use “${typed}”`}
        disabled={saving}
        className="w-full sm:w-64"
      />
    </SettingRow>
  );
}

export function Models() {
  const { data, isPending } = useModels();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(["models"], await api.models(true));
      void queryClient.invalidateQueries({ queryKey: ["setup"] });
    } catch {
      // shown by the request
    } finally {
      setRefreshing(false);
    }
  };
  const options: ComboOption[] = [{ value: DEFAULT, label: "omp's default", selected: "omp's default" }, ...(data?.catalog.models ?? []).map(option)];
  const group = (core: boolean, title: string) => (
    <>
      <SettingsGroup title={title} />
      {STAGES.filter(s => s.core === core).map(s => (
        <StageRow key={s.stage} {...s} value={data?.stages[s.stage] ?? null} options={options} />
      ))}
    </>
  );
  const failed = HARNESSES.filter(h => data?.catalog.errors[h.id]);
  const models = data?.catalog.models ?? [];
  return (
    <SettingsPanel
      id="models"
      title="Models"
      description="Which model each kind of agent work runs on. A claude-code model runs through Claude Code (claude -p) as signed in on this machine, a codex model through Codex (codex exec) as signed in for this app; any other through omp. The list is what the three can reach here."
      actions={
        data && (
          <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={refreshing} onClick={() => void refresh()} className="-mr-2.5 touch:-mr-3">
            <span className="max-sm:sr-only">Refresh list</span>
          </Button>
        )
      }
      notice={
        failed.length > 0 && (
          <div className="flex flex-col">
            {failed.map(h => (
              <ListNotice key={h.id} tone="warning" icon={<TriangleAlert />}>
                {h.label} couldn&apos;t list its models: {data?.catalog.errors[h.id]}. Sign in with <code className="font-mono text-xs">{h.login}</code> on this
                machine, if you mean to use it. A model can still be typed by name.
              </ListNotice>
            ))}
          </div>
        )
      }
      footer={
        <span className="inline-flex items-start gap-1.5">
          <FileCog className="mt-1 size-3.5 shrink-0 text-fg-subtle" />
          <span>
            Saved to <code className="font-mono text-xs">config.local.yml</code> and used from each stage&apos;s next run.
            {models.length > 0 &&
              ` ${models.length} models from ${new Set(models.map(m => m.provider)).size} providers; prices are dollars per million tokens in and out.`}
          </span>
        </span>
      }
    >
      {isPending ? (
        <SkeletonRows lead={false} rows={4} className="-mx-(--list-x)" />
      ) : (
        <>
          {group(true, "The pipeline")}
          {group(false, "Supporting work")}
        </>
      )}
    </SettingsPanel>
  );
}
