// Resume import: whatever files the owner has (an old resume in any format, a LinkedIn export, a list of
// projects) become the stock resume's content file, written by an agent on the project's own template, and
// the resume notes tailoring draws on. Nothing replaces the stock resume until the owner accepts the draft.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { config, DATA, PROFILE, readProfile, RESUME_DIR, STOCK_MAIN } from "./config";
import { lastEventId, logEvent, workerEvents } from "./db";
import { errorMessage } from "./errors";
import { arg, S, schema, type RunWorker, type WorkerHandle } from "./worker";
import { MAIN, pageCount, PDF_NAME } from "./resume";
import { readPrompt } from "./worker-tools";
import { fillTemplate } from "./template";

const DIR = join(DATA, "resume-import");
const WORK = join(DIR, "work"); // the agent's working directory: the template, the uploads under sources/, and its draft
const STATE = join(DIR, "state.json");
const HISTORY = join(DIR, "history"); // each stock resume and notes file an accepted import replaced

export const MAX_FILES = 8;
export const MAX_BYTES = 20 * 1024 * 1024; // all files together

export interface ImportState {
  status: "idle" | "running" | "ready" | "failed";
  files: string[];
  note: string; // what the owner asked for along with the files
  feedback: string[]; // each change asked for since, oldest first
  startedAt: string | null;
  finishedAt: string | null;
  sinceEvent: number; // the run's steps are the import worker's events after this id
  summary: string | null;
  warnings: string | null;
  pages: number | null;
  notesChanged: boolean; // the draft adds to resume-notes.md
  error: string | null;
}
const IDLE: ImportState = {
  status: "idle",
  files: [],
  note: "",
  feedback: [],
  startedAt: null,
  finishedAt: null,
  sinceEvent: 0,
  summary: null,
  warnings: null,
  pages: null,
  notesChanged: false,
  error: null,
};

export function importState(): ImportState {
  try {
    return { ...IDLE, ...(JSON.parse(readFileSync(STATE, "utf8")) as Partial<ImportState>) };
  } catch {
    return IDLE;
  }
}
function save(state: ImportState) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 1));
}
// The import worker's latest steps, for the page to show while it works.
export const importSteps = (s = importState()) =>
  s.status === "running" ? workerEvents("import", s.sinceEvent).map(e => ({ message: e.message, at: e.at })) : [];

export const draftPdf = () => join(WORK, PDF_NAME);
const draftNotes = () => join(WORK, "resume-notes.md");

// A name that stays inside sources/ and reads as the owner's file did.
const safeName = (name: string, taken: Set<string>) => {
  const clean =
    basename(name)
      .replace(/[^\w.() -]+/g, "_")
      .replace(/^\.+/, "") || "file";
  let candidate = clean;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = clean.replace(/(\.[^.]*)?$/, ext => ` (${n})${ext}`);
  taken.add(candidate.toLowerCase());
  return candidate;
};

// Text the agent can read without tools of its own: PDFs through pdftotext, Word files from their XML.
function extractText(file: string) {
  try {
    if (/\.pdf$/i.test(file)) {
      Bun.spawnSync(["pdftotext", "-layout", file, `${file}.txt`]);
    } else if (/\.docx$/i.test(file)) {
      // Windows has no unzip; its own tar reads zip archives.
      const unzip = process.platform === "win32" ? [join(process.env["SYSTEMROOT"] ?? "C:\\Windows", "System32", "tar.exe"), "-xOf"] : ["unzip", "-p"];
      const xml = Bun.spawnSync([...unzip, file, "word/document.xml"]).stdout.toString();
      const text = xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      if (text.trim()) writeFileSync(`${file}.txt`, text);
    }
  } catch {
    // no converter on this machine: the agent reads the file itself
  }
}

// The template files as the agent must leave them: every .typ in the resume project but the content file.
const templateFiles = () => readdirSync(RESUME_DIR).filter(f => f.endsWith(".typ") && f !== MAIN);

