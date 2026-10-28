import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { config, LOCAL_CONFIG, overlay, ROOT, started, upgrade } from "./config";
import { configProblems } from "./config-check";

export const RESTART = ["port", "chrome", "concurrency.fill", "resume"] as const;
const needsRestart = (path: readonly string[]) => RESTART.some(prefix => path.join(".") === prefix || path.join(".").startsWith(`${prefix}.`));

const isSection = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const getIn = (value: unknown, path: readonly string[]): unknown => path.reduce<unknown>((at, key) => (isSection(at) ? at[key] : undefined), value);

export const readBase = (): unknown => upgrade(YAML.parse(readFileSync(join(ROOT, "config.yml"), "utf8")));
const readLocal = (file: string): unknown => upgrade((existsSync(file) ? YAML.parse(readFileSync(file, "utf8")) : null) ?? {});

export function settingsState(file = LOCAL_CONFIG) {
  const local = readLocal(file);
  const values = overlay(readBase(), local) as Record<string, unknown>;
  const pending = RESTART.filter(prefix => JSON.stringify(getIn(values, prefix.split("."))) !== JSON.stringify(getIn(started, prefix.split("."))));
  return { values, local, pending: [...pending], restart: [...RESTART], localConfig: file };
}

export function setSetting(path: readonly string[], value: unknown, file = LOCAL_CONFIG): { restart: boolean } {
  if (!path.length) throw new Error("name the setting to change");
  const doc = existsSync(file) ? YAML.parseDocument(readFileSync(file, "utf8")) : new YAML.Document({});
  if (doc.errors.length) throw new Error(`config.local.yml cannot be read: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  if (!doc.contents.items.length) doc.contents.flow = false;
  if (value === undefined) {
    doc.deleteIn(path);
    for (let depth = path.length - 1; depth > 0; depth--) {
      const parent = doc.getIn(path.slice(0, depth));
      if (YAML.isMap(parent) && !parent.items.length) doc.deleteIn(path.slice(0, depth));
    }
  } else doc.setIn(path, doc.createNode(value));
  const text = doc.toString();
  const merged = overlay(readBase(), upgrade(YAML.parse(text) ?? {}));
  const problems = configProblems(merged);
  if (problems.length) throw new Error(problems[0]);
  const staged = join(dirname(file), ".config.local.yml.tmp");
  writeFileSync(staged, text);
  renameSync(staged, file);
  const restart = needsRestart(path);
  if (!restart) {
    const parent = getIn(config, path.slice(0, -1));
    const key = path.at(-1) ?? "";
    const next = structuredClone(getIn(merged, path));
    if (isSection(parent)) {
      if (next === undefined) Reflect.deleteProperty(parent, key);
      else parent[key] = next;
    } else (config as unknown as Record<string, unknown>)[path[0] ?? ""] = structuredClone(getIn(merged, path.slice(0, 1)));
  }
  return { restart };
}
