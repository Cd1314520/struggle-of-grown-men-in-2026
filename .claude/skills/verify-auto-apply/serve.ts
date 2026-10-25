// Verification instance of auto-apply: the real HTTP handler and the real scheduler on a throwaway
// port and data directory, with the outside world replaced by stand-ins. Started by ctl.sh; see SKILL.md.
//
// What is real: src/server.ts createHandler, src/scheduler.ts, the database and its migrations, every
// status move, gate, answer and frozen resume, and the UI in ui/.
// What is a stand-in: the agent runner and the browser (the two things a Scheduler takes as constructor
// arguments), and outbound network, which is refused. Nothing here can reach the live Chrome on the
// configured CDP port, a model, the mailbox or a job board.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JobBrowser } from "../../../src/chrome";
import type { Browser } from "../../../src/fill-session";
import type { RunWorker, WorkerHandle, WorkerOptions } from "../../../src/omp";

const REPO = resolve(import.meta.dir, "../../..");
const STATE = process.env["VERIFY_STATE"];
const PORT = Number(process.env["VERIFY_PORT"]);
if (!STATE || !Number.isInteger(PORT) || PORT < 1024) throw new Error("VERIFY_STATE and VERIFY_PORT are required; start this through ctl.sh");
if (resolve(STATE) === join(REPO, "data") || !resolve(STATE).includes("verify")) throw new Error(`Refusing to use ${STATE} as throwaway state`);

// Set before any app module is loaded: src/config.ts reads these when it is imported.
const DATA = join(STATE, "data");
const PROFILE = join(STATE, "profile");
const RESUME = join(STATE, "resume");
for (const dir of [DATA, PROFILE, RESUME]) mkdirSync(dir, { recursive: true });
Object.assign(process.env, {
  NODE_ENV: "test", // config.yml alone: config.local.yml (the owner's addresses and mailbox) is not read
  AUTO_APPLY_DATA: DATA,
  AUTO_APPLY_PROFILE: PROFILE,
  AUTO_APPLY_RESUME_DIR: RESUME,
  AUTO_APPLY_PORT: String(PORT),
});

// Outbound network is refused outright. Scans, posting look-ups, Gmail and the CDP calls the server
// makes for /api/browser/* all go through fetch, and none of them may leave this process.
const refused: string[] = [];
globalThis.fetch = Object.assign(
  (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    refused.push(url);
    return Promise.reject(new Error(`verification instance: outbound request refused (${new URL(url).host})`));
  },
  { preconnect: globalThis.fetch.preconnect },
);

const { config, jobDir } = await import("../../../src/config");
config.schedule = { scanMinutes: 0, discoverMinutes: 0, trackMinutes: 0 }; // nothing runs unasked
config.autoApply = { enabled: false }; // every application waits at gate 1
config.confirmBeforeSubmit = true; // and again at gate 2
config.concurrency.fill = 1;
config.fillPauseSeconds = [0, 0];
config.limits.applySpreadHours = 0; // a new application starts as soon as the slot is free, not ~14 min apart
config.chrome.vncPort = 0; // no links to the live browser views
config.chrome.cdpPort = PORT + 2; // nothing listens here; the live Chrome's port is never named

const { db, getJob, insertJob, logEvent, updateJob } = await import("../../../src/db");
const { MAIN, PDF_NAME } = await import("../../../src/resume");
const { createHandler } = await import("../../../src/server");
const { Scheduler } = await import("../../../src/scheduler");

// ---- stand-in browser: tabs exist only as names

