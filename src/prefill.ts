// Prefill: fills the plain fields of an application form before the fill agent reads it, so the agent
// spends its turns only on what needs judgment. An omp fill agent imports this module into its own
// JavaScript session and calls `prefill(tab, factsPath)` with its browser tab (prompts/browser-omp.md);
// for a Claude Code one, which has no such session, the app runs it over CDP (src/cdp-tab.ts) when the
// agent calls the `prefill` host tool.
//
// It fills only what the candidate details settle with no judgment: name, contact, address, links,
// current job, school, the resume upload, and the plain eligibility, EEO, referral, source and text
// consent questions whose answers profile/personal.yml gives under `prefill:`. Anything else, and any
// field already holding something else, is left and listed for the agent. It works the page the way
// the agent is told to: one field at a time, top to bottom, clicking and then typing, with every
// input paced by the browser's proxy like the agent's own.
//
// Runs inside omp's JavaScript session as well as the app: it must import nothing from the app.
import { readFileSync } from "node:fs";

// The part of omp's browser tab this uses (src/cdp-tab.ts gives the same).
export interface Tab {
  evaluate(code: string): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  select(selector: string, ...values: string[]): Promise<unknown>;
  uploadFile(selector: string, ...paths: string[]): Promise<unknown>;
  press(key: string): Promise<unknown>;
  wheel(dx: number, dy: number): Promise<unknown>;
}

export type YesNo = "yes" | "no";
// What fill.ts writes for the script (buildFacts): the candidate details, flattened.
export interface Facts {
  resume: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  preferred_name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string; // as given: an abbreviation or a name
  postal_code: string;
  country: string;
  linkedin: string;
  website: string;
  current_company: string;
  current_title: string;
  school: string;
  degree: string;
  field: string;
  answers: {
    work_authorized?: YesNo;
    sponsorship?: YesNo;
    adult?: YesNo;
    previously_employed?: YesNo;
    referred?: YesNo;
    relocate?: YesNo;
    hispanic?: YesNo;
    eeo?: "decline";
    gender_if_required?: string; // when a required gender question offers no way to decline
    sms_consent?: YesNo;
    how_heard?: string[]; // options to prefer, in order
  };
}

// A form control as the scan reports it. Radio and checkbox groups are one field with options.
export interface Field {
  id: string;
  kind: "text" | "textarea" | "select" | "combobox" | "radio" | "checkbox" | "file";
  question: string;
  required: boolean;
  value?: string;
  options?: { tag?: string; value?: string; text: string; checked?: boolean; label?: boolean }[];
}

// What to put in a field: text to type, an option to pick (the first pattern any option matches,
// typing `search` first in a combobox that needs it), or a file to upload.
export type Plan = { text: string } | { choose: RegExp[]; search?: string; avoid?: RegExp } | { upload: string };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const words = (s: string) => clean(s).toLowerCase();
const exact = (s: string) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
const YES = [/^\s*yes\b/i];
const NO = [/^\s*no\b/i];
const yesNo = (a: YesNo) => ({ choose: a === "yes" ? YES : NO });
const DECLINE = /decline|prefer not|not (wish|want) to|don.?t wish|do not wish|choose not|not to (answer|disclose|say|specify|self.identify)|rather not/i;

const STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};
const stateNames = (state: string) => {
  const abbr = Object.keys(STATES).find(k => k === state.toUpperCase() || STATES[k]?.toLowerCase() === state.toLowerCase());
  return abbr ? { abbr, name: STATES[abbr] ?? state } : { abbr: state, name: state };
};

// Questions about someone other than the candidate, or about the past, which the facts do not answer.
const NOT_THE_CANDIDATE =
  /reference|emergency|referr|supervisor|manager|spouse|relative|parent|guardian|previous|former|prior|other than|outside|additional|secondary|alternate|confirm|\bif\b|explain|describe|why/i;

