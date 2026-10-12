// The pipeline: what runs when, and the host tools each kind of worker is given.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { autoApply, autoApproval, checkAutoApprovedPractice, confirmsSubmit, reconsiderAutoApproval } from "./auto";
import { addCompany, ATS, feedNames, fetchCompany, fetchDescription, fetchFeed, isAts, loadCompanies, type Posting } from "./ats";
import { boardMinutes, boardNames, fetchBoard, isBoardUrl, linkedinDescription, probeEmployer } from "./boards";
import { activateApplicationTab, ensureChrome, prepareJobBrowser, pruneTabs, screenshot, tabs, type JobBrowser } from "./chrome";
import { browserCount, browserSlot, config, DATA, jobDir, PROMPTS, readProfile, STOCK_MAIN } from "./config";
import { applicationsAwaitingOutcome, db, dedupeExisting, findTwin, getJob, insertJob, jobsByStatus, jobsInStatuses, jobsWithCheckpoint, kvDelete, kvEntries, kvGet, nextToPrep, kvSet, logEvent, notifyJobChange, relocateJob, requeueInterruptedPrep, updateJob, type Job } from "./db";
import * as gmail from "./gmail";
import { changedTemplateFiles, freezeResume, frozenResume, MAIN, pageCount, PDF_NAME, stageResume, stockPages, workingPdf } from "./resume";
import { checklistText, evaluate, loadRubric, type Verdict } from "./rubric";
import { arg, runWorker, S, schema, type HostTool, type WorkerHandle } from "./omp";
import { errorMessage } from "./errors";
import { authorizeSubmit, beginAttempt, clearFillFlags, dropManualLease, endVerification, isRecovering, isSubmitting, isVerifying, lastSlot, manualLeaseGate, rememberSlot } from "./fill-state";
import { assessPractice } from "./practice";
import { answerGate, cancelJobGates, consumeSubmitApproval, findStoredAnswer, getOpenGate, importLegacyGates, manualLeases, parkGate, queueRecovery, readCheckpoint, recordCheckpoint, releaseManualLease, reserveManualLease, resolveAmbiguityWithEvidence, resumeContext, returnManualControl, type AmbiguityEvidence, type FillCheckpoint, type GateInput } from "./questions";
import { resolveAccount } from "./accounts";
import { tickQuestionDigest } from "./digest";

const render = (name: string, vars: Record<string, string | number | null>) =>
  `Application phase: ${config.phase.toUpperCase()}\n\n` +
  readFileSync(join(PROMPTS, `${name}.md`), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));

