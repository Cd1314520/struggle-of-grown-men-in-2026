// What the workers share: how a prompt is rendered, where a worker without a job runs, and the
// host tools more than one kind of worker is given.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addCompany, ATS, fetchCompany, isAts, isCampusBoard, type Posting } from "./ats";
import { config, DATA, PROMPTS } from "./config";
import { errorMessage } from "./errors";
import * as gmail from "./gmail";
import { arg, S, schema, type HostTool } from "./omp";
import { fillTemplate } from "./template";

export const readPrompt = (name: string) => readFileSync(join(PROMPTS, `${name}.md`), "utf8");

export const render = (name: string, vars: Record<string, string | number | null>) =>
  `Application phase: ${config.phase.toUpperCase()}\n\n` + fillTemplate(readPrompt(name), vars, `prompts/${name}.md`);

// What the fill and recheck agents may answer for the candidate without asking (prompts/low-stakes.md).
export const lowStakesRule = () => readPrompt("low-stakes").trim();

export const workDir = () => {
  const dir = join(DATA, "work");
  mkdirSync(dir, { recursive: true });
  return dir;
};

// `also` may add to the reply, given the board's postings.
export const addCompanyTool = (also?: (postings: Posting[]) => string): HostTool => ({
  description: "Add a company job board to the watch list. Verifies the board exists.",
  parameters: schema({
    name: S.str("Company name"),
    ats: { type: "string", enum: [...ATS] },
    slug: S.str("Board slug as the board table in your task gives it; for workday '<tenant>.<wdN>/<site>'"),
  }),
  handler: async args => {
    const name = arg.str(args, "name"),
      ats = arg.str(args, "ats"),
      slug = arg.str(args, "slug").trim();
    if (!isAts(ats)) return `ERROR: ats must be one of ${ATS.join(", ")}`;
    const company = { name, ats, slug };
    if (isCampusBoard(company)) return "Not added: a campus board lists only internships and new-grad roles, which the targets rule out.";
    const postings = await fetchCompany(company).catch((err: unknown) => {
      throw new Error(`board ${ats}/${slug} not reachable (${errorMessage(err)}); check the slug`);
    });
    return (addCompany(company) ? `Added ${name}: ${postings.length} open postings will be scanned.` : "Already on the watch list.") + (also?.(postings) ?? "");
  },
});

export const gmailTools = (): Record<string, HostTool> => ({
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