// The plain fact a text, select or combobox field asks for: the text to type, and for a list, the
// options that say the same (the text itself, if none are given) and what to type to find them.
interface Fact {
  text: string;
  choose?: RegExp[];
  search?: string;
}
function factOf(q: string, f: Facts): Fact | null {
  const { abbr, name } = stateNames(f.state);
  const text = (v: string, more: Omit<Fact, "text"> = {}) => (v ? { text: v, ...more } : null);
  if (/preferred (first )?name|nickname/.test(q)) return text(f.preferred_name);
  if (/^(legal )?first name|^given name|^first$/.test(q)) return text(f.first_name);
  if (/^(legal )?middle( name)?$/.test(q)) return text(f.middle_name);
  if (/^middle initial$/.test(q)) return text(f.middle_name.slice(0, 1));
  if (/^(legal )?last name|^surname|^family name|^last$/.test(q)) return text(f.last_name);
  if (/^(full |legal |your )?(full )?name$/.test(q)) return text(`${f.first_name} ${f.last_name}`);
  if (/^e-?mail( address)?$|^your e-?mail/.test(q)) return text(f.email);
  if (/^(phone|mobile|cell)( phone)?( number)?$|^(primary |mobile |cell )?phone( number)?$/.test(q)) return text(f.phone);
  if (/^(street )?address( line)?( 1)?$|^street( address)?$/.test(q)) return text(f.street);
  if (/^city$|^current city$|^city of residence$/.test(q)) return text(f.city);
  if (/^state( or province)?$|^state\/province$|^province$|^state of residence$|^what state do you (currently )?live in\??$/.test(q))
    return text(abbr, { choose: [exact(name), exact(abbr)], search: name });
  if (/^(zip|postal)( ?code)?$|^zip\/postal code$/.test(q)) return text(f.postal_code);
  if (/^country( of residence)?$/.test(q))
    return text(f.country, { choose: [exact(f.country), /^united states( of america)?$/i, /^usa?$/i, /^united states\b/i], search: f.country });
  if (/^(current )?location$|^where are you (currently )?(located|based)$|^city,? state$/.test(q))
    return text(`${f.city}, ${abbr}`, { choose: [new RegExp(`^${f.city},? (${abbr}|${name})\\b`, "i"), new RegExp(`^${f.city}\\b`, "i")], search: f.city });
  if (q.includes("linkedin") && !/github|website|portfolio/.test(q)) return text(f.linkedin);
  if (/^(personal )?(website|portfolio)( url| link)?$/.test(q)) return text(f.website);
  if (/^(current |most recent )?(company|employer)( name)?$/.test(q)) return text(f.current_company);
  if (/^(current |most recent )?(job )?title$|^current (role|position)$/.test(q)) return text(f.current_title);
  if (/^(school|university|college|institution)( name)?$/.test(q)) return text(f.school);
  if (/^degree( type)?$|^(what is your )?highest (level of )?(completed )?(education|degree)( completed)?\??$/.test(q))
    return text(f.degree, { choose: [exact(f.degree), /bachelor/i] });
  if (/^(discipline|major|field of study|area of study)$/.test(q)) return text(f.field);
  return null;
}