// Takes the uploaded files and readies a run. The caller starts the worker (Scheduler.importResume).
export async function beginImport(files: readonly (Blob & { name: string })[], note: string): Promise<string | null> {
  if (importState().status === "running") return "an import is already running";
  if (!files.length) return "choose at least one file";
  if (files.length > MAX_FILES) return `at most ${MAX_FILES} files at a time`;
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return `the files come to more than ${MAX_BYTES / 1024 / 1024} MB together`;
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, "sources"), { recursive: true });
  const taken = new Set<string>();
  const names: string[] = [];
  for (const f of files) {
    const name = safeName(f.name, taken);
    const path = join(WORK, "sources", name);
    await Bun.write(path, f);
    extractText(path);
    names.push(name);
  }
  for (const f of templateFiles()) copyFileSync(join(RESUME_DIR, f), join(WORK, f));
  writeFileSync(draftNotes(), readProfile("resume-notes.md"));
  save({ ...IDLE, status: "running", files: names, note: note.trim(), startedAt: new Date().toISOString(), sinceEvent: lastEventId() });
  logEvent("user", `resume import started from ${names.join(", ")}`);
  return null;
}

// Another pass over the same files and the draft, with what the owner wants changed.
export function reviseImport(feedback: string): string | null {
  const s = importState();
  if (s.status !== "ready" && s.status !== "failed") return "there is no draft to change";
  if (!feedback.trim()) return "say what to change";
  if (!existsSync(join(WORK, "sources"))) return "the uploaded files are gone; import them again";
  save({ ...s, status: "running", feedback: [...s.feedback, feedback.trim()], error: null, startedAt: new Date().toISOString(), sinceEvent: lastEventId() });
  logEvent("user", `resume import: asked for changes: ${feedback.trim()}`);
  return null;
}

export interface Compiled {
  pages: number | null;
  error: string | null;
}
function compileDraft(): Compiled {
  try {
    const res = Bun.spawnSync(["typst", "compile", "--root", WORK, join(WORK, MAIN), draftPdf()]);
    if (res.exitCode !== 0) return { pages: null, error: res.stderr.toString().slice(0, 1500) };
    return { pages: pageCount(draftPdf()), error: null };
  } catch (err) {
    return { pages: null, error: errorMessage(err) };
  }
}

// What the caller holds of a run: its worker, once started, and whether the owner cancelled it.
export interface ImportRun {
  handle: WorkerHandle | null;
  cancelled: boolean;
}