const workDir = () => {
  const dir = join(DATA, "work");
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Profile files ship as templates; refuse to act on them until they are filled in.
const PLACEHOLDER = "TODO-FILL";
export function profileProblems(files = ["targets.md", "resume", "rubric.yml", "personal.yml", "answers.md"]) {
  return files.filter(f => {
    if (f === "resume") return !existsSync(STOCK_MAIN);
    if (f === "rubric.yml") {
      try {
        return loadRubric(), false;
      } catch (err) {
        logEvent("error", errorMessage(err));
        return true;
      }
    }
    const text = readProfile(f);
    return !text.trim() || text.includes(PLACEHOLDER);
  });
}
function requireProfile(files?: string[]) {
  const bad = profileProblems(files);
  if (bad.length) throw new Error(`Not ready: ${bad.join(", ")} (missing, empty, or still contains ${PLACEHOLDER})`);
}

// ---------------------------------------------------------------- scan

const running = new Set<string>();
export const isRunning = (name: string) => running.has(name);

async function exclusive(name: string, fn: () => Promise<void>) {
  if (running.has(name)) return;
  running.add(name);
  try {
    await fn();
  } catch (err) {
    logEvent("error", `${name}: ${errorMessage(err)}`);
  } finally {
    running.delete(name);
  }
}

// A board that is down would otherwise log the same error on every scan.
const feedErrors = new Map<string, number>();
function feedError(key: string, err: unknown) {
  if (Date.now() - (feedErrors.get(key) ?? 0) < 6 * 3600_000) return;
  feedErrors.set(key, Date.now());
  logEvent("error", `feed ${key}: ${errorMessage(err)}`);
}
const due = (key: string, minutes: number) => minutes > 0 && Date.now() - Date.parse(kvGet(key) ?? "1970-01-01") > minutes * 60_000;

// Reads every source. Cheap when nothing changed: known postings are ignored and duplicates folded,
// so agents only run for postings never seen before.
export const scan = (opts: { discover?: boolean } = {}) =>
  exclusive("scan", async () => {
    kvSet("last.scan", new Date().toISOString());
    requireProfile(["targets.md"]);
    if (opts.discover) {
      kvSet("last.discover", new Date().toISOString());
      await discover();
    }
    let added = 0;
    const from: string[] = [];
    const take = (label: string, postings: Awaited<ReturnType<typeof fetchCompany>>) => {
      let n = 0;
      for (const p of postings) if (p.url && p.title && p.company && insertJob(p)) n++;
      if (n) from.push(`${label} ${n}`);
      added += n;
    };
    for (const company of loadCompanies()) {
      try {
        take(company.name, await fetchCompany(company));
      } catch (err) {
        feedError(`${company.ats}/${company.slug}`, err);
      }
    }
    for (const name of feedNames()) {
      if (!due(`last.feed.${name}`, config.feeds?.[name]?.minutes ?? 0)) continue;
      kvSet(`last.feed.${name}`, new Date().toISOString());
      try {
        take(name, await fetchFeed(name));
      } catch (err) {
        feedError(name, err);
      }
    }
    for (const name of boardNames()) {
      if (!due(`last.board.${name}`, boardMinutes(name))) continue;
      kvSet(`last.board.${name}`, new Date().toISOString());
      try {
        take(name, await fetchBoard(name));
      } catch (err) {
        feedError(name, err);
      }
    }
    if (added) logEvent("system", `Scan: ${added} new postings (${from.slice(0, 6).join(", ")}${from.length > 6 ? ", …" : ""})`);
    await triage();
    pump();
  });

async function triage() {
  for (;;) {
    const batch = jobsByStatus("found", 50);
    if (!batch.length) return;
    const ids = new Set(batch.map(j => j.id));
    let kept = null as number[] | null; // set from the tool callback
    let held: number[] = [];
    const { done } = runWorker({
      name: "triage",
      builtins: ["read", "write"],
      model: config.models.triage,
      cwd: workDir(),
      maxTime: "10m",
      prompt: render("triage", {
        targets: readProfile("targets.md"),
        postings: batch.map(j => `${j.id} | ${j.company} | ${j.title} | ${j.location ?? "?"}`).join("\n"),
      }),
      tools: {
        triage_result: {
          description: "Report which posting ids to keep for a full assessment and which to hold back.",
          parameters: schema(
            {
              keep: { type: "array", items: { type: "integer" }, description: "ids worth a full read now" },
              hold: { type: "array", items: { type: "integer" }, description: "ids the targets say to hold back for later; empty if none" },
            },
            ["keep"],
          ),
          handler: args => {
            const keep = arg.ints(args, "keep").filter(id => ids.has(id));
            kept = keep;
            held = arg.ints(args, "hold").filter(id => ids.has(id) && !keep.includes(id));
            return `Recorded ${keep.length} kept, ${held.length} held, ${ids.size - keep.length - held.length} dropped.`;
          },
        },
      },
    });
    await done;
    if (!kept) throw new Error("triage worker finished without reporting; will retry on the next scan");
    const keep = new Set<number>(kept);
    const hold = new Set<number>(held);
    for (const j of batch) {
      if (keep.has(j.id) && isBoardUrl(j.url)) updateJob(j.id, { status: "locating", note: null });
      else if (keep.has(j.id)) {
        // Boards that list titles only: get the body now that the posting is worth reading.
        const description = j.description ? undefined : await fetchDescription(j.url);
        updateJob(j.id, { status: "triaged", note: null, ...(description ? { description } : {}) });
      }
      else if (hold.has(j.id)) updateJob(j.id, { status: "held", note: `held back during the ${config.phase} phase` });
      else updateJob(j.id, { status: "skipped", note: "dropped at triage" });
    }
    logEvent("system", `Triage: kept ${keep.size}, held ${hold.size} of ${batch.length}`);
  }
}

// `also` may add to the reply, given the board's postings.
const addCompanyTool = (also?: (postings: Posting[]) => string): HostTool => ({
  description: "Add a company job board to the watch list. Verifies the board exists.",
  parameters: schema({ name: S.str("Company name"), ats: { type: "string", enum: [...ATS] }, slug: S.str("Board slug; for workday '<tenant>.<wdN>/<site>'") }),
  handler: async args => {
    const name = arg.str(args, "name"), ats = arg.str(args, "ats"), slug = arg.str(args, "slug").trim();
    if (!isAts(ats)) return `ERROR: ats must be one of ${ATS.join(", ")}`;
    const company = { name, ats, slug };
    const postings = await fetchCompany(company).catch((err: unknown) => {
      throw new Error(`board ${ats}/${slug} not reachable (${errorMessage(err)}); check the slug`);
    });
    return (addCompany(company) ? `Added ${name}: ${postings.length} open postings will be scanned.` : "Already on the watch list.") + (also?.(postings) ?? "");
  },
});

async function discover() {
  const { done } = runWorker({
    name: "discover",
    builtins: ["read", "write", "web_search"],
    model: config.models.discover,
    cwd: workDir(),
    maxTime: "25m",
    prompt: render("discover", {
      targets: readProfile("targets.md"),
      companies: loadCompanies().map(c => `${c.name} (${c.ats}/${c.slug})`).join(", ") || "(none yet)",
      companyGoal: 15,
      jobGoal: 10,
    }),
    tools: {
      add_company: addCompanyTool(),
      save_job: {
        description: "Save one open posting that is not on a watched board.",
        parameters: schema({
          url: S.str("Direct URL of the posting / application page"),
          company: S.str("Company name"),
          title: S.str("Job title"),
          location: S.str("Location or 'Remote'"),
          description: S.str("Full job description text"),
        }),
        handler: args => {
          const posting = { url: arg.str(args, "url"), company: arg.str(args, "company"), title: arg.str(args, "title"), location: arg.str(args, "location"), description: arg.str(args, "description") };
          if (/linkedin\.com|indeed\.com/i.test(posting.url)) return "ERROR: aggregator links are not accepted; find the original posting.";
          return insertJob({ ...posting, source: "discover" }, "triaged") ? "Saved." : "Already known.";
        },
      },
      discover_done: {
        description: "Finish the discovery task.",
        parameters: schema({ summary: S.str("One-line summary") }),
        handler: args => {
          logEvent("system", `Discover: ${arg.str(args, "summary")}`);
          return "Done.";
        },
      },
    },
  });
  await done;
}

// ---------------------------------------------------------------- locate (job-search site -> employer's posting)

const LOCATE_BATCH = 8;
const NOT_EMPLOYER = /(linkedin|indeed|dice|ziprecruiter|glassdoor|simplyhired|monster|lensa|builtin|jooble|talent|careerbuilder|jobgether|google)\.com\//i;

// Jobs that passed triage on a LinkedIn or Indeed listing: find the employer's own posting, first on
// the public boards (free), then with a web-search agent. What cannot be found is skipped.
export const locate = () =>
  exclusive("locate", async () => {
    for (const job of jobsByStatus("locating")) {
      if (!isBoardUrl(job.url)) {
        updateJob(job.id, { status: "triaged" });
        continue;
      }
      const hit = await probeEmployer(job);
      if (!hit) continue;
      addCompany(hit.company);
      relocateJob(job, hit.posting.url, hit.posting.description ?? (await fetchDescription(hit.posting.url)));
      logEvent("system", `Found on the employer's board: ${hit.company.ats}/${hit.company.slug}`, job.id, "locate");
    }
    const cap = config.limits.locatePerDay ?? 40;
    for (;;) {
      const room = Math.min(LOCATE_BATCH, cap - usedToday("locate"));
      const batch = room > 0 ? jobsByStatus("locating", room) : [];
      if (!batch.length) break;
      const open = new Map(batch.map(j => [j.id, j]));
      for (const j of batch) {
        countOne("locate");
        kvSet(`locate.tries.${j.id}`, String(Number(kvGet(`locate.tries.${j.id}`) ?? 0) + 1));
      }
      const { done } = runWorker({
        name: "locate",
        builtins: ["read", "write", "web_search"],
        model: config.models.locate,
        cwd: workDir(),
        maxTime: "25m",
        prompt: render("locate", { jobs: batch.map(j => `${j.id} | ${j.company} | ${j.title} | ${j.location ?? "?"} | ${j.source}`).join("\n") }),
        tools: {
          found_posting: {
            description: "Record the employer's own posting for one job.",
            parameters: schema({ job_id: S.int("Job id from the list"), url: S.str("Direct URL of the posting on the employer's site"), description: S.str("Full job description text from that page") }),
            handler: async args => {
              const job_id = arg.int(args, "job_id"), url = arg.str(args, "url");
              const job = open.get(job_id);
              if (!job) return "ERROR: unknown job id, or already reported.";
              if (!/^https?:\/\//i.test(url) || NOT_EMPLOYER.test(url)) return "ERROR: that is a job site, not the employer's own posting. Find the employer's page or call no_posting.";
              const status = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) }).then(r => r.status, () => 0);
              if (status === 404 || status === 410) return `ERROR: that URL answers ${status}. Check it, or call no_posting.`;
              open.delete(job_id);
              const text = (arg.optStr(args, "description") ?? "").trim();
              const merged = relocateJob(job, url, text.length >= 300 ? text : ((await fetchDescription(url)) ?? job.description ?? (await linkedinDescription(job.url)) ?? text)) === "merged";
              logEvent("system", `Found the employer's posting: ${url}`, merged ? null : job_id, "locate");
              return merged ? "Recorded (that posting was already known)." : "Recorded.";
            },
          },
          // The board's feed may list the job even when its pages cannot be read from a search.
          add_company: addCompanyTool(postings => {
            const same = [...open.values()].flatMap(j => postings.filter(p => findTwin({ company: j.company, title: p.title, description: null }, [j])).map(p => `job ${j.id}: ${p.title} | ${p.location ?? "?"} | ${p.url}`));
            return same.length ? `\nOn this board, with a title matching a job in your list:\n${same.slice(0, 12).join("\n")}` : "\nNo posting on this board has a title matching a job in your list.";
          }),
          no_posting: {
            description: "Report that a job has no findable posting on the employer's own site.",
            parameters: schema({ job_id: S.int("Job id from the list"), reason: S.str("Short reason") }),
            handler: args => {
              const job_id = arg.int(args, "job_id");
              if (!open.delete(job_id)) return "ERROR: unknown job id, or already reported.";
              updateJob(job_id, { status: "skipped", note: `no posting on the employer's own site: ${arg.str(args, "reason")}` });
              return "Recorded.";
            },
          },
          locate_done: {
            description: "Finish the task.",
            parameters: schema({ summary: S.str("One-line summary") }),
            handler: args => (logEvent("system", `Locate: ${arg.str(args, "summary")}`), "Done."),
          },
        },
      });
      const res = await done;
      // Unreported jobs get one more attempt, then give way.
      for (const j of open.values())
        if (Number(kvGet(`locate.tries.${j.id}`)) >= 2) updateJob(j.id, { status: "skipped", note: "could not find a posting on the employer's own site" });
      if (res.status !== "completed") break;
    }
    pump();
  });

