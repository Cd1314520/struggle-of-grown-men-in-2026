// The models agents run on: which ones omp can reach, and the choice per stage. A choice made in the
// app is written to config.local.yml (laid over config.yml) and to the loaded config, so the next
// worker of that stage uses it without a restart.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { config, LOCAL_CONFIG, MODEL_STAGES, overlay, ROOT, type ModelStage } from "./config";
import { configProblems } from "./config-check";
import { errorMessage } from "./errors";

export interface CatalogModel {
  selector: string; // what --model takes: "<provider>/<id>"
  provider: string;
  name: string;
  contextWindow: number | null;
  // Dollars per million tokens, when omp knows them.
  cost: { input: number; output: number } | null;
}
export interface ModelCatalog {
  models: CatalogModel[];
  error: string | null; // why omp could not list them; any model name may still be typed
  at: string;
}

export const isModelStage = (v: unknown): v is ModelStage => MODEL_STAGES.some(s => s === v);

// `omp models --json` reads the providers this machine is logged in to. It takes a second or two, so
// the list is kept for a while; `refresh` asks again (after `omp login`, say).
const KEEP_MS = 10 * 60_000;
let cached: ModelCatalog | null = null;
export async function modelCatalog(refresh = false): Promise<ModelCatalog> {
  if (cached && !refresh && Date.now() - Date.parse(cached.at) < KEEP_MS) return cached;
  const at = new Date().toISOString();
  try {
    const proc = Bun.spawn(["omp", "models", "--json"], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      proc.kill();
    }, 30_000);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `omp models exited with code ${code}`);
    cached = { models: parseCatalog(out), error: null, at };
  } catch (err) {
    cached = { models: [], error: errorMessage(err), at };
  }
  return cached;
}

// The list as last read, without waiting for omp: null until the first read finishes.
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

// Sets `models.<stage>` in config.local.yml, keeping the file's comments and every other key, and in the
// running config. null hands the stage back to omp's default. The file is checked as the app would read
// it at start before it is replaced.
export function setModel(stage: ModelStage, model: string | null, file = LOCAL_CONFIG) {
  const doc = existsSync(file) ? YAML.parseDocument(readFileSync(file, "utf8")) : new YAML.Document({});
  if (doc.errors.length) throw new Error(`config.local.yml cannot be read: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  doc.setIn(["models", stage], model);
  const text = doc.toString();
  const base: unknown = YAML.parse(readFileSync(join(ROOT, "config.yml"), "utf8"));
  const problems = configProblems(overlay(base, YAML.parse(text)));
  if (problems.length) throw new Error(`config.local.yml would not load: ${problems[0]}`);
  const staged = join(dirname(file), ".config.local.yml.tmp");
  writeFileSync(staged, text);
  renameSync(staged, file);
  config.models[stage] = model;
}

// Each stage's model as the loaded config has it.
export const stageModels = () => Object.fromEntries(MODEL_STAGES.map(s => [s, config.models[s] ?? null])) as Record<ModelStage, string | null>;