// Runs the import worker over the readied files.
export async function runImport(run: RunWorker, control: ImportRun = { handle: null, cancelled: false }, compile: () => Compiled = compileDraft) {
  const s = importState();
  if (s.status !== "running") return;
  const draftExists = existsSync(join(WORK, MAIN));
  const revising = s.feedback.length > 0 && draftExists;
  let finished = false as boolean; // set from the tool callback
  const handle = run({
    name: "import",
    builtins: ["read", "write", "edit", "bash"],
    model: config.models.import ?? null,
    cwd: WORK,
    maxTime: "20m",
    prompt: fillTemplate(
      readPrompt("import"),
      {
        files: s.files.map(f => `\`sources/${f}\``).join(", "),
        main: MAIN,
        pdfName: PDF_NAME,
        draft: revising
          ? "your earlier draft. Change it as the candidate asks below, and keep the rest."
          : "does not exist yet: you write it. The candidate's current resume, if they had one here, is not used.",
        note: s.note ? `\n## Note from the candidate\n\n${s.note}\n` : "",
        feedback: revising ? `\n## Changes the candidate asked for (latest last)\n\n${s.feedback.map(f => `- ${f}`).join("\n")}\n` : "",
      },
      "prompts/import.md",
    ),
    tools: {
      finish_import: {
        description: "Report the finished draft. The host compiles it and checks the template; an ERROR reply says what to fix.",
        parameters: schema({
          summary: S.str("Two or three short sentences: what the resume holds, and what went into the notes"),
          warnings: S.str("Up to four short lines the candidate should check, one per line; empty if none"),
        }),
        handler: args => {
          if (!existsSync(join(WORK, MAIN))) return `ERROR: ${MAIN} does not exist in your working directory.`;
          const changed = templateFiles().filter(f => !existsSync(join(WORK, f)) || !readFileSync(join(WORK, f)).equals(readFileSync(join(RESUME_DIR, f))));
          if (changed.length) return `ERROR: template files were changed: ${changed.join(", ")}. Put them back as they were; edit ${MAIN} only.`;
          const out = compile();
          if (out.error) return `ERROR: ${MAIN} does not compile:\n${out.error}`;
          if (out.pages !== null && out.pages > 2)
            return `ERROR: the resume is ${out.pages} pages. Keep it to one page, two at most; move the rest into resume-notes.md.`;
          const notes = existsSync(draftNotes()) ? readFileSync(draftNotes(), "utf8") : "";
          finished = true;
          save({
            ...importState(),
            status: "ready",
            finishedAt: new Date().toISOString(),
            summary: arg.str(args, "summary").trim(),
            warnings: arg.str(args, "warnings").trim() || null,
            pages: out.pages,
            notesChanged: !!notes.trim() && notes !== readProfile("resume-notes.md"),
            error: null,
          });
          logEvent("system", `Resume import: a draft is ready to review (${out.pages ?? "?"} page${out.pages === 1 ? "" : "s"})`);
          return "Done. The candidate reviews the draft now.";
        },
      },
    },
  });
  control.handle = handle;
  const result = await handle.done;
  if (finished) return;
  const cancelled = control.cancelled;
  // A first run cancelled leaves nothing worth keeping; a revision cancelled may have half changed the draft.
  if (cancelled && !revising) clearImport();
  else
    save({
      ...importState(),
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: cancelled
        ? "Cancelled. The draft may be half changed: ask for the change again, or discard it."
        : result.error || result.lastText || "the agent stopped without a draft",
    });
  logEvent(cancelled ? "system" : "error", cancelled ? "Resume import cancelled" : `Resume import failed: ${result.error ?? "no draft"}`);
}

// A run the process was killed in the middle of: it will never report.
export function interruptedImport() {
  const s = importState();
  if (s.status === "running") save({ ...s, status: "failed", error: "interrupted when the app restarted; try again", finishedAt: new Date().toISOString() });
}

// Makes the draft the stock resume, and its notes the resume notes when `notes`. What they replace is kept.
export function acceptImport(notes: boolean): string | null {
  const s = importState();
  if (s.status !== "ready") return "there is no draft to use";
  if (!existsSync(join(WORK, MAIN))) return "the draft is gone; import again";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(HISTORY, { recursive: true });
  if (existsSync(STOCK_MAIN)) copyFileSync(STOCK_MAIN, join(HISTORY, `${stamp}-${MAIN}`));
  mkdirSync(RESUME_DIR, { recursive: true });
  copyFileSync(join(WORK, MAIN), STOCK_MAIN);
  const withNotes = notes && s.notesChanged && existsSync(draftNotes());
  if (withNotes) {
    const current = join(PROFILE, "resume-notes.md");
    if (existsSync(current)) copyFileSync(current, join(HISTORY, `${stamp}-resume-notes.md`));
    copyFileSync(draftNotes(), current);
  }
  clearImport();
  logEvent(
    "user",
    `replaced the stock resume${withNotes ? " and the resume notes" : ""} with the imported draft (earlier copies in data/resume-import/history)`,
  );
  return null;
}

export function discardImport(): string | null {
  const s = importState();
  if (s.status === "running") return "the import is still running; cancel it first";
  clearImport();
  logEvent("user", "discarded the resume import");
  return null;
}

function clearImport() {
  rmSync(WORK, { recursive: true, force: true });
  save(IDLE);
}