// ---------------------------------------------------------------- prep (score + tailor)

async function prep(job: Job) {
  const dir = jobDir(job.id);
  stageResume(dir);
  const maxPages = stockPages();
  updateJob(job.id, { status: "prepping", note: null });
  const feedback = kvGet(`feedback.${job.id}`); // set when the user asked for this job explicitly
  // Both are set from tool callbacks.
  let verdict = null as Verdict | null;
  let reported = false as boolean;
  const { done } = runWorker({
    name: "prep",
    builtins: ["read", "write", "edit", "bash"],
    jobId: job.id,
    model: config.models.prep,
    cwd: dir,
    maxTime: "20m",
    prompt: render("prep", {
      ...job,
      location: job.location ?? "location not stated",
      checklist: checklistText(),
      notes: readProfile("resume-notes.md"),
      main: MAIN,
      pdfName: PDF_NAME,
      description: job.description || "(not captured; read it from the URL)",
      feedback: feedback ? `\n## Note from the candidate\n\n${feedback}\n` : "",
    }),
    tools: {
      submit_checklist: {
        description: "Submit your answer to every checklist statement. The orchestrator computes the score and tells you whether to continue.",
        parameters: schema(
          {
            answers: {
              type: "array",
              items: schema({
                id: S.str("Checklist id exactly as given, e.g. practice.python"),
                answer: { type: "string", enum: ["yes", "no", "unclear"] },
                evidence: S.str("Short quote or fact from the posting or resume that decides it; empty if unclear"),
              }),
            },
            practice: {
              type: "object",
              description: "Evidence for practice phase eligibility: annual base ceiling in USD, salary evidence quote, mandatory nonlocal onsite/hybrid requirement, location evidence quote.",
              properties: {
                annualBaseMaxUsd: { type: ["number", "null"], description: "Posted annual base salary ceiling in USD, or null" },
                salaryEvidence: S.str("Quote of salary evidence from job description, or empty string"),
                mandatoryNonlocalOnsite: { type: "string", enum: ["yes", "no", "unclear"], description: "Whether mandatory nonlocal onsite/hybrid with no remote/local alternative" },
                locationEvidence: S.str("Quote of location evidence from job description"),
              },
              required: ["annualBaseMaxUsd", "salaryEvidence", "mandatoryNonlocalOnsite", "locationEvidence"],
              additionalProperties: false,
            },
          },
          config.phase === "practice" ? ["answers", "practice"] : ["answers"],
        ),
        handler: args => {
          const answers = args["answers"], practice = args["practice"];
          if (config.phase === "practice") {
            if (!practice || typeof practice !== "object" || Array.isArray(practice)) {
              return "ERROR: 'practice' evidence object is required in the practice phase with annualBaseMaxUsd, salaryEvidence, mandatoryNonlocalOnsite, and locationEvidence. Call submit_checklist again with practice evidence.";
            }
            const assessed = assessPractice(practice);
            if (!assessed) {
              return "ERROR: malformed practice evidence. Ensure: annualBaseMaxUsd is a positive number or null; salaryEvidence is a non-empty quote when salary is given; mandatoryNonlocalOnsite is 'yes', 'no', or 'unclear'; and locationEvidence is a non-empty quote when mandatoryNonlocalOnsite is 'yes'. Do not include a version field. Call submit_checklist again.";
            }
          }
          const result = evaluate(answers, practice);
          if (typeof result === "string") return `ERROR: ${result}. Call submit_checklist again with every statement answered.`;
          verdict = result;
          const fields = {
            score: result.score,
            checklist: JSON.stringify(result.items),
            practice_assessment: result.practice ? JSON.stringify(result.practice) : null,
          };
          // A job the user asked for by hand is tailored whatever the checklist says.
          if (result.decision === "apply" || feedback) {
            updateJob(job.id, fields);
            return `Checklist recorded (${result.reason}). CONTINUE: tailor the resume, then call finish_prep.`;
          }
          reported = true;
          updateJob(job.id, { ...fields, status: result.decision === "hold" ? "held" : "skipped", note: result.reason });
          return `Checklist recorded: ${result.reason}. STOP: do not tailor a resume; you are done.`;
        },
      },
      finish_prep: {
        description: "Report the tailored resume for this job. Only after submit_checklist told you to continue.",
        parameters: schema({
          rationale: S.str("At most two short sentences: what the role is and the strongest reason the candidate fits"),
          concerns: S.str("At most two short lines about real gaps or risks of this job; empty string if none"),
          resume_changes: S.str("Up to five short bullets: what changed in the resume and why"),
        }),
        handler: args => {
          const rationale = arg.str(args, "rationale"), concerns = arg.str(args, "concerns"), resume_changes = arg.str(args, "resume_changes");
          if (!verdict) return "ERROR: call submit_checklist first.";
          if (reported) return "ERROR: this job was already closed by the checklist; nothing more to do.";
          const pdf = workingPdf(job.id);
          if (!existsSync(pdf)) return `ERROR: ${PDF_NAME} is missing in the working directory. Run \`typst compile ${MAIN} ${PDF_NAME}\`, then call finish_prep again.`;
          const touched = changedTemplateFiles(dir);
          if (touched.length) return `ERROR: template file(s) ${touched.join(", ")} were modified. Restore them exactly, edit only ${MAIN}, recompile, then call finish_prep again.`;
          const pages = pageCount(pdf);
          if (maxPages && pages && pages > maxPages) return `ERROR: the tailored resume is ${pages} pages; the stock resume is ${maxPages}. Trim it, recompile, then call finish_prep again.`;
          reported = true;
          const auto = autoApproval(verdict, { concerns, handPicked: !!feedback, approvedToday: usedToday("auto") });
          if (auto.deferred === "daily_cap") {
            deferApproval(job.id);
          } else {
            forgetDeferredApproval(job.id);
          }
          updateJob(job.id, {
            rationale,
            concerns: concerns || null,
            resume_changes: resume_changes || null,
            status: auto.approve ? "approved" : "awaiting_approval",
            approved_by: auto.approve ? "auto" : null,
            note: auto.note,
            practice_assessment: verdict.practice ? JSON.stringify(verdict.practice) : null,
          });
          if (auto.approve) {
            countOne("auto");
            logEvent("auto", `Approved by auto apply: ${verdict.reason}`, job.id, "prep");
          }
          return "Recorded.";
        },
      },
    },
  });
  const res = await done;
  if (!reported) updateJob(job.id, { status: "failed", note: `prep did not finish: ${res.error ?? "no report"}` });
}

// ---------------------------------------------------------------- fill (browser)

interface FillSession {
  jobId: number;
  slot: number;
  active: boolean;
  handle?: WorkerHandle;
  browser?: JobBrowser;
  checkpoint: FillCheckpoint;
}
const fillSessions = new Map<number, FillSession>();
// Activation is asynchronous; keep ownership even if the gate is resolved meanwhile.
const manualActivations = new Map<number, number>();

// Callbacks are invalidated first, then the process is told to stop.
function endSession(session: FillSession) {
  session.active = false;
  session.browser?.revoke();
  session.handle?.abort();
}

