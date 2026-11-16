// The words the owner sends, drafted from what they wrote in profile/referral.yml and nothing else: who
// they are (me), what they are after (interest) and, per kind of role, one hook and one fact. No model
// writes these and nothing is made up; a draft the facts do not cover reads shorter, never invented.
// The owner copies a draft and sends it themselves.
import { areaFor, type ReferralProfile } from "./referral-plan";
import type { Relation, Stage } from "./referrals";

export interface DraftContact {
  name: string;
  company: string;
  relation: Relation;
  stage: Stage;
  email: string | null;
  area: string | null;
  job: { title: string; url: string | null; applied: boolean; inProcess: boolean } | null;
}
export interface Signature {
  name: string;
  linkedin: string;
}

export interface Drafts {
  note: string; // the connection request's note, within the limit; "" when already connected
  message: string; // after they accept (or, to a connection, the first message)
  followup: string; // once, a week after the message
  email: { subject: string; body: string } | null; // when the owner has their address
  packet: string; // if they say yes: everything in one place
  thanks: string; // after the referral
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
const possessive = (co: string) => co + (co.endsWith("s") ? "'" : "'s");
export const cleanCompany = (name: string) => name.replace(/\s*\(.*?\)/g, "").trim();

// A job title cut to what a person would say: no season, year, "intern" or "program", at most 40 characters.
export function shortJob(title: string): string {
  let t = title
    .replace(/\(.*?\)|\b(summer|fall|spring|winter|20\d\d|interns?(hip)?|co-?op|program)\b|[-–|,:/]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  while (t.length > 40 && t.includes(" ")) t = t.slice(0, t.lastIndexOf(" "));
  return t.slice(0, 40);
}

// "have built X" -> "I've built X"; "am leading X" -> "I'm leading X"; anything else -> "I X".
function firstPerson(hook: string): string {
  const [verb = "", ...rest] = hook.split(" ");
  const tail = rest.join(" ");
  if (verb.toLowerCase() === "have") return `I've ${tail}`;
  if (verb.toLowerCase() === "am") return `I'm ${tail}`;
  return `I ${hook}`;
}

export function buildDrafts(c: DraftContact, profile: ReferralProfile, sign: Signature): Drafts | null {
  const area = areaFor(profile, c.job?.title ?? null, c.area);
  if (!area) return null;
  const { me, linkedin, interest } = profile;
  const first = firstName(c.name),
    hi = `Hi ${first}`,
    co = cleanCompany(c.company);
  const title = c.job?.title ?? "";
  const job = shortJob(title);
  const kind = /co-?op/i.test(title) ? "co-op" : /\bintern(ship)?s?\b/i.test(title) ? "internship" : "role";
  const role = job
    ? `${possessive(co)} ${job} ${kind}`
    : kind === "co-op"
      ? `a co-op at ${co}`
      : `an ${kind === "internship" ? "internship" : "opening"} at ${co}`;
  const hook = area.hook,
    iHook = firstPerson(hook);
  const applied = c.job?.applied ?? false;
  const did = c.job ? (applied ? `I applied to ${role}` : `I'm applying to ${role}`) : `I'm interested in ${possessive(co)} ${interest}`;

  let notes: string[];
  if (c.relation === "manager")
    notes = [
      `${hi}, I'm a ${me.shortLocal}. ${did} and ${hook}. Would love to learn what your team looks for!`,
      `${hi}, I'm a ${me.short}. ${did} and ${hook}. Would love to learn about your team!`,
      `${hi}, I'm a ${me.short}. ${did}. Would love to learn about your team!`,
    ];
  else if (c.relation === "recruiter")
    notes = [
      `${hi}, I'm a ${me.shortLocal}. ${did} and ${hook}. Happy to share more!`,
      `${hi}, ${me.short} here. ${did} and ${hook}. Happy to share more!`,
      `${hi}, ${me.short} here. ${did}. ${iHook}.`,
    ];
  else {
    const intro = c.relation === "alumni" ? me.alumniIntro : `I'm a ${me.short}`;
    notes = [
      `${hi}, ${intro}. ${did} and ${hook}. Would love to hear how you got started at ${co}!`,
      `${hi}, ${intro}. ${did} and ${hook}. Would love to connect!`,
      `${hi}, ${intro}. ${did}. ${iHook}. Would love to connect!`,
      `${hi}, ${intro}. ${did}. Would love to connect!`,
    ];
  }
  const limit = linkedin.noteLimit;
  let note = notes.find(n => n.length <= limit) ?? (notes.at(-1) ?? "").slice(0, limit);

  const link = c.job?.url ? ` (${c.job.url})` : "";
  const appliedWords = applied ? "I applied" : "I am applying";
  let ctx: string, ask: string;
  if (c.job?.inProcess) {
    ctx = `I'm in the interview process for ${role}.`;
    ask =
      "Would you have 15 minutes to tell me about the team and what the work looks like day to day? Any advice before the next step would help a lot. No worries if you're busy.";
  } else if (!c.job) {
    ctx = `I'm hoping to apply to ${possessive(co)} ${interest} when they open.`;
    ask = "Would you have 15 minutes sometime to tell me about your team and what you look for? No worries at all if you're busy.";
  } else if (c.relation === "manager") {
    // A conversation, not a job, with a time window.
    ctx = `${appliedWords} to ${role}${link}, and I think it's on your team.`;
    ask = "Would you have 15 minutes in the next two weeks to tell me about the team and what you look for? I'm happy to work around your schedule.";
  } else if (c.relation === "recruiter") {
    ctx = `${appliedWords} to ${role}${link}.`;
    ask =
      "Could you let me know whether my background fits what the team is looking for, or if there's a better role I should apply to? I'm happy to send my resume.";
  } else {
    ctx = `${appliedWords} to ${role}${link}.`;
    ask =
      "If you think I'd be a reasonable fit, would you be comfortable referring me or passing my resume to the hiring manager? I'm happy to send my resume and a 3-line summary to make it easy. If that's not something you do, no worries at all; any advice on what the team looks for would help a lot.";
  }
  let opener: string;
  if (c.relation === "connection") {
    // Already in the network: no invite, a warmer opener.
    note = "";
    opener = `Hi ${first}, hope you're doing well! I saw you're at ${co} now.`;
  } else opener = `Thanks for connecting, ${first}! ${me.opener}`;

  const message = `${opener} ${ctx} ${area.fact}\n\n${ask}\n\nThanks either way!`;
  const followup = `${hi}, just bumping this in case it got buried. No pressure either way, and thanks for your time!`;
  const packet = [
    `Thank you so much, ${first}! Here's everything in one place:`,
    `- Role: ${title || `${co} ${interest}`}${link}`,
    ...(area.resume ? [`- Resume: attached (${area.resume})`] : []),
    `- Summary: ${[me.about, area.fact].filter(Boolean).join(" ")}`,
  ].join("\n");
  const thanks = `Thank you for the referral, ${first}! I really appreciate it, and I'll let you know how it goes.`;
  const signature = ["Thanks,", sign.name, sign.linkedin].filter(Boolean).join("\n");
  const email = c.email
    ? {
        subject: c.job ? `${me.short} interested in ${role}` : `${me.short} interested in ${possessive(co)} ${interest}`,
        body: `Hi ${first},\n\n${me.opener} ${ctx}\n\n${area.fact}\n\n${ask}\n\n${signature}`,
      }
    : null;
  return { note, message, followup, email, packet, thanks };
}
