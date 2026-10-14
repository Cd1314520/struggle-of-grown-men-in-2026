// Scan: read every source, save what is new, and let a triage worker decide what is worth a full read.
import { feedNames, fetchCompany, fetchDescription, fetchFeed, loadCompanies } from "./ats";
import { boardMinutes, boardNames, fetchBoard, isBoardUrl } from "./boards";
import { config, readProfile } from "./config";
import { insertJob, jobsByStatus, kvSet, logEvent, updateJob } from "./db";
import { employersText } from "./employers";
import { errorMessage } from "./errors";
import { due } from "./limits";
import { arg, S, schema, type RunWorker } from "./omp";
import { requireProfile } from "./profile";
import { to } from "./status";
import { addCompanyTool, render, workDir } from "./worker-tools";

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
  await triage(run);
}

async function triage(run: RunWorker) {
  for (;;) {
    const batch = jobsByStatus("found", 50);
    if (!batch.length) return;
    const ids = new Set(batch.map(j => j.id));
    let kept = null as number[] | null; // set from the tool callback
    let held: number[] = [];
    const { done } = run({
      name: "triage",
      builtins: ["read", "write"],
      model: config.models.triage,
      cwd: workDir(),
      maxTime: "10m",
      prompt: render("triage", {
        employers: employersText(),
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
      if (keep.has(j.id) && isBoardUrl(j.url)) updateJob(j.id, to.locating());
      else if (keep.has(j.id)) {
        // Boards that list titles only: get the body now that the posting is worth reading.
        const description = j.description ? undefined : await fetchDescription(j.url);
        updateJob(j.id, { ...to.triaged(), ...(description ? { description } : {}) });
      } else if (hold.has(j.id)) updateJob(j.id, to.held(`held back during the ${config.phase} phase`));
      else updateJob(j.id, to.skipped("dropped at triage"));
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
        handler: args => {
          const posting = {
            url: arg.str(args, "url"),
            company: arg.str(args, "company"),
            title: arg.str(args, "title"),
            location: arg.str(args, "location"),
            description: arg.str(args, "description"),
          };
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
