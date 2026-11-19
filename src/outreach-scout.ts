// Early outreach's agent work: the scout, which finds fresh hiring posts, new startup listings and seed
// rounds, picks up to three people at each and drafts a short email to each; and the daily follow-up run.
// Neither sends anything: the owner copies each draft into his own mail (docs/outreach.md). Both run on
// models.outreach, else the discover model, with the discover stage's fallbacks.
import { companyKey } from "./company-key";
import { config, readProfile } from "./config";
import { db, kvGet, kvSet, logEvent } from "./db";
import { LEAD_KINDS, outreachStore, type Confidence, type OutreachStore } from "./leads";
import {
  BODY_LINES,
  bodyProblem,
  draftsWanted,
  emailGuesses,
  expiredDrafts,
  FOLLOW_UP_LINES,
  followUpsDue,
  isFresh,
  leadProblem,
  quietPeople,
} from "./outreach-plan";
import { backedOff, due } from "./limits";
import { dayIn } from "./referral-plan";
import { arg, S, schema, type HostTool, type RunWorker, type ToolArgs } from "./worker";
import { humanizerRules, render, workDir } from "./worker-tools";

export const OUTREACH_DEFAULTS = {
  minutes: 240,
  perDay: 20,
  leadsPerRun: 8,
  minScore: 60,
  followUpDays: 5,
  resuggestDays: 30,
  hunterPerDay: 3,
  sendFrom: null as string | null,
  hunterKey: null as string | null,
};
export const outreachSettings = () => ({ ...OUTREACH_DEFAULTS, ...config.outreach });
export const outreachTimeZone = () => config.questionDigest?.timeZone ?? "America/Chicago";
export const leadsStore = outreachStore(db);