// Object identity is the generation guard. Aborted callbacks cannot touch a successor.
function ownsFill(session: FillSession) {
  return session.active && fillSessions.get(session.jobId) === session && getJob(session.jobId)?.status === "filling";
}

function defaultCheckpoint(job: Job, slot: number): FillCheckpoint {
  return { version: 1, slot, tabId: null, url: null, step: "recover exact application", notes: "", resumeSha: job.resume_sha, savedAt: new Date().toISOString() };
}

const navigationFields = {
  tab_id: S.str("Exact CDP tab id from the current browser; not a tab nickname"),
  url: S.str("Current application URL, without credentials, tokens, or personal data"),
  step: S.str("Current form step and exact requisition identity"),
  notes: S.str("Draft recovery/navigation evidence only; no credentials or answer values"),
};

async function checkpointFrom(session: FillSession, args: Record<string, unknown>): Promise<FillCheckpoint> {
  for (const key of Object.keys(navigationFields)) {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`checkpoint ${key} is required`);
  }
  if (!ownsFill(session)) throw new Error("stale fill worker");
  if (!session.browser?.ownsTarget(String(args["tab_id"]))) throw new Error("checkpoint tab is outside this application's browser scope");
  const tab = (await tabs(session.slot)).find(t => t.id === String(args["tab_id"]));
  if (!tab) throw new Error("current application tab id not found; re-observe before parking");
  const url = new URL(String(args["url"]));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("checkpoint URL must omit credentials, query strings and fragments");
  const observed = new URL(tab.url);
  if (url.origin !== observed.origin || url.pathname !== observed.pathname)
    throw new Error("checkpoint URL does not match the current application tab");
  if (!ownsFill(session)) throw new Error("stale fill worker");
  const checkpoint: FillCheckpoint = {
    version: 1, slot: session.slot, tabId: tab.id, url: url.href,
    step: String(args["step"]), notes: String(args["notes"]), resumeSha: session.checkpoint.resumeSha, savedAt: new Date().toISOString(),
  };
  session.checkpoint = checkpoint;
  recordCheckpoint(session.jobId, checkpoint);
  return checkpoint;
}

// Persist first, invalidate callbacks second, stop the actual process third.
// The scheduler retains the slot until handle.done (which waits for process exit).
async function parkFill(session: FillSession, input: GateInput, checkpoint = session.checkpoint): Promise<string> {
  if (!ownsFill(session)) throw new Error("stale fill worker");
  const shot = checkpoint.tabId ? await screenshot(session.slot, checkpoint.tabId).catch(() => null) : null;
  if (!ownsFill(session)) throw new Error("stale fill worker");
  if (shot) await Bun.write(join(jobDir(session.jobId), "gate.png"), shot);
  if (!ownsFill(session)) throw new Error("stale fill worker");
  if (isSubmitting(session.jobId)) {
    const reason = input.text.trim();
    input = {
      kind: "submission_ambiguous",
      text: reason
        ? `Final submission was authorized (${reason}). Inspect the exact application before resolving it; do not retry.`
        : "Final submission was authorized. Inspect the exact application before resolving it; do not retry.",
      context: input.context || input.text,
    };
  }
  parkGate(session.jobId, { ...input, shot: shot ? Date.now() : null }, checkpoint);
  endSession(session);
  logEvent("gate", `${input.kind}: ${input.text}`, session.jobId, "fill");
  await session.handle?.done;
  return "PARKED. This worker has exited.";
}

export function respond(jobId: number, answer: string): boolean {
  const gate = getOpenGate(jobId);
  if (!gate || gate.kind === "submission_ambiguous" || isSubmitting(jobId)) return false;
  if (gate.kind === "manual") return returnManualControl(jobId, gate.id, answer);
  try {
    answerGate(gate.id, answer, "application");
    return true;
  } catch {
    return false;
  }
}

export function abortFill(jobId: number) {
  const session = fillSessions.get(jobId);
  if (session) {
    endSession(session);
  }
  cancelJobGates(jobId);
}
export function activeFillSession(jobId: number): boolean {
  return fillSessions.has(jobId);
}

export function manualBrowserReserved(jobId: number): boolean {
  for (const [slot, owner] of manualLeases())
    if (owner === jobId && !manualActivations.has(slot)) return true;
  return false;
}

export async function reserveBrowser(jobId: number, gateId: string): Promise<void> {
  const job = getJob(jobId);
  const checkpoint = readCheckpoint(jobId);
  if (!job || !checkpoint?.tabId || checkpoint.slot >= filling.length)
    throw new Error("No usable saved browser; request application recovery instead");
  const { slot, tabId } = checkpoint;
  if (filling[slot] || manualActivations.has(slot))
    throw new Error("This browser is busy; wait for its current worker to stop");
  const employer = job.company_key ?? job.company;
  const owners = [...fillSessions.keys(), ...manualLeases().values(), ...manualActivations.values()];
  for (const owner of owners) {
    if (owner === jobId) continue;
    const other = getJob(owner);
    if (other && (other.company_key ?? other.company) === employer)
      throw new Error("Another application is currently using this employer account");
  }
  manualActivations.set(slot, jobId);
  let activated = false;
  try {
    reserveManualLease(jobId, gateId);
    await activateApplicationTab(slot, tabId);
    if (getOpenGate(jobId)?.id !== gateId || manualLeaseGate(jobId) !== gateId ||
        readCheckpoint(jobId)?.tabId !== tabId)
      throw new Error("This handoff changed while opening its browser");
    activated = true;
  } finally {
    if (!activated) dropManualLease(jobId, gateId);
    manualActivations.delete(slot);
    notifyJobChange(jobId);
    pump();
  }
}

export function releaseBrowser(jobId: number, gateId: string): void {
  if ([...manualActivations.values()].includes(jobId)) throw new Error("Browser inspection is still opening");
  releaseManualLease(jobId, gateId);
  pump();
}

export function scheduleRecovery(jobId: number, gateId: string): void {
  if (activeFillSession(jobId)) throw new Error("An active worker is already running for this application");
  queueRecovery(jobId, gateId);
  pump();
}

export async function confirmSubmission(jobId: number, summary: string): Promise<string> {
  const session = fillSessions.get(jobId);
  const job = getJob(jobId);
  if (!session || !job || !ownsFill(session)) return "ERROR: no current fill worker.";
  if (isSubmitting(jobId))
    return parkFill(session, { kind: "submission_ambiguous", text: "Submission already authorized; inspect before any further submit attempt." });
  try {
    if (!job.resume_sha || frozenResume(jobId, job.resume_sha).sha !== session.checkpoint.resumeSha)
      throw new Error("frozen resume identity changed");
  } catch (err) {
    return parkFill(session, { kind: "manual", text: `Frozen resume verification failed; do not submit. ${err instanceof Error ? err.message : String(err)}` });
  }
  if (!confirmsSubmit(job) || consumeSubmitApproval(jobId, summary)) {
    authorizeSubmit(jobId);
    logEvent("auto", `Final submission authorized after re-observation: ${summary}`, jobId, "fill");
    return "APPROVED. Click the final submit button once now. Do not retry it if the result is uncertain.";
  }
  return parkFill(session, { kind: "confirm_submit", text: summary });
}