const tabs = new Map<string, string>(); // tab id -> url
let nextTab = 0;
const browser: Browser = {
  ensureChrome: () => Promise.resolve(),
  pruneTabs: () => Promise.resolve(),
  screenshot: () => Promise.resolve(null),
  tabs: () => Promise.resolve([...tabs].map(([id, url]) => ({ id, title: "Stand-in application form", url, ws: "" }))),
  activateApplicationTab: (_slot, tabId) => (tabs.has(tabId) ? Promise.resolve() : Promise.reject(new Error("Saved application tab is missing"))),
  prepareJobBrowser: (_slot, saved, excluded): Promise<JobBrowser> => {
    if (saved && excluded.has(saved)) return Promise.reject(new Error("Checkpoint tab is also assigned to another application"));
    const reused = saved !== null && tabs.has(saved);
    const tabId = reused ? saved : `verify-tab-${++nextTab}`;
    tabs.set(tabId, `https://ats.verify.invalid/draft/${tabId}`);
    let revoked = false;
    const stop = () => {
      revoked = true;
    };
    return Promise.resolve({ tabId, reused, port: 0, ownsTarget: target => !revoked && target === tabId, revoke: stop, close: stop });
  },
};

// ---- stand-in agent runner
//
// A fill worker acts out a fixed script through the same host tools a real one is given, so gates,
// answers, approvals and outcomes are written by src/fill-tools.ts exactly as in production. The
// script is chosen by a word in the posting URL (see SCRIPTS in SKILL.md). Any other worker (prep,
// triage, locate, track) ends at once with an error: those need a model.
const STEP_MS = 400;
const handedOff = new Set<number>(); // jobs whose script already asked for browser help once