const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];
const SOURCES = ["public", "hunter", "guess"] as const;
const optNumber = (args: ToolArgs, key: string): number | null => {
  const v = args[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} must be a number`);
  return v;
};

// Hunter.io's email finder, when a key is set: an address and how sure it is, or null.
async function hunter(
  key: string,
  first: string,
  last: string,
  domain: string,
  fetchFn: typeof fetch,
): Promise<{ email: string; confidence: Confidence } | null> {
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.search = new URLSearchParams({ domain, first_name: first, last_name: last, api_key: key }).toString();
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { email?: string | null; score?: number | null } };
    const email = body.data?.email;
    return email ? { email: email.toLowerCase(), confidence: (body.data?.score ?? 0) >= 70 ? "high" : "medium" } : null;
  } catch {
    return null;
  }
}

// The scout's host tools, on the store given (the app's, or one in memory under test).
export function scoutTools(store: OutreachStore, now: () => Date = () => new Date(), fetchFn: typeof fetch = fetch): Record<string, HostTool> {
  const today = () => dayIn(outreachTimeZone(), now());
  let added = 0; // leads this run
  return {
    add_lead: {
      description: "Save one lead: a fresh hiring post, a new startup listing, or a seed round. Returns its id, or why it was refused.",
      parameters: schema(
        {
          kind: { type: "string", enum: [...LEAD_KINDS], description: "post, listing or seed" },
          company: S.str("Company name"),
          domain: S.str("The company's email domain, e.g. acme.com"),
          source_url: S.str("Where you found it"),
          source_title: S.str("The post's, listing's or article's title"),
          posted_at: S.str("When it appeared, ISO 8601 (e.g. 2026-11-18T14:00:00Z)"),
          likes: { type: "integer", description: "Likes shown in the search result; leave out when none are shown" },
          what_they_do: S.str("One sentence: what the company builds"),
          why_fit: S.str("One or two sentences: where the candidate would help, from his facts only"),
          score: S.int("Fit for this candidate, 0-100"),
          fetched: { type: "boolean", description: "true if you opened the source page itself rather than reading a search result" },
        },
        ["kind", "company", "domain", "source_url", "source_title", "posted_at", "what_they_do", "why_fit", "score"],
      ),
      handler: args => {
        const s = outreachSettings();
        const lead = {
          kind: arg.oneOf(args, "kind", LEAD_KINDS),
          company: arg.str(args, "company"),
          domain: arg.str(args, "domain"),
          source_url: arg.str(args, "source_url"),
          source_title: arg.str(args, "source_title"),
          posted_at: arg.str(args, "posted_at"),
          likes: optNumber(args, "likes"),
          what_they_do: arg.str(args, "what_they_do"),
          why_fit: arg.str(args, "why_fit"),
          score: arg.int(args, "score"),
        };
        if (added >= s.leadsPerRun) return `Refused: run limit of ${s.leadsPerRun} leads reached; call outreach_done.`;
        if (draftsWanted(store.people(), store.leads(), s.perDay, now(), outreachTimeZone(), s.resuggestDays) <= 0)
          return "Refused: today's list is full; call outreach_done.";
        const open = new Set(
          store
            .leads(["new", "active"])
            .filter(l => isFresh(l, now()))
            .map(l => l.company_key),
        );
        const problem = leadProblem({ ...lead, company_key: companyKey(lead.company), fetched: args["fetched"] === true }, now(), {
          minScore: s.minScore,
          resuggestDays: s.resuggestDays,
          sentCompanyDays: store.sentCompanyDays(),
          timeZone: outreachTimeZone(),
          openCompanyKeys: open,
        });
        if (problem) return `Refused: ${problem}.`;
        const saved = store.addLead(lead);
        if (saved) added++;
        return saved ? `Lead ${saved.id} saved. Now find up to three people there.` : "Refused: this source is known already.";
      },
    },
    add_person: {
      description: `Save one person at a lead, with the email drafted to them (${BODY_LINES} lines or fewer). At most three per lead.`,
      parameters: schema(
        {
          lead_id: S.int("The id add_lead returned"),
          name: S.str("Full name"),
          role: S.str("Their role, e.g. CEO and co-founder"),
          profile_url: S.str("A public page about them, if any"),
          email: S.str("Their work email"),
          email_source: { type: "string", enum: [...SOURCES], description: "public: shown on a page; hunter or guess: from find_email" },
          email_confidence: { type: "string", enum: [...CONFIDENCES], description: "high, medium or low; a guess is low" },
          subject: S.str("Short subject line"),
          body: S.str(`The email, ${BODY_LINES} lines or fewer, signed with the candidate's first name`),
        },
        ["lead_id", "name", "role", "email", "email_source", "email_confidence", "subject", "body"],
      ),
      handler: args => {
        const leadId = arg.int(args, "lead_id");
        const lead = store.lead(leadId);
        if (!lead) return `Refused: no lead ${leadId}.`;
        const body = arg.str(args, "body").trim();
        const problem = bodyProblem(body, BODY_LINES);
        if (problem) return `Refused: ${problem}.`;
        const email = arg.str(args, "email").trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `Refused: "${email}" is not an email address.`;
        if (store.people(leadId).length >= 3) return "Refused: this lead has three people already.";
        if (store.people().some(p => p.email === email.toLowerCase())) return "Refused: this address has a draft already; nobody gets two.";
        const person = store.addPerson({
          lead_id: leadId,
          name: arg.str(args, "name"),
          role: arg.str(args, "role"),
          profile_url: arg.optStr(args, "profile_url") ?? null,
          email,
          email_source: arg.oneOf(args, "email_source", SOURCES),
          email_confidence: arg.oneOf(args, "email_confidence", CONFIDENCES),
          subject: arg.str(args, "subject"),
          body,
          drafted_on: today(),
        });
        if (!person) return "Refused: this address is on the lead already.";
        if (lead.status === "new") store.setLeadStatus(leadId, "active");
        return `Draft ${person.id} saved.`;
      },
    },
    find_email: {
      description: "Find a work address no page shows: a Hunter.io lookup when one is allowed, otherwise the common patterns, marked low.",
      parameters: schema(
        { first: S.str("First name"), last: S.str("Last name"), domain: S.str("Company email domain"), lead_id: S.int("The lead it is for") },
        ["first", "last", "domain"],
      ),
      handler: async args => {
        const first = arg.str(args, "first"),
          last = arg.str(args, "last"),
          domain = arg.str(args, "domain");
        const s = outreachSettings();
        const lead = store.lead(arg.optInt(args, "lead_id") ?? -1);
        const counter = `count.hunter.${today()}`;
        const used = Number(kvGet(counter) ?? 0);
        if (s.hunterKey && lead && lead.score >= s.minScore && used < s.hunterPerDay) {
          kvSet(counter, String(used + 1));
          const found = await hunter(s.hunterKey, first, last, domain, fetchFn);
          if (found) return `${found.email} (hunter, ${found.confidence})`;
        }
        const guesses = emailGuesses(first, last, domain);
        return guesses.length
          ? `No address found. Common patterns, most likely first: ${guesses.join(", ")} (guess, low). Use the first unless a page suggests another.`
          : "No address found, and the name or domain is too short to guess one.";
      },
    },
    outreach_done: {
      description: "Finish the run.",
      parameters: schema({ summary: S.str("One-line summary") }),
      handler: args => {
        logEvent("system", `Outreach: ${arg.str(args, "summary")}`);
        return "Done.";
      },
    },
  };
}

// The companies emailed within resuggestDays, by name, for the prompt.
function recentlyContacted(store: OutreachStore, now: Date) {
  const { resuggestDays } = outreachSettings();
  const today = Date.parse(dayIn(outreachTimeZone(), now));
  const recent = new Set([...store.sentCompanyDays()].filter(([, day]) => today - Date.parse(day) < resuggestDays * 86_400_000).map(([key]) => key));
  return (
    [
      ...new Set(
        store
          .leads()
          .filter(l => recent.has(l.company_key))
          .map(l => l.company),
      ),
    ].join(", ") || "(none yet)"
  );
}

