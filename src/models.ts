import { config, LOCAL_CONFIG, MODEL_STAGES, type ModelStage } from "./config";
import { claudeCatalog } from "./claude";
import { errorMessage } from "./errors";
import { setSetting } from "./settings";
import type { HarnessId } from "./worker";

export interface CatalogModel {
  selector: string;
  provider: string;
  name: string;
  contextWindow: number | null;
  cost: { input: number; output: number } | null;
}
export interface ModelCatalog {
  models: CatalogModel[];
  errors: Partial<Record<HarnessId, string>>;
  at: string;
}

export const isModelStage = (v: unknown): v is ModelStage => MODEL_STAGES.some(s => s === v);

const KEEP_MS = 10 * 60_000;
let cached: ModelCatalog | null = null;
export async function modelCatalog(refresh = false): Promise<ModelCatalog> {
  if (cached && !refresh && Date.now() - Date.parse(cached.at) < KEEP_MS) return cached;
  const at = new Date().toISOString();
  const [omp, claude] = await Promise.all([ompCatalog(), claudeCatalog()]);
  const errors: ModelCatalog["errors"] = {};
  if (omp.error) errors.omp = omp.error;
  if (claude.error) errors["claude-code"] = claude.error;
  cached = { models: [...omp.models, ...claude.models], errors, at };
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

export const cachedCatalog = () => cached;

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

export function setModel(stage: ModelStage, model: string | null, file = LOCAL_CONFIG) {
  setSetting(["models", stage], model, file);
}

export const stageModels = () => Object.fromEntries(MODEL_STAGES.map(s => [s, config.models[s] ?? null])) as Record<ModelStage, string | null>;
