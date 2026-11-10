#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { scoreJob } from "../src/ats-job";
import { PLATFORMS, scoreResume, type AtsReport } from "../src/ats-score";
import { getJob, jobsInStatuses, jobsWithResume, type Job } from "../src/db";
import { SENT, wasSent } from "../src/status";

interface Options {
  jobs: number[];
  submitted: boolean;
  all: boolean;
  pdf: string | null;
  url: string | null;
  title: string;
  descriptionFile: string | null;
  json: boolean;
  min: number | null;
  limit: number | null;
  verbose: boolean;
}

interface Row {
  jobId: number | null;
  company: string;
  title: string;
  url: string;
  report: AtsReport;
}

const USAGE = `usage: bun run ats (--job <id>... | --submitted | --all | --pdf <path> --url <posting url> [--title <t>] [--description-file <path>])
       [--json] [--min <n>] [--limit <n>] [--verbose]`;

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

function number(flag: string, value: string | undefined) {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) die(`${flag} needs a number\n${USAGE}`);
  return n;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    jobs: [],
    submitted: false,
    all: false,
    pdf: null,
    url: null,
    title: "",
    descriptionFile: null,
    json: false,
    min: null,
    limit: null,
    verbose: false,
  };
  const value = (i: number, flag: string) => argv[i + 1] ?? die(`${flag} needs a value\n${USAGE}`);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--job") o.jobs.push(number(a, argv[++i]));
    else if (a === "--submitted") o.submitted = true;
    else if (a === "--all") o.all = true;
    else if (a === "--pdf") o.pdf = value(i++, a);
    else if (a === "--url") o.url = value(i++, a);
    else if (a === "--title") o.title = value(i++, a);
    else if (a === "--description-file") o.descriptionFile = value(i++, a);
    else if (a === "--json") o.json = true;
    else if (a === "--min") o.min = number(a, argv[++i]);
    else if (a === "--limit") o.limit = number(a, argv[++i]);
    else if (a === "--verbose") o.verbose = true;
    else die(`unknown argument ${a}\n${USAGE}`);
  }
  const modes = [o.jobs.length > 0, o.submitted, o.all, o.pdf !== null].filter(Boolean).length;
  if (modes !== 1) die(`choose exactly one of --job, --submitted, --all, --pdf\n${USAGE}`);
  if (o.pdf !== null && o.url === null) die(`--pdf needs --url\n${USAGE}`);
  return o;
}

function selectJobs(o: Options): Job[] {
  if (o.jobs.length > 0) {
    return o.jobs.map(id => getJob(id) ?? die(`no job ${id}`));
  }
  if (o.submitted) return jobsInStatuses(SENT).concat(jobsWithResume().filter(j => !SENT.includes(j.status) && wasSent(j)));
  return jobsWithResume();
}

const pct = (n: number) => String(Math.round(n * 100)).padStart(3);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function line(r: Row) {
  const { report } = r;
  const id = r.jobId === null ? "pdf" : String(r.jobId);
  const match = report.match ? pct(report.match.score) : "  -";
  return `${id.padStart(5)}  ${r.company.slice(0, 24).padEnd(24)}  ${report.platform.platform.padEnd(15)}  ${String(report.overall).padStart(3)}  parse ${pct(report.parse.score)}  match ${match}  ${report.verdict}`;
}

function detail(r: Row) {
  const out: string[] = [`      ${r.title}  ${r.url}`, `      ${r.report.platform.label} (${r.report.platform.tier}); pages ${r.report.pages ?? "?"}`];
  for (const d of r.report.parse.dimensions) {
    out.push(`      ${d.id.padEnd(13)} ${pct(d.score)}  w${d.weight.toFixed(2)}${d.findings.length ? `  ${d.findings.join("; ")}` : ""}`);
  }
  const m = r.report.match;
  if (m) {
    const missing = m.keywords.filter(k => !k.found).map(k => `${k.term}(${k.kind})`);
    out.push(`      title match ${pct(m.titleMatch)}; missing: ${missing.length ? missing.join(", ") : "none"}`);
  }
  return out;
}

