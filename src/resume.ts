// The stock resume is a Typst project (content file + template). Each job gets its own copy to
// tailor; the PDF is always compiled to the same stock filename so uploads never look versioned.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config, DATA, jobDir, RESUME_DIR, STOCK_MAIN } from "./config";
import { errorMessage } from "./errors";

export const PDF_NAME = config.resume.pdfName;
export const MAIN = config.resume.main;

const typFiles = () => readdirSync(RESUME_DIR).filter(f => f.endsWith(".typ"));

// Fresh copy of the stock sources into a job's working directory.
export function stageResume(dir: string) {
  for (const f of typFiles()) copyFileSync(join(RESUME_DIR, f), join(dir, f));
}

// Template files (everything except the content file) must come back untouched.
export const changedTemplateFiles = (dir: string) =>
  typFiles().filter(f => f !== MAIN && (!existsSync(join(dir, f)) || !readFileSync(join(dir, f)).equals(readFileSync(join(RESUME_DIR, f)))));

export function pageCount(pdf: string): number | null {
  const out = Bun.spawnSync(["pdfinfo", pdf]).stdout.toString();
  const m = /^Pages:\s+(\d+)/m.exec(out);
  return m ? Number(m[1]) : null;
}

// Compile the current stock resume and return its page count (the ceiling for tailored copies).
export function stockPages(): number | null {
  const dir = join(DATA, "stock");
  mkdirSync(dir, { recursive: true });
  const res = Bun.spawnSync(["typst", "compile", "--root", RESUME_DIR, join(RESUME_DIR, MAIN), join(dir, PDF_NAME)]);
  if (res.exitCode !== 0) throw new Error(`stock resume does not compile: ${res.stderr.toString().slice(0, 400)}`);
  return pageCount(join(dir, PDF_NAME));
}

export const stockPdf = () => join(DATA, "stock", PDF_NAME);

// Compile a job's tailored copy in its working directory on the host, for workers whose sandbox
// cannot run typst. Returns typst's error, or null once the PDF is written.
export function compileWorking(dir: string): string | null {
  const res = Bun.spawnSync(["typst", "compile", "--root", dir, join(dir, MAIN), join(dir, PDF_NAME)]);
  return res.exitCode === 0 ? null : res.stderr.toString().slice(0, 1500) || `typst exited with ${res.exitCode}`;
}

// The stock resume as the Resume page shows it, compiled once per change to the project's files.
export interface StockResume {
  exists: boolean;
  pages: number | null;
  error: string | null; // why it does not compile
  updatedAt: string | null;
}
let compiled: { stamp: string; pages: number | null; error: string | null } | null = null;
export function stockResume(): StockResume {
  if (!existsSync(STOCK_MAIN)) return { exists: false, pages: null, error: null, updatedAt: null };
  const stamp = typFiles()
    .map(f => {
      const s = statSync(join(RESUME_DIR, f));
      return `${f}:${s.mtimeMs}:${s.size}`;
    })
    .join("|");
  if (compiled?.stamp !== stamp) {
    try {
      compiled = { stamp, pages: stockPages(), error: null };
    } catch (err) {
      compiled = { stamp, pages: null, error: errorMessage(err) };
    }
  }
  return { exists: true, pages: compiled.pages, error: compiled.error, updatedAt: statSync(STOCK_MAIN).mtime.toISOString() };
}

// One page of a PDF as a PNG: phones cannot embed PDFs, and an image is calmer than a PDF viewer on desktop.
export function pagePng(pdf: string, page = 1): Uint8Array | null {
  if (!existsSync(pdf)) return null;
  const out = Bun.spawnSync(["pdftoppm", "-png", "-r", "120", "-f", String(page), "-l", String(page), pdf]);
  return out.exitCode === 0 && out.stdout.length ? out.stdout : null;
}

export const workingPdf = (jobId: number) => join(jobDir(jobId), PDF_NAME);
const frozenDir = (jobId: number, sha: string) => join(jobDir(jobId), "applied", sha.slice(0, 12));

// Freeze the exact PDF (and its source) that an application will upload. The fill worker uploads
// the frozen copy, so what is recorded is what was sent, whatever happens to the working copy later.
export function freezeResume(jobId: number) {
  const pdf = workingPdf(jobId);
  const sha = createHash("sha256").update(readFileSync(pdf)).digest("hex");
  const dir = frozenDir(jobId, sha);
  if (existsSync(dir)) return frozenResume(jobId, sha); // Never replace previously frozen bytes.
  mkdirSync(join(jobDir(jobId), "applied"), { recursive: true });
  const staged = mkdtempSync(join(jobDir(jobId), "applied", ".freeze-"));
  try {
    copyFileSync(pdf, join(staged, PDF_NAME));
    const sources: Record<string, string> = {};
    for (const name of readdirSync(jobDir(jobId)).filter(name => name.endsWith(".typ"))) {
      copyFileSync(join(jobDir(jobId), name), join(staged, name));
      sources[name] = createHash("sha256")
        .update(readFileSync(join(staged, name)))
        .digest("hex");
      chmodSync(join(staged, name), 0o444);
    }
    if (!sources[MAIN]) throw new Error("frozen resume main source missing");
    writeFileSync(join(staged, "manifest.json"), JSON.stringify({ version: 1, resumeSha: sha, sources }) + "\n", { mode: 0o444 });
    chmodSync(join(staged, PDF_NAME), 0o444);
    renameSync(staged, dir);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
  return frozenResume(jobId, sha);
}

// Fail closed on missing/corrupt frozen artifacts. Never substitute the mutable working PDF.
export function frozenResume(jobId: number, sha: string) {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error("invalid frozen resume SHA");
  const dir = frozenDir(jobId, sha);
  const pdf = join(dir, PDF_NAME);
  if (createHash("sha256").update(readFileSync(pdf)).digest("hex") !== sha) throw new Error("frozen resume PDF SHA mismatch");
  if (!existsSync(join(dir, "manifest.json"))) throw new Error("legacy frozen source has no SHA manifest; inspect/seal original sources before resuming");
  const manifest: unknown = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("version" in manifest) ||
    manifest.version !== 1 ||
    !("resumeSha" in manifest) ||
    manifest.resumeSha !== sha ||
    !("sources" in manifest) ||
    !manifest.sources ||
    typeof manifest.sources !== "object" ||
    Array.isArray(manifest.sources) ||
    !(MAIN in manifest.sources)
  )
    throw new Error("invalid frozen source manifest");
  for (const [name, hash] of Object.entries(manifest.sources)) {
    if (
      !/^[^/\\]+\.typ$/.test(name) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      createHash("sha256")
        .update(readFileSync(join(dir, name)))
        .digest("hex") !== hash
    )
      throw new Error(`frozen resume source SHA mismatch: ${name}`);
  }
  return { sha, pdf };
}

// What to show for a job: the frozen copy once one exists, otherwise the working copy.
export function resumeFiles(jobId: number, sha: string | null) {
  const dir = sha && existsSync(frozenDir(jobId, sha)) ? frozenDir(jobId, sha) : jobDir(jobId);
  return { pdf: join(dir, PDF_NAME), main: join(dir, MAIN), frozen: dir !== jobDir(jobId) };
}
