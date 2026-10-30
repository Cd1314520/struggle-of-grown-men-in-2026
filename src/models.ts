// The models agents run on: which ones omp, Claude Code and Codex can reach, and the choice per stage. A choice made in the
// app is written to config.local.yml (laid over config.yml) and to the loaded config, so the next
// worker of that stage uses it without a restart.
import { config, LOCAL_CONFIG, MODEL_STAGES, type ModelStage } from "./config";
import { claudeCatalog } from "./claude";
import { codexCatalog } from "./codex";
import { errorMessage } from "./errors";
import { setSetting } from "./settings";
import type { HarnessId } from "./worker";

export interface CatalogModel {
  selector: string; // what a stage names: "<provider>/<id>", "claude-code/<model>" or "codex/<model>"
  provider: string;
  name: string;
  contextWindow: number | null;
  // Dollars per million tokens, when omp knows them.
  cost: { input: number; output: number } | null;
}
export interface ModelCatalog {
  models: CatalogModel[];
  // Why a harness could not list its models; any model name may still be typed.
  errors: Partial<Record<HarnessId, string>>;
  at: string;
}

export const isModelStage = (v: unknown): v is ModelStage => MODEL_STAGES.some(s => s === v);

// `omp models --json` reads the providers this machine is logged in to, `claude auth status`
// whether Claude Code is signed in, and `codex debug models` what the app's Codex sign-in offers. That takes a second or two, so the list is kept for a while;
// `refresh` asks again (after `omp login` or `claude auth login`, say).
const KEEP_MS = 10 * 60_000;
let cached: ModelCatalog | null = null;
export async function modelCatalog(refresh = false): Promise<ModelCatalog> {
  if (cached && !refresh && Date.now() - Date.parse(cached.at) < KEEP_MS) return cached;
  const at = new Date().toISOString();
  const [omp, claude, codex] = await Promise.all([ompCatalog(), claudeCatalog(), codexCatalog()]);
  const errors: ModelCatalog["errors"] = {};
  if (omp.error) errors.omp = omp.error;
  if (claude.error) errors["claude-code"] = claude.error;
  if (codex.error) errors.codex = codex.error;
  cached = { models: [...omp.models, ...claude.models, ...codex.models], errors, at };
  return cached;
}

async function ompCatalog(): Promise<{ models: CatalogModel[]; error: string | null }> {
  if (!Bun.which("omp")) return { models: [], error: "omp is not installed" };
  try {
    const proc = Bun.spawn(["omp", "models", "--json"], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      proc.kill();
    }, 30_000);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `omp models exited with code ${code}`);
    return { models: parseCatalog(out), error: null };
  } catch (err) {
    return { models: [], error: errorMessage(err) };
  }
}

// The list as last read, without waiting: null until the first read finishes.
export const cachedCatalog = () => cached;

// The chat models in omp's JSON listing.
export function parseCatalog(json: string): CatalogModel[] {
  const parsed = JSON.parse(json) as { models?: unknown };
  if (!Array.isArray(parsed.models)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return parsed.models.flatMap((m: unknown): CatalogModel[] => {
    if (!m || typeof m !== "object") return [];
    const r = m as Record<string, unknown>;
    if (r["kind"] !== undefined && r["kind"] !== "chat") return [];
    const selector = typeof r["selector"] === "string" ? r["selector"] : null;
    const provider = typeof r["provider"] === "string" ? r["provider"] : (selector?.split("/")[0] ?? "");
    if (!selector) return [];
    const cost = r["cost"] && typeof r["cost"] === "object" ? (r["cost"] as Record<string, unknown>) : null;
    const input = num(cost?.["input"]),
      output = num(cost?.["output"]);
    return [
      {
        selector,
        provider,
        name: typeof r["name"] === "string" ? r["name"] : selector,
        contextWindow: num(r["contextWindow"]),
        cost: input !== null && output !== null ? { input, output } : null,
      },
    ];
  });
}

// Sets `models.<stage>` in config.local.yml and in the running config (src/settings.ts). null hands the
// stage back to omp's default.
export function setModel(stage: ModelStage, model: string | null, file = LOCAL_CONFIG) {
  setSetting(["models", stage], model, file);
}

// Each stage's model as the loaded config has it.
export const stageModels = () => Object.fromEntries(MODEL_STAGES.map(s => [s, config.models[s] ?? null])) as Record<ModelStage, string | null>;