// The plain yes/no, EEO and source questions answered under `prefill:` in profile/personal.yml.
function answerPlan(q: string, field: Field, a: Facts["answers"]): Plan | null {
  if (/\b(gender|sex)\b/.test(q) && !q.includes("orientation")) {
    // A closed combobox shows no options yet: declining is tried first, the required fallback after.
    const unseen = !field.options?.length;
    const decline = a.eeo === "decline" && (unseen || field.options?.some(o => DECLINE.test(o.text))) ? [DECLINE] : [];
    const g = a.gender_if_required;
    const fallback = field.required && g ? [exact(g), new RegExp(`^${g === "Male" ? "man" : "woman"}$`, "i")] : [];
    return decline.length || fallback.length ? { choose: [...decline, ...fallback] } : null;
  }
  if (/hispanic|latin[oa]/.test(q) && a.hispanic) return { choose: a.hispanic === "no" ? [/^\s*no\b/i, /not hispanic/i] : YES };
  if (/\brace\b|ethnic|veteran|disabilit|sexual orientation|transgender/.test(q)) return a.eeo === "decline" ? { choose: [DECLINE] } : null;
  // Consent to texts is often a pair of options under the phone number, with no question of its own.
  const sms = /text messag|\bsms\b/;
  if ((sms.test(q) || (field.options?.length && field.options.every(o => sms.test(o.text.toLowerCase())))) && a.sms_consent)
    return a.sms_consent === "yes" ? { choose: [...YES, /\b(i )?(consent|agree|opt.?in)\b/i], avoid: /\b(not|don.?t|no)\b/i } : { choose: NO };
  if (/how did you (hear|find|learn)|where did you (hear|find|learn)/.test(q) && a.how_heard?.length)
    return { choose: a.how_heard.map(h => new RegExp(`^\\s*${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")), search: a.how_heard[0] ?? "" };
  if (NOT_THE_CANDIDATE.test(q.replace(/\b(currently|now) or in the future\b/, ""))) return null;
  if (/(require|need)\b.{0,40}sponsor/.test(q) && !/\b(not|unable|cannot|won.?t|does not|do not)\b.{0,30}(provide|offer|sponsor)/.test(q))
    return a.sponsorship ? yesNo(a.sponsorship) : null;
  if (
    /(legally )?(authori[sz]ed|eligible|permitted) to work (in|for an employer in) the (united states|u\.?s\.?a?\b)|legally authori[sz]ed to work in the united states/.test(
      q,
    )
  )
    return a.work_authorized ? yesNo(a.work_authorized) : null;
  if (/(at least|over) (the age of )?18|18 years (of age )?or older/.test(q)) return a.adult ? yesNo(a.adult) : null;
  if (/^(have you|did you) (ever )?(previously )?(been )?(work(ed)?|employed) (for|by|at)\b/.test(q))
    return a.previously_employed ? yesNo(a.previously_employed) : null;
  if (/^were you referred|^did (a|an) .{0,20}employee refer|^(were you|have you been) referred by/.test(q)) return a.referred ? yesNo(a.referred) : null;
  if (/willing to relocate|open to relocat/.test(q)) return a.relocate ? yesNo(a.relocate) : null;
  return null;
}

// What the facts say to put in a field, or null when it is one for the agent.
export function decide(field: Field, facts: Facts): Plan | null {
  const q = words(field.question)
    .replace(/\s*[*✱]\s*$/, "")
    .replace(/\s*\(optional\)$/, "");
  if (field.kind === "file") return /resume|\bcv\b|curriculum/.test(q) && !q.includes("cover") ? { upload: facts.resume } : null;
  const choice = field.kind === "radio" || field.kind === "select" || field.kind === "combobox";
  const answer = choice ? answerPlan(q, field, facts.answers) : null;
  if (answer) return answer;
  if (field.kind === "radio" || field.kind === "checkbox") return null;
  const fact = NOT_THE_CANDIDATE.test(q) ? null : factOf(q, facts);
  if (!fact) return null;
  return choice ? { choose: fact.choose ?? [exact(fact.text)], search: fact.search ?? fact.text } : { text: fact.text };
}

// The first option, in the order of the patterns, that a plan picks.
export function pick<T extends { text: string }>(options: T[], plan: { choose: RegExp[]; avoid?: RegExp }): T | null {
  for (const pattern of plan.choose) {
    const hit = options.find(o => pattern.test(o.text) && !plan.avoid?.test(o.text));
    if (hit) return hit;
  }
  return null;
}

// Whether a field already holds what the plan would put there.
export function holds(value: string, plan: Plan): boolean {
  if ("text" in plan) {
    const digits = (s: string) => s.replace(/\D/g, "");
    if (digits(plan.text).length >= 10) return digits(value).endsWith(digits(plan.text).slice(-10));
    return words(value).replace(/[^a-z0-9@.]/g, "") === words(plan.text).replace(/[^a-z0-9@.]/g, "");
  }
  if ("choose" in plan) return !!pick([{ text: value }], plan);
  return false;
}

// Reads every visible form control on the page, top to bottom, and tags each with data-prefill so it
// can be addressed by selector. Runs in the page.
const SCAN = String.raw`(() => {
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const shown = el => el.type === "file" || !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const byId = id => { const n = id && document.getElementById(id); return n ? clean(n.innerText || n.textContent) : ""; };
  const labelled = el => clean((el.getAttribute("aria-labelledby") || "").split(/\s+/).map(byId).join(" "));
  const own = el => clean(el.labels && el.labels[0] && el.labels[0].innerText) || labelled(el) || clean(el.getAttribute("aria-label"));
  const marked = el => /required/i.test(String(el && el.className || ""));
  const title = el => {
    const box = el.closest("fieldset, [role=radiogroup], [role=group]");
    if (!box) return { text: "", required: false };
    const head = box.querySelector("legend, .ashby-application-form-question-title, label:not([for])");
    return { text: clean(head && head.innerText) || labelled(box) || clean(box.getAttribute("aria-label")), required: marked(head) || box.getAttribute("aria-required") === "true" };
  };
  const nearby = el => {
    const box = el.closest("[class*=field], [class*=Field], [class*=question], [class*=Question], .form-group, li");
    const head = box && box.querySelector("label, legend, [class*=label]");
    return clean(head && head.innerText);
  };
  const fields = [], groups = new Map();
  let n = 0;
  for (const el of document.querySelectorAll("input, textarea, select")) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "password"].includes(type) || el.disabled || !shown(el)) continue;
    if (el.closest("[class*=iti__country], [class*=iti__dropdown], .g-recaptcha, [class*=captcha]") || /captcha/i.test(el.name || "")) continue;
    // Stand-ins a widget keeps for the browser's own validation, out of reach of a person. (Radio
    // buttons and checkboxes are often drawn over an invisible input, so those stay.)
    if (!["file", "radio", "checkbox"].includes(type) && (el.tabIndex < 0 || el.getAttribute("aria-hidden") === "true" || getComputedStyle(el).opacity === "0")) continue;
    if (type === "radio" || type === "checkbox") {
      // One question: the box around the options, else their shared name (forms reuse names like "Agree").
      const key = el.closest("fieldset, [role=radiogroup], [role=group]") || type + ":" + (el.name || el.id);
      let g = groups.get(key);
      if (!g) {
        const t = title(el);
        g = { id: String(++n), kind: type, question: t.text || nearby(el), required: t.required, options: [] };
        groups.set(key, g);
        fields.push(g);
      }
      const tag = g.id + "." + g.options.length;
      el.setAttribute("data-prefill", tag);
      const label = el.labels && el.labels[0];
      if (label) label.setAttribute("data-prefill-label", tag);
      g.options.push({ tag, text: own(el) || clean(el.value), checked: el.checked, label: !!label });
      g.required = g.required || el.required || el.getAttribute("aria-required") === "true";
      continue;
    }
    const id = String(++n);
    el.setAttribute("data-prefill", id);
    const kind = el.tagName === "SELECT" ? "select" : el.getAttribute("role") === "combobox" ? "combobox" : type === "file" ? "file" : el.tagName === "TEXTAREA" ? "textarea" : "text";
    const question = kind === "file" ? clean([own(el), el.name, el.id, nearby(el)].join(" ")) : own(el) || clean(el.getAttribute("placeholder")) || nearby(el);
    const f = { id, kind, question, required: el.required || el.getAttribute("aria-required") === "true" || /[*✱]\s*$/.test(question) || marked(el.labels && el.labels[0]) };
    if (kind === "select") {
      f.options = [...el.options].filter(o => o.value).map(o => ({ value: o.value, text: clean(o.text) }));
      f.value = el.selectedIndex > 0 ? clean(el.options[el.selectedIndex].text) : "";
    } else if (kind === "combobox") {
      const control = el.closest("[class*=control], [class*=Control]");
      const shownValue = control && control.querySelector("[class*=single-value], [class*=singleValue]");
      f.value = clean(shownValue && shownValue.innerText) || el.value;
    } else if (kind === "file") f.value = el.files && el.files.length ? el.files[0].name : "";
    else f.value = el.value;
    fields.push(f);
  }
  for (const g of groups.values()) g.required = g.required || /[*✱]\s*$/.test(g.question);
  return fields;
})()`;

// The options a combobox shows once opened, each tagged so it can be clicked. Runs in the page.
const comboOptions = (id: string) => String.raw`(() => {
  const el = document.querySelector('[data-prefill="${id}"]');
  const list = el && (document.getElementById(el.getAttribute("aria-controls") || "") || document.getElementById(el.getAttribute("aria-owns") || ""));
  const options = list ? [...list.querySelectorAll("[role=option]")] : [];
  return options.map((o, i) => { o.setAttribute("data-prefill-option", "${id}." + i); return { tag: "${id}." + i, text: (o.innerText || "").replace(/\s+/g, " ").trim() }; });
})()`;

const sel = (tag: string) => `[data-prefill="${tag}"]`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const short = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface Report {
  filled: string[];
  left: { question: string; kind: Field["kind"]; required: boolean; value?: string; options?: string[]; why: string }[];
  more: boolean;
  note?: string;
}

// Pages already scrolled through once, so a second call on the same page does not do it again.
const looked = new Set<string>();

// The report as the agent reads it: short lines, since omp cuts long console lines, required fields first.
export function reportText(r: Report): string {
  const lines = [`filled ${r.filled.length}: ${r.filled.join("; ") || "nothing"}`];
  const left = [...r.left].sort((a, b) => Number(b.required) - Number(a.required));
  lines.push(left.length ? `left ${left.length} (* = required):` : "left: nothing");
  for (const f of left) {
    lines.push(`${f.required ? "*" : " "} [${f.kind}] ${f.question}${f.value ? ` = "${f.value}"` : ""} — ${f.why}`);
    if (f.options) lines.push(`    options: ${f.options.join(" | ")}`);
  }
  lines.push(r.more ? "more: true — run prefill again to carry on" : "more: false");
  if (r.note) lines.push(`note: ${r.note}`);
  return lines.map(l => short(l, 700)).join("\n");
}

/**
 * Fills the plain fields of the form on the tab's current page and reports, as text, what it filled and
 * what it left. Stops starting new fields after `budgetMs`; it then reports `more: true`, and calling
 * it again carries on, skipping what is done.
 */
export async function prefill(tab: Tab, factsPath: string, opts: { budgetMs?: number; looked?: Set<string> } = {}): Promise<string> {
  return reportText(await prefillForm(tab, factsPath, opts.budgetMs ?? 100_000, opts.looked ?? looked));
}

// `looked`: pages already scrolled through by this worker. omp's session holds this module for one worker; the app passes one set per worker.
async function prefillForm(tab: Tab, factsPath: string, budgetMs: number, looked: Set<string>): Promise<Report> {
  const facts = JSON.parse(readFileSync(factsPath, "utf8")) as Facts;
  const until = Date.now() + budgetMs;
  const url = String(await tab.evaluate("location.href"));
  if (!looked.has(url)) {
    looked.add(url);
    await sleep(2500);
    for (const dy of [600, 600, 600, -1800]) {
      await tab.wheel(0, dy);
      await sleep(700);
    }
  }
  const scan = async () => (await tab.evaluate(SCAN)) as Field[];
  let fields = await scan();
  if (!fields.length)
    return { filled: [], left: [], more: false, note: "no form fields on this page (is the form inside a frame, or behind an Apply button?)" };
  const filled = new Map<string, { line: string; plan: Plan }>(); // by field key: "question: value"
  // Fields by kind, question and place among those alike: scans renumber them, and answers reveal more.
  const keyOf = () => {
    const seen = new Map<string, number>();
    return (f: Field) => {
      const base = `${f.kind}|${f.question}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return `${base}|${n}`;
    };
  };
  const left = new Map<string, Report["left"][number]>();
  const leave = (key: string, f: Field, why: string) =>
    left.set(key, {
      question: short(f.question || "(no label)"),
      kind: f.kind,
      required: f.required,
      ...(f.value ? { value: short(f.value, 60) } : {}),
      ...(f.options?.length ? { options: f.options.slice(0, 8).map(o => short(o.text, 50)) } : {}),
      why,
    });

  // The resume first: Greenhouse and Ashby read it and fill the form again, which can redraw it.
  const resume = fields.find(f => f.kind === "file" && !f.value && decide(f, facts));
  if (resume) {
    await tab.uploadFile(sel(resume.id), facts.resume);
    filled.set("resume", { line: short(resume.question || "resume"), plan: { upload: facts.resume } });
    await sleep(4000);
    fields = await scan();
  }

  // Answers can reveal further questions (race after "not Hispanic"), so a pass that filled anything
  // is followed by another over what the page shows then.
  const handled = new Set<string>();
  let more = false;
  for (let pass = 0; pass < 3; pass++) {
    const before = filled.size;
    const key = keyOf();
    for (const f of fields) {
      const k = key(f);
      if (handled.has(k)) continue;
      handled.add(k);
      if (f.kind === "file") {
        if (!f.value && !decide(f, facts)) leave(k, f, "an upload other than the resume");
        continue;
      }
      const plan = decide(f, facts);
      if (!plan || "upload" in plan) {
        const answered = f.value || f.options?.some(o => o.checked);
        if (!answered) leave(k, f, "not settled by the candidate details");
        continue;
      }
      const current = f.kind === "radio" ? (f.options?.find(o => o.checked)?.text ?? "") : (f.value ?? "");
      // A site that read the resume may have typed something else into a plain text field: the
      // candidate details win there. A choice it made is left for the agent to judge.
      const replace = !!current && !holds(current, plan);
      if (current && (!replace || !("text" in plan))) {
        if (replace) leave(k, f, "already holds something else; check it");
        continue;
      }
      if (Date.now() > until) {
        more = true;
        leave(k, f, "not reached yet: run prefill again");
        continue;
      }
      try {
        const done = await fillField(tab, f, plan, replace);
        if (done) filled.set(k, { line: `${short(f.question, 60)}: ${short(done, 40)}${replace ? ` (was "${short(current, 30)}")` : ""}`, plan });
        else leave(k, f, "no option matched the candidate details");
      } catch (err) {
        leave(k, f, `could not fill (${short(err instanceof Error ? err.message : String(err), 80)})`);
      }
    }
    if (filled.size === before || more) break;
    await sleep(800);
    fields = await scan();
  }
  // What it entered, read back once the page has settled: some fields clear what was typed unless one
  // of their suggestions is picked, and some widgets drop a click.
  await sleep(800);
  const key = keyOf();
  for (const f of await scan()) {
    const k = key(f),
      entry = filled.get(k);
    if (!entry || "upload" in entry.plan) continue;
    const now = f.kind === "radio" ? (f.options?.find(o => o.checked)?.text ?? "") : (f.value ?? "");
    if (holds(now, entry.plan)) continue;
    filled.delete(k);
    leave(k, f, "did not stick: the site cleared or changed it (it may want one of its suggestions picked)");
  }
  return { filled: [...filled.values()].map(e => e.line), left: [...left.values()], more };
}