export function scoutPrompt(store: OutreachStore, now = new Date()): string {
  const s = outreachSettings();
  return render("outreach", {
    minScore: s.minScore,
    leadsPerRun: s.leadsPerRun,
    wanted: Math.max(0, draftsWanted(store.people(), store.leads(), s.perDay, now, outreachTimeZone(), s.resuggestDays)),
    sendFrom: s.sendFrom ?? "his own address",
    contacted: recentlyContacted(store, now),
    targets: readProfile("targets.md"),
    answers: readProfile("answers.md"),
    humanizer: humanizerRules(),
  });
}

// Whether the scout should run now: not while every provider is out, not when off, and only when its
// interval has passed and fewer drafts wait than today still has room for.
export function shouldScout(store: OutreachStore = leadsStore, now = new Date()): boolean {
  const s = outreachSettings();
  if (backedOff() || !s.minutes || !due("last.outreach", s.minutes)) return false;
  return draftsWanted(store.people(), store.leads(), s.perDay, now, outreachTimeZone(), s.resuggestDays) > 0;
}

// People followed up with no reply for followUpDays become no_response, so the waiting list and the mail
// check stop growing. How many were closed.
export function closeQuiet(store: OutreachStore = leadsStore, now = new Date()): number {
  const day = dayIn(outreachTimeZone(), now);
  const ids = quietPeople(store.people(), day, outreachSettings().followUpDays);
  for (const id of ids) store.setStage(id, "no_response", day);
  return ids.length;
}

// People whose follow-up is due and not yet drafted.
const followUpsToDraft = (store: OutreachStore, now: Date) =>
  followUpsDue(store.people(), dayIn(outreachTimeZone(), now), outreachSettings().followUpDays).filter(p => !p.followup_body);

// Whether the follow-up run should start now: once a day, while outreach is on, when any are due.
export function shouldFollowUp(store: OutreachStore = leadsStore, now = new Date()): boolean {
  if (backedOff() || !outreachSettings().minutes) return false;
  if (kvGet("last.outreachFollowUp") === dayIn(outreachTimeZone(), now)) return false;
  return followUpsToDraft(store, now).length > 0;
}

export function followUpTools(store: OutreachStore): Record<string, HostTool> {
  return {
    set_followup: {
      description: `Save the follow-up for one person (${FOLLOW_UP_LINES} lines or fewer).`,
      parameters: schema({ person_id: S.int("The person's id, as listed"), body: S.str(`The follow-up, ${FOLLOW_UP_LINES} lines or fewer`) }),
      handler: args => {
        const id = arg.int(args, "person_id");
        const person = store.person(id);
        if (person?.stage !== "sent") return `Refused: no person ${id} waiting for a follow-up.`;
        const body = arg.str(args, "body").trim();
        const problem = bodyProblem(body, FOLLOW_UP_LINES);
        if (problem) return `Refused: ${problem}.`;
        store.setFollowUp(id, body);
        return "Saved.";
      },
    },
    followup_done: {
      description: "Finish the run.",
      parameters: schema({ summary: S.str("One-line summary") }),
      handler: args => {
        logEvent("system", `Outreach follow-ups: ${arg.str(args, "summary")}`);
        return "Done.";
      },
    },
  };
}

// One follow-up run: a draft for everyone whose follow-up fell due today or before.
export async function runFollowUps(run: RunWorker, store: OutreachStore = leadsStore): Promise<void> {
  const now = new Date();
  kvSet("last.outreachFollowUp", dayIn(outreachTimeZone(), now));
  const people = followUpsToDraft(store, now);
  if (!people.length) return;
  const text = people
    .map(p => {
      const lead = store.lead(p.lead_id);
      return [
        `### Person ${p.id}: ${p.name}, ${p.role} at ${lead?.company ?? "?"} (first email sent ${p.sent_on ?? "?"})`,
        lead ? `What they do: ${lead.what_they_do}\nWhy the candidate fits: ${lead.why_fit}` : "",
        `First email, subject "${p.subject}":\n${p.body}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const { done } = run({
    name: "outreach-followup",
    stage: "discover",
    model: config.models.outreach ?? config.models.discover,
    builtins: ["read"],
    cwd: workDir(),
    maxTime: "10m",
    prompt: render("outreach-followup", {
      followUpDays: outreachSettings().followUpDays,
      people: text,
      answers: readProfile("answers.md"),
      humanizer: humanizerRules(),
    }),
    tools: followUpTools(store),
  });
  await done;
}

// One scout run: drops drafts that went stale, then asks the agent for new leads.
export async function runScout(run: RunWorker, store: OutreachStore = leadsStore): Promise<void> {
  const now = new Date();
  store.deleteExpiredDrafts(expiredDrafts(store.people(), store.leads(), now));
  closeQuiet(store, now);
  kvSet("last.outreach", now.toISOString());
  const { done } = run({
    name: "outreach",
    stage: "discover",
    model: config.models.outreach ?? config.models.discover,
    builtins: ["read", "web_search"],
    cwd: workDir(),
    maxTime: "25m",
    prompt: scoutPrompt(store, now),
    tools: scoutTools(store),
  });
  await done;
}