function weakestDimension(r: AtsReport) {
  const failing = r.parse.dimensions.filter(d => d.score < 0.8);
  if (failing.length === 0) return null;
  return failing.reduce((a, b) => (b.score * b.weight < a.score * a.weight ? b : a)).id;
}

function coverage(rows: Row[]) {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const p = r.report.platform.platform;
    by.set(p, [...(by.get(p) ?? []), r]);
  }
  console.log("\nCOVERAGE by platform");
  console.log("platform         jobs  overall  parse  match  fail warn pass  top failing dimension");
  for (const [p, group] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const rs = group.map(r => r.report);
    const matches = rs.flatMap(r => (r.match ? [r.match.score] : []));
    const dims = new Map<string, number>();
    for (const r of rs) {
      const d = weakestDimension(r);
      if (d) dims.set(d, (dims.get(d) ?? 0) + 1);
    }
    const top = [...dims.entries()].sort((a, b) => b[1] - a[1])[0];
    const count = (v: string) => rs.filter(r => r.verdict === v).length;
    console.log(
      `${p.padEnd(15)}  ${String(rs.length).padStart(4)}  ${mean(rs.map(r => r.overall))
        .toFixed(1)
        .padStart(
          7,
        )}  ${pct(mean(rs.map(r => r.parse.score)))}  ${matches.length ? pct(mean(matches)) : "  -"}  ${String(count("fail")).padStart(4)} ${String(count("warn")).padStart(4)} ${String(count("pass")).padStart(4)}  ${top ? `${top[0]} (${top[1]})` : "-"}`,
    );
  }
  const empty = PLATFORMS.filter(p => p !== "unknown" && !by.has(p));
  console.log(`\nplatforms with no jobs: ${empty.length ? empty.join(", ") : "none"}`);
  const unknown = by.get("unknown") ?? [];
  console.log(`jobs on unknown platforms: ${unknown.length}`);
  if (unknown.length) {
    const hosts = new Map<string, number>();
    for (const r of unknown) hosts.set(host(r.url), (hosts.get(host(r.url)) ?? 0) + 1);
    const top = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`top unknown hosts: ${top.map(([h, n]) => `${h} (${n})`).join(", ")}`);
  }
}

const o = parseArgs(process.argv.slice(2));
const rows: Row[] = [];
const errors: string[] = [];
let noResume = 0;

if (o.pdf !== null) {
  const description = o.descriptionFile ? readFileSync(o.descriptionFile, "utf8") : null;
  const url = o.url ?? die(USAGE);
  try {
    rows.push({ jobId: null, company: host(url), title: o.title, url, report: scoreResume({ pdf: o.pdf, posting: { url, title: o.title, description } }) });
  } catch (e) {
    errors.push(`${o.pdf}: ${e instanceof Error ? e.message : String(e)}`);
  }
} else {
  let jobs = selectJobs(o);
  if (o.limit !== null) jobs = jobs.slice(0, o.limit);
  for (const job of jobs) {
    try {
      const r = scoreJob(job);
      if (r) rows.push({ jobId: job.id, company: job.company, title: job.title, url: job.url, report: r });
      else noResume++;
    } catch (e) {
      errors.push(`job ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

if (o.json) {
  console.log(
    JSON.stringify(
      rows.map(r => ({
        jobId: r.jobId,
        company: r.company,
        title: r.title,
        url: r.url,
        platform: r.report.platform.platform,
        overall: r.report.overall,
        verdict: r.report.verdict,
        parse: r.report.parse,
        match: r.report.match,
      })),
      null,
      2,
    ),
  );
} else {
  for (const r of rows) {
    console.log(line(r));
    if (o.verbose) for (const l of detail(r)) console.log(l);
  }
  if (rows.length > 1) coverage(rows);
  if (noResume) console.log(`\nno resume: ${noResume}`);
}
for (const e of errors) console.error(`error: ${e}`);

const min = o.min;
const below = min !== null && rows.some(r => r.report.overall < min);
if (below) console.error(`some reports scored below ${o.min}`);
process.exit(errors.length > 0 || below ? 1 : 0);