// Puts the plan into one field. Returns what it entered, or null when no option matched.
async function fillField(tab: Tab, f: Field, plan: Plan, replace = false): Promise<string | null> {
  if ("upload" in plan) return null;
  if ("text" in plan) {
    await tab.click(sel(f.id));
    if (replace) await tab.press("Control+A");
    await tab.type(sel(f.id), plan.text);
    return plan.text;
  }
  if (f.kind === "select") {
    const option = pick(f.options ?? [], plan);
    if (!option?.value) return null;
    await tab.click(sel(f.id));
    await tab.select(sel(f.id), option.value);
    return option.text;
  }
  if (f.kind === "radio" || f.kind === "checkbox") {
    const option = pick(f.options ?? [], plan);
    if (!option?.tag) return null;
    await tab.click(option.label ? `[data-prefill-label="${option.tag}"]` : sel(option.tag));
    return option.text;
  }
  // A combobox: open it, type to narrow it when the option is not listed, and click the option.
  await tab.click(sel(f.id));
  await sleep(500);
  let options = (await tab.evaluate(comboOptions(f.id))) as { tag: string; text: string }[];
  let option = pick(options, plan);
  if (!option && plan.search) {
    await tab.type(sel(f.id), plan.search);
    await sleep(1200);
    options = (await tab.evaluate(comboOptions(f.id))) as { tag: string; text: string }[];
    option = pick(options, plan);
  }
  if (!option) {
    await tab.press("Escape");
    return null;
  }
  await tab.click(`[data-prefill-option="${option.tag}"]`);
  return option.text;
}