const gmailTools = (): Record<string, HostTool> => ({
  gmail_search: {
    description: "Search the application mailbox with Gmail query syntax (e.g. 'from:greenhouse newer_than:1h'). Returns message summaries.",
    parameters: schema({ query: S.str("Gmail search query"), max: S.int("Max results (default 10, limit 25)") }, ["query"]),
    handler: async args => JSON.stringify(await gmail.search(arg.str(args, "query"), arg.optInt(args, "max") ?? 10), null, 1),
  },
  gmail_read: {
    description: "Read one message in full (headers and body text, with link targets).",
    parameters: schema({ id: S.str("Message id from gmail_search") }),
    handler: async args => JSON.stringify(await gmail.read(arg.str(args, "id")), null, 1),
  },
  gmail_mark_read: {
    description: "Mark a message as read.",
    parameters: schema({ id: S.str("Message id") }),
    handler: async args => (await gmail.markRead(arg.str(args, "id")), "Marked read."),
  },
});

// A live link is valid only while this job owns the browser, not merely because it used it once.
export function fillSlot(jobId: number): number | null {
  const session = fillSessions.get(jobId);
  if (session && ownsFill(session)) return session.slot;
  for (const [slot, owner] of manualLeases())
    if (owner === jobId && !manualActivations.has(slot)) return slot;
  return null;
}

function stopFailedFill(session: FillSession, message: string) {
  if (!ownsFill(session)) return;
  const ambiguous = isSubmitting(session.jobId);
  parkGate(session.jobId, {
    kind: ambiguous ? "submission_ambiguous" : "manual",
    text: ambiguous
      ? `Final submission may have happened. Inspect this application and mailbox; never retry without confirmed-not-submitted resolution. ${message}`
      : `Fill stopped. Inspect/recover the exact draft before returning browser control. ${message}`,
  }, session.checkpoint);
  endSession(session);
}

