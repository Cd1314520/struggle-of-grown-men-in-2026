// Every setting in config.yml, changed from the Settings page. A change is written to config.local.yml
// (laid over config.yml), keeping the file's comments and every other key, after the result is checked
// as the app would read it at start. A setting read as the app runs is also set in the loaded config, so
// it holds from the next time it is read; one read only at start (RESTART) waits for a restart.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { config, LOCAL_CONFIG, overlay, ROOT, started } from "./config";
import { configProblems } from "./config-check";

// Read once, at start: the server's port, the browsers and their ports (started with the app, one per
// fill slot), and the resume project's names.
export const RESTART = ["port", "chrome", "concurrency.fill", "resume"] as const;
const needsRestart = (path: readonly string[]) => RESTART.some(prefix => path.join(".") === prefix || path.join(".").startsWith(`${prefix}.`));

const isSection = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const getIn = (value: unknown, path: readonly string[]): unknown => path.reduce<unknown>((at, key) => (isSection(at) ? at[key] : undefined), value);

export const readBase = (): unknown => YAML.parse(readFileSync(join(ROOT, "config.yml"), "utf8"));
const readLocal = (file: string): unknown => (existsSync(file) ? YAML.parse(readFileSync(file, "utf8")) : null) ?? {};

// The settings as the files have them (what the app runs with, or will after a restart), which of them
// config.local.yml sets, and those saved but not yet in use.
export function settingsState(file = LOCAL_CONFIG) {
  const local = readLocal(file);
  const values = overlay(readBase(), local) as Record<string, unknown>;
  const pending = RESTART.filter(prefix => JSON.stringify(getIn(values, prefix.split("."))) !== JSON.stringify(getIn(started, prefix.split("."))));
  return { values, local, pending: [...pending], restart: [...RESTART], localConfig: file };
}

// Sets `path` in config.local.yml to `value`; undefined removes it there, handing it back to config.yml.
// Says whether it waits for a restart.
export function setSetting(path: readonly string[], value: unknown, file = LOCAL_CONFIG): { restart: boolean } {
  if (!path.length) throw new Error("name the setting to change");
  const doc = existsSync(file) ? YAML.parseDocument(readFileSync(file, "utf8")) : new YAML.Document({});
  if (doc.errors.length) throw new Error(`config.local.yml cannot be read: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  // A file every setting was reset out of reads `{}`: what is added to it goes in as lines, not braces.
  if (!doc.contents.items.length) doc.contents.flow = false;
  if (value === undefined) {
    doc.deleteIn(path);
    // A section left empty goes too.
    for (let depth = path.length - 1; depth > 0; depth--) {
      const parent = doc.getIn(path.slice(0, depth));
      if (YAML.isMap(parent) && !parent.items.length) doc.deleteIn(path.slice(0, depth));
    }
  } else doc.setIn(path, doc.createNode(value));
  const text = doc.toString();
  const merged = overlay(readBase(), YAML.parse(text) ?? {});
  const problems = configProblems(merged);
  if (problems.length) throw new Error(problems[0]);
  const staged = join(dirname(file), ".config.local.yml.tmp");
  writeFileSync(staged, text);
  renameSync(staged, file);
  const restart = needsRestart(path);
  if (!restart) {
    // The loaded config takes the merged value, so a removed key falls back to config.yml's.
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