// The facts file's content, from profile/personal.yml as parsed, the application mailbox and the resume.
export function buildFacts(personal: Record<string, unknown>, mailbox: string, resume: string): Facts {
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const address = obj(personal["address"]),
    links = obj(personal["links"]),
    raw = obj(personal["prefill"]);
  const school = obj(Array.isArray(personal["education"]) ? personal["education"][0] : null);
  const yn = (v: unknown): YesNo | undefined => (v === true || /^yes$/i.test(str(v)) ? "yes" : v === false || /^no$/i.test(str(v)) ? "no" : undefined);
  const answers: Facts["answers"] = {};
  for (const key of ["work_authorized", "sponsorship", "adult", "previously_employed", "referred", "relocate", "hispanic", "sms_consent"] as const) {
    const v = yn(raw[key]);
    if (v) answers[key] = v;
  }
  if (/^decline$/i.test(str(raw["eeo"]))) answers.eeo = "decline";
  if (str(raw["gender_if_required"])) answers.gender_if_required = str(raw["gender_if_required"]);
  if (Array.isArray(raw["how_heard"])) answers.how_heard = raw["how_heard"].map(str).filter(Boolean);
  return {
    resume,
    first_name: str(personal["first_name"]),
    middle_name: str(personal["middle_name"]),
    last_name: str(personal["last_name"]),
    preferred_name: str(personal["preferred_name"]),
    email: mailbox,
    phone: str(personal["phone"]),
    street: str(address["street"]),
    city: str(address["city"]),
    state: str(address["state"]),
    postal_code: str(address["postal_code"]),
    country: str(address["country"]),
    linkedin: str(links["linkedin"]),
    website: str(links["website"]),
    current_company: str(personal["current_company"]),
    current_title: str(personal["current_title"]),
    school: str(school["school"]),
    degree: str(school["degree"]),
    field: str(school["field"]),
    answers,
  };
}
