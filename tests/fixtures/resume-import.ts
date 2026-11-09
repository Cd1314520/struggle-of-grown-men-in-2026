import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { DATA, PROFILE, RESUME_DIR, ROOT, STOCK_MAIN } = await import("../../src/config");
const imp = await import("../../src/resume-import");
type RunWorker = import("../../src/worker").RunWorker;
type WorkerOptions = Parameters<RunWorker>[0];

mkdirSync(RESUME_DIR, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
copyFileSync(join(ROOT, "basic-resume", "resume.typ"), join(RESUME_DIR, "resume.typ"));
writeFileSync(STOCK_MAIN, "// the old resume\n");
writeFileSync(join(PROFILE, "resume-notes.md"), "# Resume notes\n");

const worker =
  (act: (opts: WorkerOptions) => Promise<string | null> | string | null, status: "completed" | "aborted" = "completed"): RunWorker =>
  opts => ({
    done: Promise.resolve(act(opts)).then(reply => ({ status, lastText: reply ?? "" })),
    abort: () => undefined,
  });
const finish = (opts: WorkerOptions) => opts.tools["finish_import"]?.handler({ summary: "One page from the PDF.", warnings: "" }) ?? null;
const compiled = () => ({ pages: 1, error: null });
const upload = (name: string, text: string) => Object.assign(new Blob([text]), { name });

assert.equal(await imp.beginImport([upload("../My Resume.txt", "Jane Doe, engineer"), upload("My Resume.txt", "more")], "one page"), null);
assert.equal(imp.importState().status, "running");
assert.equal(await imp.beginImport([upload("x.txt", "x")], ""), "an import is already running");
const work = join(DATA, "resume-import", "work");
assert.deepEqual(readdirSync(join(work, "sources")).sort(), ["My Resume (2).txt", "My Resume.txt"]);

let replies: string[] = [];
await imp.runImport(
  worker(async opts => {
    assert.match(opts.prompt, /one page/);
    assert.equal(opts.cwd, work);
    writeFileSync(join(work, "main.typ"), "// Jane Doe\n");
    writeFileSync(join(work, "resume.typ"), "// changed\n");
    replies.push(String(await finish(opts)));
    copyFileSync(join(RESUME_DIR, "resume.typ"), join(work, "resume.typ"));
    writeFileSync(join(work, "resume-notes.md"), "# Resume notes\n\n## Extra projects\n\n- Trailmap\n");
    replies.push(String(await finish(opts)));
    return null;
  }),
  undefined,
  compiled,
);
assert.match(replies[0] ?? "", /^ERROR: template files were changed: resume\.typ/);
assert.equal(replies[1], "Done. The candidate reviews the draft now.");
let state = imp.importState();
assert.equal(state.status, "ready");
assert.equal(state.pages, 1);
assert.equal(state.notesChanged, true);
assert.equal(readFileSync(STOCK_MAIN, "utf8"), "// the old resume\n");

assert.equal(imp.reviseImport("drop the summary"), null);
await imp.runImport(
  worker(opts => {
    assert.match(opts.prompt, /drop the summary/);
    return "could not compile";
  }),
  undefined,
  compiled,
);
state = imp.importState();
assert.equal(state.status, "failed");
assert.equal(state.error, "could not compile");
assert.equal(imp.acceptImport(true), "there is no draft to use");

assert.equal(imp.reviseImport("drop the summary"), null);
replies = [];
await imp.runImport(
  worker(async opts => {
    replies.push(String(await finish(opts)));
    return null;
  }),
  undefined,
  compiled,
);
assert.equal(imp.acceptImport(true), null);
assert.equal(readFileSync(STOCK_MAIN, "utf8"), "// Jane Doe\n");
assert.match(readFileSync(join(PROFILE, "resume-notes.md"), "utf8"), /Trailmap/);
const history = readdirSync(join(DATA, "resume-import", "history"));
assert.equal(history.filter(f => f.endsWith("-main.typ")).length, 1);
assert.equal(history.filter(f => f.endsWith("-resume-notes.md")).length, 1);
assert.equal(imp.importState().status, "idle");
assert.ok(!existsSync(work));

assert.equal(await imp.beginImport([upload("cv.md", "# Jane")], ""), null);
const control = { handle: null, cancelled: false };
await imp.runImport(
  worker(() => {
    control.cancelled = true;
    return null;
  }, "aborted"),
  control,
  compiled,
);
assert.equal(imp.importState().status, "idle");
assert.ok(!existsSync(work));

assert.equal(await imp.beginImport([upload("cv.md", "# Jane")], ""), null);
imp.interruptedImport();
assert.equal(imp.importState().status, "failed");
assert.equal(imp.discardImport(), null);
assert.equal(imp.importState().status, "idle");