async function fill(job: Job, session: FillSession) {
  const { slot } = session;
  const isVerification = isVerifying(job.id);
  if (isSubmitting(job.id) && !isVerification) {
    updateJob(job.id, { status: "filling" });
    stopFailedFill(session, "Runnable job still had a final-submit marker.");
    return;
  }
  if (!isVerification) {
    const guard = checkAutoApprovedPractice(job);
    if (!guard.ok) {
      session.active = false;
      const note = `needs your review: ${guard.reason ?? "invalid practice assessment"}`;
      updateJob(job.id, { status: "held", note, pending: null });
      logEvent("auto", `Early fill guard: held auto-approved job #${job.id} (${guard.reason})`, job.id, "fill");
      return;
    }
  }
  updateJob(job.id, { status: "filling", pending: null });
  const dir = jobDir(job.id);
  const browser = browserSlot(slot);
  const context = resumeContext(job.id);
  rememberSlot(job.id, slot);
  const frozen = job.resume_sha ? frozenResume(job.id, job.resume_sha) : freezeResume(job.id);
  if (context.checkpoint?.resumeSha && context.checkpoint.resumeSha !== frozen.sha)
    throw new Error("checkpoint resume SHA does not match the frozen application resume");
  session.checkpoint = { ...session.checkpoint, slot, resumeSha: frozen.sha };
  updateJob(job.id, { resume_sha: frozen.sha, resume_frozen_at: job.resume_frozen_at ?? new Date().toISOString() });
  recordCheckpoint(job.id, session.checkpoint);
  const mailbox = gmail.gmailStatus().address ?? "";
  for (const answer of context.answers) {
    if (answer.kind === "cover_letter") writeFileSync(join(dir, "cover_letter.txt"), answer.answer + "\n");
  }
  await ensureChrome(slot);
  if (!ownsFill(session)) return;
  const protectedTabs = new Set<string>();
  const excludedTargets = new Set<string>();
  for (const row of jobsWithCheckpoint()) {
    const checkpoint = readCheckpoint(row.id);
    if (checkpoint?.slot === slot && checkpoint.tabId) {
      protectedTabs.add(checkpoint.tabId);
      if (row.id !== job.id) excludedTargets.add(checkpoint.tabId);
    }
  }
  await pruneTabs(slot, 5, protectedTabs);
  if (!ownsFill(session)) return;
  const jobBrowser = await prepareJobBrowser(slot, session.checkpoint.tabId, excludedTargets);
  session.browser = jobBrowser;
  if (!ownsFill(session)) return;
  session.checkpoint = {
    ...session.checkpoint, tabId: session.browser.tabId,
    url: session.browser.reused ? session.checkpoint.url : null, savedAt: new Date().toISOString(),
  };
  recordCheckpoint(job.id, session.checkpoint);

  const tools: Record<string, HostTool> = {
    ...gmailTools(),
    application_tabs: {
      description: "Get actual CDP tab IDs and sanitized navigation URLs owned by this application. Other parked/manual drafts are inaccessible.",
      parameters: schema({}),
      handler: async () => JSON.stringify((await tabs(slot)).filter(tab => jobBrowser.ownsTarget(tab.id)).flatMap(tab => {
        const url = new URL(tab.url);
        return ["http:", "https:"].includes(url.protocol)
          ? [{ tab_id: tab.id, title: tab.title, url: `${url.origin}${url.pathname}` }]
          : [];
      })),
    },
    checkpoint: {
      description: "Record navigation/draft identity after each page. This is NOT proof the ATS saved fields.",
      parameters: schema(navigationFields),
      handler: async args => (await checkpointFrom(session, args), "Navigation checkpoint recorded; verify ATS persistence separately."),
    },
    get_account: {
      description: "Get the existing login, or create stored credentials on first use. A resumed application must use the same account.",
      parameters: schema({
        domain: S.str("Site domain, e.g. acme.wd5.myworkdayjobs.com"),
        register: { type: "boolean", description: "Set true only if the site explicitly confirmed no existing account and registration is required" },
      }, ["domain"]),
      handler: args => {
        const allowCreate = args["register"] === true && !isVerification && !isSubmitting(job.id);
        return resolveAccount(arg.str(args, "domain"), mailbox, allowCreate);
      },
    },
    ask_user: {
      description: "Consult profile first; then get an exact scoped answer or durably park and terminate this worker.",
      parameters: schema({
        question: S.str("The form question verbatim, not including options"),
        context: S.str("Verbatim answer-relevant surrounding form/legal text and constraints. Put job IDs, navigation and fill progress in checkpoint fields, not here, unless materially required by this question. Never omit answer-relevant wording."),
        options: { type: "array", items: { type: "string" }, description: "All current choices verbatim and in order, or [] for free text" },
        ...navigationFields,
      }),
      handler: async args => {
        const options: unknown = args["options"];
        if (!Array.isArray(options) || !options.every((option): option is string => typeof option === "string"))
          return "ERROR: options must contain every current choice verbatim.";
        const input: GateInput = { kind: "question", text: arg.str(args, "question"), context: arg.str(args, "context"), options };
        const answer = findStoredAnswer(job.id, input);
        if (answer !== null) return `Exact scoped candidate answer: ${answer}`;
        return parkFill(session, input, await checkpointFrom(session, args));
      },
    },
    ask_cover_letter: {
      description: "Return this application's provided letter or durably park for it. Never write a letter.",
      parameters: schema({ prompt: S.str("Exact required cover-letter prompt, limits and upload/text requirements"), ...navigationFields }),
      handler: async args => {
        const input: GateInput = { kind: "cover_letter", text: arg.str(args, "prompt"), context: "Required cover letter for this application; exact constraints in prompt", options: [] };
        const letter = findStoredAnswer(job.id, input);
        if (letter === null) return parkFill(session, input, await checkpointFrom(session, args));
        writeFileSync(join(dir, "cover_letter.txt"), letter + "\n");
        return `Use exactly this letter; for file upload use ${join(dir, "cover_letter.txt")}:\n\n${letter}`;
      },
    },
    confirm_submit: {
      description: "After re-observing all entered fields, authorize the one final click or durably park for review.",
      parameters: schema({ summary: S.str("Exact final entered values, every non-trivial answer and free text verbatim"), ...navigationFields }),
      handler: async args => {
        if (isVerification) return "ERROR: verification workers are strictly forbidden from submitting or authorizing applications.";
        await checkpointFrom(session, args);
        return confirmSubmission(job.id, arg.str(args, "summary"));
      },
    },
    need_manual: {
      description: "Persist the blocker and draft checkpoint, then terminate the worker. The slot is reusable after exit; a human must explicitly reserve the browser before inspecting it.",
      parameters: schema({ reason: S.str("Blocking evidence and what the candidate needs to do"), ...navigationFields }),
      handler: async args => {
        let checkpoint = session.checkpoint;
        let reason = arg.str(args, "reason");
        try {
          checkpoint = await checkpointFrom(session, args);
        } catch (err) {
          if (!ownsFill(session)) throw err;
          reason += `\nCurrent navigation could not be verified; checkpoint is the last observed draft: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (isVerification) {
          endVerification(job.id);
          return parkFill(session, { kind: "submission_ambiguous", text: `Verification handoff: ${reason}` }, checkpoint);
        }
        return parkFill(session, { kind: "manual", text: reason }, checkpoint);
      },
    },
    report_result: {
      description: "Report verified success/closed status, or failure. Failure after final authorization requires inspection, not retry.",
      parameters: schema({ outcome: { type: "string", enum: ["submitted", "already_applied", "closed", "failed"] }, note: S.str("Observed evidence") }),
      handler: args => {
        const outcome = arg.oneOf(args, "outcome", ["submitted", "already_applied", "closed", "failed"]), note = arg.str(args, "note");
        if (isVerification) {
          return "ERROR: verification workers must record status through verify_status with structured evidence, or hand off through need_manual.";
        }
        if (outcome !== "submitted" && outcome !== "already_applied" && isSubmitting(job.id)) {
          stopFailedFill(session, note);
          return "Submission ambiguity recorded; automatic retry forbidden.";
        }
        db.transaction(() => {
          cancelJobGates(job.id);
          clearFillFlags(job.id);
          if (outcome === "submitted" || outcome === "already_applied")
            updateJob(job.id, { status: "submitted", pending: null, note, submitted_at: new Date().toISOString() });
          else if (outcome === "closed") updateJob(job.id, { status: "skipped", pending: null, note: `posting closed: ${note}` });
          else updateJob(job.id, { status: "failed", pending: null, note });
        })();
        endSession(session);
        return "Recorded.";
      },
    },
    verify_status: {
      description: "Record verified submission outcome for an ambiguous application. Available only in verification mode.",
      parameters: schema({
        outcome: {
          type: "string",
          enum: ["submitted", "not_submitted", "unresolved"],
          description: "Verified status of the exact application",
        },
        evidence: S.str("Verbatim observed text/evidence from portal, form validation, or confirmation message"),
        source: {
          type: "string",
          enum: ["portal", "confirmation_email", "submission_error"],
          description: "Evidence category",
        },
        status: {
          type: "string",
          enum: ["submitted", "not_submitted", "draft", "incomplete", "rejected"],
          description: "Observed status category",
        },
        requisition_id: { type: "string", description: "Exact job or requisition ID verified on page or email" },
        message_id: { type: "string", description: "Gmail message id if source is confirmation_email" },
        ...navigationFields,
      }, ["outcome", "evidence"]),
      handler: async args => {
        if (!isVerification) return "ERROR: verify_status is only available during verification mode.";
        const outcome = arg.str(args, "outcome");
        const evidence = (arg.optStr(args, "evidence") ?? "").trim();
        if (evidence.length < 5) return "ERROR: detailed evidence text is required (minimum 5 characters).";

        if (outcome === "unresolved") {
          const cp = await checkpointFrom(session, args).catch(() => session.checkpoint);
          endVerification(job.id);
          return await parkFill(session, {
            kind: "submission_ambiguous",
            text: `Verification inconclusive: ${evidence}`,
            context: evidence,
          }, cp);
        }

        const source = (arg.optStr(args, "source") ?? "") as AmbiguityEvidence["source"];
        const status = (arg.optStr(args, "status") ?? "") as AmbiguityEvidence["status"];
        const reqId = (arg.optStr(args, "requisition_id") ?? "").trim();
        const messageId = (arg.optStr(args, "message_id") ?? "").trim();
        if (!reqId) return "ERROR: exact non-empty requisition_id is required for verified resolution.";
        const cp = await checkpointFrom(session, args);

        if (outcome === "submitted") {
          if (source !== "portal" && source !== "confirmation_email") {
            return "ERROR: submitted outcome requires source 'portal' or 'confirmation_email'.";
          }
          if (source === "confirmation_email" && !messageId) {
            return "ERROR: confirmation_email requires message_id from gmail.";
          }
          if (source === "portal" && status !== "submitted") {
            return "ERROR: portal submitted evidence requires status 'submitted'.";
          }
          resolveAmbiguityWithEvidence(job.id, "submitted", {
            notes: `Verified submitted: ${evidence}`,
            requisitionId: reqId,
            source,
            status,
            ...(messageId ? { messageId } : {}),
            checkpoint: cp,
          });
          endSession(session);
          await session.handle?.done;
          return "Recorded: Application verified as submitted. Worker exiting.";
        }

        if (outcome === "not_submitted") {
          const valid =
            (source === "portal" && ["not_submitted", "draft", "incomplete"].includes(status)) ||
            (source === "submission_error" && status === "rejected");
          if (!valid) {
            return "ERROR: not_submitted requires source 'portal' with status 'not_submitted'|'draft'|'incomplete', or source 'submission_error' with status 'rejected'.";
          }
          resolveAmbiguityWithEvidence(job.id, "not_submitted", {
            notes: `Verified unsubmitted draft: ${evidence}`,
            requisitionId: reqId,
            source,
            status,
            checkpoint: cp,
          });
          endSession(session);
          await session.handle?.done;
          return "Recorded: Ambiguity resolved. Verified draft queued for normal fill with fresh confirm_submit required.";
        }

        return "ERROR: invalid outcome.";
      },
    },
  };
  for (const tool of Object.values(tools)) {
    const handler = tool.handler;
    tool.handler = args => ownsFill(session) ? handler(args) : "ERROR: stale or parked fill worker; no action recorded.";
  }
  session.handle = runWorker({
    name: "fill", builtins: ["read", "write", "eval"], jobId: job.id, model: config.models.fill,
    cwd: dir, browser: true, cdpPort: session.browser.port, maxTime: isVerification ? "10m" : "24h", env: { DISPLAY: browser.display },
    prompt: render("fill", {
      ...job, resumePdf: frozen.pdf, mailbox, personal: readProfile("personal.yml"), answers: readProfile("answers.md"),
      resumeContext: JSON.stringify(context, null, 2),
      browserTabId: session.browser.tabId,
      continuationNote: job.note ?? "(none)",
      recovery: isVerification
        ? "VERIFICATION-ONLY MODE. Final submission was authorized previously, but its outcome is ambiguous. Your ONLY task is to check whether this application was already submitted or is still an unsubmitted draft. Sign in with existing credentials and check the candidate portal/status or confirmation email. NEVER submit, authorize, or click final submit. A checkpoint or form does NOT prove non-submission; require explicit portal status or validation error. Call verify_status to record evidence, or need_manual if inconclusive."
        : job.resume_sha || context.checkpoint
        ? "RESUMING an application. Recover the exact requisition and check if an account or draft exists. A frozen resume or checkpoint is navigation history, NOT proof that an ATS account or draft exists on the site. Previous handoff notes in resumeContext.handoffHistory are historical observations, NOT binding directives; current instructions and live site evidence supersede intermediate assumptions. Look at the earliest/oldest handoff to identify the true root failure. If the earliest failure occurred before account creation (e.g. outage or 302 before registration) and the site confirms no account exists, create credentials with get_account (register: true) and proceed with the first application. If remote signup never finished or this is the first application after pre-draft outage, permit initial registration with previously stored credentials or new account. If identity cannot be verified, call need_manual."
        : "First fill for this application. Open the exact posting and record the draft/requisition identity.",
      description: job.description || "(not captured; read it from the URL)", captchaAttempts: 3,
      approval: job.approved_by === "auto"
        ? "Approved by the candidate's standing auto-apply rules; they have not reviewed this application."
        : "The candidate has reviewed and approved this application.",
      submitRule: "- **Before final submit:** re-observe and verify all fields, take a full-page screenshot, then call `confirm_submit` with an exact summary and current navigation checkpoint. Click only if it returns APPROVED. An unused approval is valid only for the unchanged summary. Immediate post-click verification challenges (email codes or CAPTCHAs) continue this pending attempt; complete them using challenge controls. Any other uncertainty or requirement to click final application submit again requires `need_manual`; never click final application submit a second time.",
    }),
    tools,
  });
  const result = await session.handle.done;
  if (isVerification) {
    if (session.active) {
      parkGate(job.id, {
        kind: "submission_ambiguous",
        text: `Verification worker ended without conclusive evidence (${result.error ?? result.status}).`,
      }, session.checkpoint);
      endVerification(job.id);
      session.active = false;
    }
    return;
  }
  stopFailedFill(session, `Worker ended without a verified outcome (${result.error ?? result.status}).`);
}

// ---------------------------------------------------------------- track (mailbox -> statuses)

export const track = () =>
  exclusive("track", async () => {
    if (!gmail.gmailStatus().connected) return;
    const open = applicationsAwaitingOutcome();
    if (!open.length) return;
    const since = kvGet("last.track") ?? new Date(Date.now() - 7 * 86400_000).toISOString();
    const started = new Date().toISOString();
    const ids = new Set(open.map(j => j.id));
    let finished = false as boolean; // set from the tool callback
    const { done } = runWorker({
      name: "track",
      builtins: ["read", "write"],
      model: config.models.track,
      cwd: workDir(),
      maxTime: "20m",
      prompt: render("track", {
        mailbox: gmail.gmailStatus().address ?? "",
        since,
        sinceDate: since.slice(0, 10).replaceAll("-", "/"),
        applications: open.map(j => `${j.id} | ${j.company} | ${j.title} | ${j.submitted_at?.slice(0, 10) ?? "?"}`).join("\n"),
      }),
      tools: {
        ...gmailTools(),
        update_application: {
          description: "Record what a message means for one application.",
          parameters: schema({
            job_id: S.int("Application id from the list"),
            status: { type: "string", enum: ["submitted", "interview", "offer", "rejected_by_company"] },
            note: S.str("One line with the key fact"),
          }),
          handler: args => {
            const job_id = arg.int(args, "job_id"), note = arg.str(args, "note");
            const status = arg.oneOf(args, "status", ["submitted", "interview", "offer", "rejected_by_company"]);
            if (!ids.has(job_id)) return "ERROR: unknown application id.";
            updateJob(job_id, { status, note });
            logEvent("mail", `${status}: ${note}`, job_id, "track");
            return "Recorded.";
          },
        },
        note: {
          description: "Flag a message for the candidate that matches no listed application.",
          parameters: schema({ summary: S.str("One-line summary including sender") }),
          handler: args => (logEvent("mail", arg.str(args, "summary"), null, "track"), "Noted."),
        },
        track_done: {
          description: "Finish the tracking task.",
          parameters: schema({ summary: S.str("One-line summary") }),
          handler: args => {
            finished = true;
            logEvent("system", `Track: ${arg.str(args, "summary")}`);
            return "Done.";
          },
        },
      },
    });
    await done;
    if (finished) kvSet("last.track", started);
  });

// ---------------------------------------------------------------- scheduler

let prepActive = 0;
// One application per browser: filling[n] is the job in browser n. A browser rests between applications,
// and no two applications start close together. Both times are kept across restarts.
const filling: (FillSession | null)[] = Array.from({ length: browserCount() }, () => null);
const restUntil = filling.map((_, slot) => Number(kvGet(`fill.rest.${slot}`) ?? kvGet("fill.nextAt") ?? 0));
let nextFillAt = Number(kvGet("fill.nextAt") ?? 0);

// Daily caps keep token spend and application volume bounded whatever a scan turns up.
const today = () => new Date().toISOString().slice(0, 10);
type Counted = "prep" | "fill" | "locate" | "auto";
const usedToday = (what: Counted) => Number(kvGet(`count.${what}.${today()}`) ?? 0);
const countOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(usedToday(what) + 1));

export const autoApprovedToday = () => usedToday("auto");


// Jobs that only missed auto-approval because the day's allowance was used up, oldest first.
const DEFERRED_PREFIX = "auto.deferred.";
const deferApproval = (jobId: number) => kvSet(`${DEFERRED_PREFIX}${jobId}`, new Date().toISOString());
export const forgetDeferredApproval = (jobId: number) => kvDelete(`${DEFERRED_PREFIX}${jobId}`);

const DEFERRED_MIGRATION_KEY = "auto.deferred.migration";
const DEFERRED_MIGRATION_VERSION = "1";
const LEGACY_CAP_NOTE_REGEX = /^needs your review: auto apply has used its \d+ for today$/;

export function adoptLegacyDeferredJobs() {
  if (kvGet(DEFERRED_MIGRATION_KEY) === DEFERRED_MIGRATION_VERSION) return;
  const candidates = jobsInStatuses(["awaiting_approval"]);
  for (const job of candidates) {
    if (
      job.status === "awaiting_approval" &&
      job.approved_by === null &&
      job.note !== null &&
      LEGACY_CAP_NOTE_REGEX.test(job.note) &&
      !kvGet(`feedback.${job.id}`) &&
      !job.resume_sha &&
      !job.resume_frozen_at &&
      !job.submitted_at &&
      existsSync(workingPdf(job.id))
    ) {
      deferApproval(job.id);
    }
  }
  kvSet(DEFERRED_MIGRATION_KEY, DEFERRED_MIGRATION_VERSION);
}

export function pumpDeferredApprovals() {
  if (profileProblems().length > 0) return;
  adoptLegacyDeferredJobs();

  const rules = autoApply();
  if (!rules.enabled || !rules.phases.includes(config.phase)) return;

  const limit = rules.perDay;
  if (usedToday("auto") >= limit) return;

  const rows = kvEntries(DEFERRED_PREFIX).filter(row => row.key !== DEFERRED_MIGRATION_KEY);

  for (const row of rows) {
    if (usedToday("auto") >= limit) break;

    const idStr = row.key.slice(DEFERRED_PREFIX.length);
    const jobId = Number(idStr);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      kvDelete(row.key);
      continue;
    }

    const job = getJob(jobId);
    if (!job) {
      kvDelete(row.key);
      continue;
    }

    const pdf = workingPdf(job.id);
    const hasFeedback = !!kvGet(`feedback.${job.id}`);
    const isFrozen = !!(job.resume_sha || job.resume_frozen_at);
    const isSubmitted = !!(job.submitted_at || job.status === "submitted");

    if (
      job.status !== "awaiting_approval" ||
      job.approved_by !== null ||
      hasFeedback ||
      isFrozen ||
      isSubmitted ||
      !existsSync(pdf)
    ) {
      kvDelete(row.key);
      continue;
    }

    const result = reconsiderAutoApproval(job, {
      concerns: job.concerns,
      handPicked: false,
      approvedToday: usedToday("auto"),
    });

    if (result.approved && result.verdict) {
      const verdict = result.verdict;
      db.transaction(() => {
        countOne("auto");
        updateJob(job.id, {
          status: "approved",
          approved_by: "auto",
          score: verdict.score,
          checklist: JSON.stringify(verdict.items),
          practice_assessment: verdict.practice ? JSON.stringify(verdict.practice) : null,
          note: null,
        });
        kvDelete(row.key);
      })();
      logEvent("auto", `Approved by reconsidered auto apply: ${verdict.reason}`, job.id, "prep");
    } else {
      if (result.approval.deferred === "daily_cap") {
        break;
      } else {
        kvDelete(row.key);
        if (result.approval.note || result.reason) {
          updateJob(job.id, { note: result.approval.note ?? `needs your review: ${result.reason}` });
        }
      }
    }
  }
}
// Jobs a fill worker could be started for, in the order they should be tried: verification of an
// ambiguous submit first, then draft recovery, then jobs with a saved draft, then oldest.
function fillQueue() {
  const rank = (c: { verify: boolean; recovering: boolean; job: Job }) => (c.verify ? 4 : 0) + (c.recovering ? 2 : 0) + (c.job.fill_checkpoint === null ? 0 : 1);
  return jobsInStatuses(["approved", "needs_manual"])
    .map(job => ({ job, verify: isVerifying(job.id), recovering: isRecovering(job.id) }))
    .filter(c => c.job.status === "approved" || c.verify)
    .sort((a, b) => rank(b) - rank(a) || a.job.id - b.job.id);
}

// Start whatever work is waiting. Safe to call any time state changes.
export function pump() {
  if (!isRunning("locate") && usedToday("locate") < (config.limits.locatePerDay ?? 40) && jobsByStatus("locating", 1).length) void locate();
  if (profileProblems().length === 0) {
    pumpDeferredApprovals();
    while (prepActive < config.concurrency.prep && usedToday("prep") < config.limits.prepPerDay) {
      const job = nextToPrep();
      if (!job) break;
      prepActive++;
      countOne("prep");
      updateJob(job.id, { status: "prepping" });
      void prep(job)
        .catch((err: unknown) => { updateJob(job.id, { status: "failed", note: `prep: ${errorMessage(err)}` }); })
        .finally(() => {
          prepActive--;
          pump();
        });
    }
  }
  const leases = manualLeases();
  let queue: ReturnType<typeof fillQueue> | undefined;
  for (let slot = 0; slot < filling.length; slot++) {
    if (filling[slot] || leases.has(slot) || manualActivations.has(slot) ||
        Date.now() < Math.max(nextFillAt, restUntil[slot] ?? 0)) continue;
    // Only current workers and explicit human inspection own employer sessions.
    const employers = new Set<string>();
    for (const owner of [...fillSessions.keys(), ...leases.values(), ...manualActivations.values()]) {
      const activeJob = getJob(owner);
      if (activeJob) employers.add(activeJob.company_key ?? activeJob.company);
    }
    let selectedJob: Job | undefined;
    let checkpoint: FillCheckpoint | null = null;
    let isVerification = false;
    // Recovery is priority, not ownership: skipped candidates cannot block the slot.
    // Multiple parked/recovering applications may share a persistent profile.
    for (const { job: candidate, verify } of (queue ??= fillQueue())) {
      if (fillSessions.has(candidate.id) || employers.has(candidate.company_key ?? candidate.company) || getOpenGate(candidate.id)) continue;
      if (!verify && usedToday("fill") >= config.limits.applyPerDay) continue;
      const saved = readCheckpoint(candidate.id);
      if (saved ? saved.slot !== slot : candidate.resume_sha && lastSlot(candidate.id) !== slot) continue;
      selectedJob = candidate;
      checkpoint = saved;
      isVerification = verify;
      break;
    }
    const job = selectedJob;
    if (!job) continue;
    const [min, max] = config.fillPauseSeconds;
    const session: FillSession = { jobId: job.id, slot, active: true, checkpoint: checkpoint ?? defaultCheckpoint(job, slot) };
    filling[slot] = session;
    fillSessions.set(job.id, session);
    beginAttempt(job.id);
    if (!isVerification) countOne("fill");
    nextFillAt = Date.now() + min * 1000;
    kvSet("fill.nextAt", String(nextFillAt));
    fill(job, session)
      .catch(async (err: unknown) => {
        stopFailedFill(session, `fill: ${errorMessage(err)}`);
        // A thrown callback cannot free a still-running worker's slot.
        if (session.handle) {
          session.handle.abort();
          await session.handle.done;
        }
      })
      .finally(() => {
        session.browser?.close();
        if (fillSessions.get(job.id) === session) fillSessions.delete(job.id);
        if (filling[slot] !== session) return;
        filling[slot] = null;
        restUntil[slot] = Date.now() + (min + Math.random() * (max - min)) * 1000;
        kvSet(`fill.rest.${slot}`, String(restUntil[slot]));
        pump();
      });
  }
}

export function startScheduler() {
  dedupeExisting();
  adoptLegacyDeferredJobs();
  importLegacyGates();
  requeueInterruptedPrep();
  // Open gates remain parked; answered gates remain queued. A marker is never
  // cleared by startup, generic retry, or the act of requesting approval.
  for (const j of jobsInStatuses(["approved", "filling", "needs_input", "awaiting_submit", "needs_manual", "failed"])) {
    const checkpoint = readCheckpoint(j.id) ?? defaultCheckpoint(j, lastSlot(j.id) ?? 0);
    const gate = getOpenGate(j.id);
    if (isSubmitting(j.id)) {
      endVerification(j.id);
      if (gate?.kind !== "submission_ambiguous")
        parkGate(j.id, { kind: "submission_ambiguous", text: "Restart after final submission authorization. Inspect the exact application and mailbox; explicitly mark submitted, confirmed not submitted, or reject." }, checkpoint);
    } else if (gate) {
      if (!readCheckpoint(j.id)) recordCheckpoint(j.id, checkpoint);
    } else if (j.status === "filling") {
      recordCheckpoint(j.id, checkpoint);
      updateJob(j.id, { status: "approved", pending: null, note: "Recovering the same interrupted draft after restart" });
      logEvent("system", "Interrupted fill queued for exact draft recovery with frozen resume", j.id);
    } else if (["needs_input", "awaiting_submit", "needs_manual"].includes(j.status)) {
      parkGate(j.id, { kind: "manual", text: "Interrupted legacy wait has no recoverable gate. Inspect the exact draft before returning control." }, checkpoint);
    }
  }
  // Upgrading from the single schedule: the last scan also ran discovery.
  const lastScan = kvGet("last.scan");
  if (!kvGet("last.discover") && lastScan) kvSet("last.discover", lastScan);
  const tick = () => {
    if (due("last.scan", config.schedule.scanMinutes) && !profileProblems(["targets.md"]).length) void scan({ discover: due("last.discover", config.schedule.discoverMinutes) });
    if (due("last.track", config.schedule.trackMinutes) && !kvGet("last.track.attempt")?.startsWith(new Date().toISOString().slice(0, 13))) {
      kvSet("last.track.attempt", new Date().toISOString());
      void track();
    }
    void tickQuestionDigest().catch((err: unknown) => { logEvent("error", `Question digest: ${errorMessage(err)}`); });
    pump();
  };
  setInterval(tick, 30_000);
  tick();
}
