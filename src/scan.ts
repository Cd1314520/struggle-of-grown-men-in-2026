// Scan: read every source, save what is new, and let a triage worker decide what is worth a full read.
import { boardHost, feedNames, fetchCompany, fetchDescription, fetchFeed, loadCompanies, watchBoardOf, type Company } from "./ats";
import { boardMinutes, boardNames, fetchBoard, isBoardUrl } from "./boards";
import { config, readProfile } from "./config";
import { appliedLocation, insertJob, jobsByStatus, kvSet, logEvent, moveJob, type Job } from "./db";
import { employersText } from "./employers";
import { errorMessage } from "./errors";
import { due } from "./limits";
import { arg, S, schema, type RunWorker } from "./worker";
import { requireProfile } from "./profile";
import { screenOut } from "./screen";
import { to } from "./status";
import { addCompanyTool, render, workDir } from "./worker-tools";

// Hosts read at once during a scan.
const SCAN_LANES = 6;

// Postings per triage call (`triage.batch`). The prompt around them (the targets, the employers named,
// the instructions) costs the same for one posting as for a hundred, so a partial batch waits for more
// scans to fill it, up to `triage.waitHours` after its oldest posting was found. A job the candidate
// picked by hand never waits.
export const triageBatch = () => config.triage?.batch ?? 100;
const triageWaitHours = () => config.triage?.waitHours ?? 2;

// A board that is down would otherwise log the same error on every scan.
const feedErrors = new Map<string, number>();
function feedError(key: string, err: unknown) {
  if (Date.now() - (feedErrors.get(key) ?? 0) < 6 * 3600_000) return;
  feedErrors.set(key, Date.now());
  logEvent("error", `feed ${key}: ${errorMessage(err)}`);
}

// Reads every source. Cheap when nothing changed: known postings are ignored and duplicates folded,
// so agents only run for postings never seen before.
export async function scanSources(run: RunWorker, opts: { discover?: boolean } = {}) {
  kvSet("last.scan", new Date().toISOString());
  requireProfile(["targets.md"]);
  if (opts.discover) {
    kvSet("last.discover", new Date().toISOString());
    await discover(run);
  }
  let added = 0;
  const from: string[] = [];
  const take = (label: string, postings: Awaited<ReturnType<typeof fetchCompany>>) => {
    let n = 0;
    for (const p of postings) if (p.url && p.title && p.company && insertJob(p)) n++;
    if (n) from.push(`${label} ${n}`);
    added += n;
  };
  // Boards on different hosts are read side by side; boards that share a host, one after another.
  const byHost = new Map<string, Company[]>();
  for (const company of loadCompanies()) byHost.set(boardHost(company), [...(byHost.get(boardHost(company)) ?? []), company]);
  const queue = [...byHost.values()].sort((a, b) => b.length - a.length);
  await Promise.all(
    Array.from({ length: SCAN_LANES }, async () => {
      for (let group; (group = queue.shift());)
        for (const company of group) {
          try {
            take(company.name, await fetchCompany(company));
          } catch (err) {
            feedError(`${company.ats}/${company.slug}`, err);
          }
        }
    }),
  );
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
  await triage(run);
}

// Drops what screenOut rules out. Jobs the candidate picked by hand are left to the model.
function screen(batch: Job[]): Job[] {
  const left: Job[] = [];
  let dropped = 0;
  for (const job of batch) {
    const reason = job.hand_picked === 1 ? null : screenOut(job.title, appliedLocation(job), job.url, job.description);
    if (!reason) left.push(job);
    else if (moveJob(job.id, "found", to.skipped(reason))) dropped++;
  }
  if (dropped)
    logEvent(
      "system",
      `Triage: screened out ${dropped} of ${batch.length} abroad, unwanted, past-term or senior-level postings, or dead-end portals before reading`,
    );
  return left;
}

// SQLite's datetime('now'): UTC, with a space for the T.
const hoursSince = (at: string) => (Date.now() - Date.parse(`${at.replace(" ", "T")}Z`)) / 3600_000;

// Whether the postings left after the screen are worth a call now: a full batch, one that has waited
// long enough, or one with a job picked by hand in it.
export function triageDue(waiting: Job[], hasFeedback = (job: Job) => job.hand_picked === 1) {
  if (!waiting.length) return false;
  if (waiting.length >= triageBatch()) return true;
  return waiting.some(j => hoursSince(j.found_at) >= triageWaitHours() || hasFeedback(j));
}

async function triage(run: RunWorker) {
  for (;;) {
    const waiting = screen(jobsByStatus("found", 100_000));
    if (!triageDue(waiting)) return;
    const batch = waiting.slice(0, triageBatch());
    const ids = new Set(batch.map(j => j.id));
    let kept = null as number[] | null; // set from the tool callback
    let held: number[] = [];
    const { done } = run({
      name: "triage",
      // Everything it needs is in the prompt; file tools would only add their definitions to every call.
      builtins: [],
      model: config.models.triage,
      cwd: workDir(),
      maxTime: "10m",
      prompt: render("triage", {
        employers: employersText(
          undefined,
          batch.map(j => j.company),
        ),
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
    // With nothing held back, what the targets would keep for later is read now.
    const keep = new Set<number>(config.targets.holdBack ? kept : [...kept, ...held]);
    const hold = new Set<number>(config.targets.holdBack ? held : []);
    for (const j of batch) {
      if (keep.has(j.id) && isBoardUrl(j.url)) moveJob(j.id, "found", to.locating());
      else if (keep.has(j.id)) {
        // Boards that list titles only: get the body now that the posting is worth reading.
        const description = j.description ? undefined : await fetchDescription(j.url);
        moveJob(j.id, "found", { ...to.triaged(), ...(description ? { description } : {}) });
      } else if (hold.has(j.id)) moveJob(j.id, "found", to.held("held back at triage", "triage"));
      else moveJob(j.id, "found", to.skipped("dropped at triage"));
    }
    logEvent("system", `Triage: kept ${keep.size}, held ${hold.size} of ${batch.length}`);
  }
}

async function discover(run: RunWorker) {
  const { done } = run({
    name: "discover",
    builtins: ["read", "write", "web_search"],
    model: config.models.discover,
    cwd: workDir(),
    maxTime: "25m",
    prompt: render("discover", {
      employers: employersText(),
      targets: readProfile("targets.md"),
      companies:
        loadCompanies()
          .map(c => `${c.name} (${c.ats}/${c.slug})`)
          .join(", ") || "(none yet)",
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
        handler: async args => {
          const posting = {
            url: arg.str(args, "url"),
            company: arg.str(args, "company"),
            title: arg.str(args, "title"),
            location: arg.str(args, "location"),
            description: arg.str(args, "description"),
          };
          if (/linkedin\.com|indeed\.com/i.test(posting.url)) return "ERROR: aggregator links are not accepted; find the original posting.";
          const saved = insertJob({ ...posting, source: "discover" }, "triaged") ? "Saved." : "Already known.";
          const board = await watchBoardOf(posting.url, posting.company);
          if (board) logEvent("system", `Watching ${board.name}'s board (${board.ats}/${board.slug}), found through a posting`);
          return board ? `${saved} Its board (${board.ats}/${board.slug}) is now watched, so do not save its other postings one by one.` : saved;
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
