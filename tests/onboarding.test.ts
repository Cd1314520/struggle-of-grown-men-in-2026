import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { isAts } from "../src/ats";
import { config } from "../src/config";
import { parseCatalog, setModel } from "../src/models";
import { EXAMPLES, PLACEHOLDER, seedProfile } from "../src/profile";
import { loadRubric } from "../src/rubric";

const example = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");

describe("the example profile", () => {
  it("has every file the agents read, each readable as its reader parses it", () => {
    expect(readdirSync(EXAMPLES).sort()).toEqual([
      "answers.md",
      "companies.yml",
      "employers.yml",
      "personal.yml",
      "resume-notes.md",
      "rubric.yml",
      "targets.md",
    ]);
    const rubric = loadRubric(join(EXAMPLES, "rubric.yml"));
    expect(rubric.practice.criteria.length).toBeGreaterThan(0);
    expect(rubric.real.criteria.length).toBeGreaterThan(0);
    // The boards ship filled in: each one a board a scan can read, none of them twice.
    const boards = (YAML.parse(example("companies.yml")) as { companies: { name: string; ats: string; slug: string }[] }).companies;
    expect(boards.length).toBeGreaterThan(1000);
    expect(boards.filter(b => !b.name || !b.slug || !isAts(b.ats))).toEqual([]);
    expect(new Set(boards.map(b => `${b.ats}/${b.slug}`)).size).toBe(boards.length);
    expect(YAML.parse(example("employers.yml"))).toEqual({ frontier: [], practice: [] });
    expect(YAML.parse(example("personal.yml"))).toHaveProperty("prefill");
  });

  it("holds the app back only where a choice is the owner's to make", () => {
    // The placeholder check in src/profile.ts is what stops the app acting on a template.
    const marked = readdirSync(EXAMPLES).filter(f => example(f).includes(PLACEHOLDER));
    expect(marked.sort()).toEqual(["answers.md", "personal.yml", "targets.md"]);
    // Nothing that may be left as it is mentions the marker, or the file could never pass.
    for (const f of ["rubric.yml", "resume-notes.md", "companies.yml", "employers.yml"]) expect(example(f)).not.toContain(PLACEHOLDER);
  });

  it("is copied into a new profile, and never over a file already there", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-apply-seed-"));
    try {
      writeFileSync(join(dir, "targets.md"), "mine");
      const copied = seedProfile(dir);
      expect(copied).not.toContain("targets.md");
      expect(copied).toContain("rubric.yml");
      expect(readFileSync(join(dir, "targets.md"), "utf8")).toBe("mine");
      expect(readFileSync(join(dir, "rubric.yml"), "utf8")).toBe(example("rubric.yml"));
      expect(seedProfile(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("choosing a model", () => {
  it("reads omp's chat models with their prices", () => {
    const listed = JSON.stringify({
      models: [
        { provider: "acme", kind: "chat", id: "fast-1", selector: "acme/fast-1", name: "Fast 1", contextWindow: 1000, cost: { input: 0.5, output: 2 } },
        { provider: "acme", kind: "embedding", id: "embed", selector: "acme/embed" },
        { provider: "other", id: "free", selector: "other/free", name: "Free" },
      ],
    });
    expect(parseCatalog(listed)).toEqual([
      { selector: "acme/fast-1", provider: "acme", name: "Fast 1", contextWindow: 1000, cost: { input: 0.5, output: 2 } },
      { selector: "other/free", provider: "other", name: "Free", contextWindow: null, cost: null },
    ]);
  });

  it("writes the choice to config.local.yml, keeping the rest of the file, and to the running config", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-apply-models-"));
    const file = join(dir, "config.local.yml");
    const before = config.models.triage;
    try {
      writeFileSync(file, "# mine\nmailbox: me@example.com # the inbox\n");
      setModel("triage", "acme/fast-1", file);
      const text = readFileSync(file, "utf8");
      expect(text).toContain("# mine");
      expect(text).toContain("mailbox: me@example.com # the inbox");
      expect(YAML.parse(text)).toEqual({ mailbox: "me@example.com", models: { triage: "acme/fast-1" } });
      expect(config.models.triage).toBe("acme/fast-1");
      setModel("triage", null, file);
      expect(YAML.parse(readFileSync(file, "utf8"))).toEqual({ mailbox: "me@example.com", models: { triage: null } });

      // A file the app could not start with is left alone.
      writeFileSync(file, "mailbox: not-an-address\n");
      expect(() => {
        setModel("prep", "acme/fast-1", file);
      }).toThrow("mailbox");
      expect(readFileSync(file, "utf8")).toBe("mailbox: not-an-address\n");
    } finally {
      config.models.triage = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resume import", () => {
  it("turns uploads into a draft, and replaces the stock resume only once accepted", async () => {
    const root = mkdtempSync(join(tmpdir(), "auto-apply-import-"));
    try {
      const proc = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "resume-import.ts")], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, AUTO_APPLY_DATA: join(root, "data"), AUTO_APPLY_PROFILE: join(root, "profile"), AUTO_APPLY_RESUME_DIR: join(root, "resume") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(code, `${out}\n${err}`).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