async function actOut(opts: WorkerOptions, stopped: () => boolean) {
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    await Bun.sleep(STEP_MS);
    const tool = opts.tools[name];
    if (stopped() || !tool) return "STOPPED";
    let reply: string;
    try {
      reply = await tool.handler(args);
    } catch (err) {
      // A tool refusing its arguments: logged, or the script's drift from the tools goes unseen.
      console.log(`[worker job ${opts.jobId}] ${name} threw: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    console.log(`[worker job ${opts.jobId}] ${name} -> ${reply.split("\n")[0]?.slice(0, 120)}`);
    return reply;
  };
  const going = (reply: string) => !stopped() && !/^(PARKED|ERROR|STOPPED)/.test(reply);
  const jobId = opts.jobId ?? 0;
  const posting = getJob(jobId)?.url ?? "https://unknown.invalid/";
  const script = /\b(question|cover-letter|manual|fail)\b/.exec(new URL(posting).pathname)?.[1] ?? "straight";

  const owned = JSON.parse(await call("application_tabs")) as { tab_id: string; url: string }[];
  const tab = owned[0];
  if (!tab) return;
  const nav = { tab_id: tab.tab_id, url: tab.url, step: `Job ${jobId} / stand-in form`, notes: "stand-in draft; nothing was typed into a real site" };

  if (script === "fail") {
    await call("report_result", { outcome: "failed", cause: "site_down", note: "stand-in worker: scripted failure" });
    return;
  }
  if (script === "question") {
    const reply = await call("ask_user", {
      ...nav,
      question: "What is your desired annual base salary in USD?",
      context: "Compensation section of the stand-in application form. Required field.",
      options: [],
    });
    if (!going(reply)) return;
  }
  if (script === "cover-letter") {
    const reply = await call("ask_cover_letter", { ...nav, prompt: "Cover letter (required, plain text, at most 300 words)" });
    if (!going(reply)) return;
  }
  if (script === "manual" && !handedOff.has(jobId)) {
    handedOff.add(jobId);
    await call("need_manual", { ...nav, cause: "captcha", reason: "Stand-in CAPTCHA: the form asked for a check only a person can pass." });
    return;
  }
  const approved = await call("confirm_submit", { ...nav, summary: `Stand-in application for job ${jobId}: name, email and resume ${PDF_NAME} entered.` });
  if (!approved.startsWith("APPROVED")) return;
  await call("report_result", { outcome: "submitted", note: "stand-in worker: confirmation page observed (no real site was contacted)" });
}

const runWorker: RunWorker = (opts): WorkerHandle => {
  const { promise: done, resolve: finish } = Promise.withResolvers<Awaited<WorkerHandle["done"]>>();
  let stopped = false;
  const end = (status: "completed" | "aborted" | "error", error?: string) => {
    stopped = true;
    finish({ status, lastText: "", ...(error ? { error } : {}) });
  };
  if (opts.name !== "fill") setTimeout(end, STEP_MS, "error", `verification instance has no model: the ${opts.name} worker cannot run`);
  else
    void actOut(opts, () => stopped).then(
      () => {
        end("completed");
      },
      (err: unknown) => {
        end("error", err instanceof Error ? err.message : String(err));
      },
    );
  return {
    done,
    abort: () => {
      end("aborted");
    },
  };
};

// ---- seed data: only into an empty database

const SEED: { script: string; title: string; status: "awaiting_approval" | "held" | "failed" | "submitted"; score: number }[] = [
  { script: "straight", title: "Backend Engineer (straight through)", status: "awaiting_approval", score: 84 },
  { script: "question", title: "Platform Engineer (asks a question)", status: "awaiting_approval", score: 78 },
  { script: "cover-letter", title: "Data Engineer (wants a cover letter)", status: "awaiting_approval", score: 73 },
  { script: "manual", title: "Site Reliability Engineer (needs browser help)", status: "awaiting_approval", score: 69 },
  { script: "fail", title: "Full Stack Developer (worker fails)", status: "awaiting_approval", score: 66 },
  { script: "straight", title: "Support Engineer (reject me)", status: "awaiting_approval", score: 61 },
  { script: "straight", title: "Staff Engineer (held)", status: "held", score: 91 },
  { script: "straight", title: "QA Engineer (failed earlier)", status: "failed", score: 64 },
  { script: "straight", title: "Software Engineer (already sent)", status: "submitted", score: 80 },
];
function seed() {
  if (db.query<{ n: number }, []>("SELECT count(*) AS n FROM jobs").get()?.n) return;
  writeFileSync(join(RESUME, MAIN), "// stand-in stock resume source\n");
  SEED.forEach((s, i) => {
    const company = `Verify Co ${String.fromCharCode(65 + i)}`;
    const id = insertJob(
      {
        url: `https://ats.verify.invalid/${s.script}/${i + 1}`,
        source: "verify-seed",
        company,
        title: s.title,
        location: "Remote (US)",
        description: `Seeded posting ${i + 1}.`,
      },
      "triaged",
    );
    if (!id) throw new Error(`seed job ${i + 1} was not inserted`);
    copyFileSync(join(REPO, "tests/fixtures/sample-resume.pdf"), join(jobDir(id), PDF_NAME));
    writeFileSync(join(jobDir(id), MAIN), `// stand-in tailored resume source for job ${id}\n`);
    updateJob(id, { status: s.status, score: s.score, rationale: `Seeded for verification: ${s.script} script.` });
    if (s.status === "submitted") updateJob(id, { submitted_at: new Date(Date.now() - 2 * 86400_000).toISOString(), note: "seeded as sent" });
    if (s.status === "held") updateJob(id, { note: "seeded as held" });
    if (s.status === "failed") updateJob(id, { note: "seeded failure: stand-in worker stopped" });
  });
  logEvent("system", `Verification seed: ${SEED.length} jobs`);
}
seed();

// ---- serve

const scheduler = new Scheduler({ runWorker, browser });
const handle = createHandler(scheduler);
const rev = Bun.spawnSync(["git", "-C", REPO, "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 0,
  fetch: req =>
    // Not part of the app: lets the doctor tell this instance from the live one.
    new URL(req.url).pathname === "/__verify"
      ? Response.json({ verify: true, pid: process.pid, rev, repo: REPO, state: resolve(STATE), refusedOutbound: refused })
      : handle(req),
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
scheduler.start();
writeFileSync(join(STATE, "server.pid"), String(process.pid)); // ctl.sh stops this pid and no other
console.log(`verify-auto-apply ready at http://127.0.0.1:${server.port} (state ${resolve(STATE)}, rev ${rev})`);
