import type { AtsReport, Dimension, Keyword } from "../../../src/api-types";
import { Disclosure, Section, Skeleton, Subhead, Tooltip } from "../../components/ui";
import { ApiError, useAtsReport } from "../../lib/api";
import { cn } from "../../lib/cn";

const VERDICT = {
  pass: { text: "text-success-text", label: "Passes" },
  warn: { text: "text-warning-text", label: "Needs work" },
  fail: { text: "text-danger-text", label: "Likely to fail" },
} as const;

const TIER = {
  "parse-and-prefill": "parses the resume to prefill the application, so clean parsing counts more",
  "search-and-review": "recruiters search and review applications, so keywords count more",
  unknown: "default weights",
} as const;

const pct = (x: number) => Math.round(x * 100);
const tone = (x: number) => (x >= 0.8 ? "text-fg" : x >= 0.6 ? VERDICT.warn.text : VERDICT.fail.text);
const terms = (ks: Keyword[]) => ks.map(k => k.term).join(", ");
const byWeight = (a: Keyword, b: Keyword) => b.weight - a.weight;

function reason(r: AtsReport, failing: Dimension[]) {
  const issues = failing.length ? `Parse issues in ${failing.map(d => d.label.toLowerCase()).join(", ")}` : "";
  if (!r.match) return `${issues || "Parses cleanly"}; the posting has no description to match keywords against.`;
  const all = r.match.keywords;
  const found = all.filter(k => k.found).length;
  const required = all.filter(k => k.kind === "required");
  const allRequired = required.length > 0 && required.every(k => k.found) ? `, including all ${required.length} required` : "";
  const coverage = `has ${found} of the posting's ${all.length} keywords${allRequired}`;
  const lead = issues ? `${issues}. The resume ${coverage}` : `Parses cleanly ${found < 0.8 * all.length ? "but" : "and"} ${coverage}`;
  const title = r.match.titleMatch < 1 ? ` It shares ${pct(r.match.titleMatch)}% of the posting title's words.` : "";
  return `${lead}.${title}`;
}

function Failing({ d, frozen }: { d: Dimension; frozen: boolean }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-baseline gap-3 text-sm">
        <span className="text-fg">{d.label}</span>
        <span className={cn("tabular font-medium", frozen ? "text-fg" : tone(d.score))}>{pct(d.score)}</span>
      </span>
      {d.findings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted marker:text-fg-subtle">
          {d.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Terms({ title, items, total, className }: { title: string; items: Keyword[]; total?: number; className?: string }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {total === undefined ? (
        <Subhead count={items.length}>{title}</Subhead>
      ) : (
        <Subhead>
          {title}
          <span className="tabular ml-1.5 font-normal text-fg-subtle">
            {items.length} of {total}
          </span>
        </Subhead>
      )}
      <p className={cn("text-sm", className)}>{terms(items)}</p>
    </div>
  );
}

function Report({ r, frozen }: { r: AtsReport; frozen: boolean }) {
  const v = VERDICT[r.verdict];
  const failing = r.parse.dimensions.filter(d => d.score < 1 || d.findings.length > 0).sort((a, b) => a.score - b.score);
  const passed = r.parse.dimensions.filter(d => !failing.includes(d));
  const keywords = [...(r.match?.keywords ?? [])].sort(byWeight);
  const missing = keywords.filter(k => !k.found);
  const found = keywords.filter(k => k.found);
  const quiet = frozen && r.verdict !== "pass";
  const notes = r.platform.tier === "unknown" ? r.platform.notes.filter(n => !n.includes("default weights")) : r.platform.notes;
  const parsed = passed.length > 0 && (
    <Disclosure summary={failing.length ? `${passed.length} more parse checks pass` : `Parses cleanly on all ${passed.length} checks`}>
      <p className="text-fg">{passed.map(d => d.label).join(", ")}</p>
    </Disclosure>
  );
  const platform = (
    <p tabIndex={notes.length ? 0 : undefined} className="w-fit text-sm text-fg-muted">
      {r.platform.tier === "unknown" ? (
        <>Platform not recognised, so default weights are used.</>
      ) : (
        <>
          Scored for <span className="text-fg">{r.platform.label}</span>: {TIER[r.platform.tier]}.
        </>
      )}
    </p>
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <Tooltip content="Passes at 80, needs work from 60; fails if the text can't be extracted">
            <span tabIndex={0} className={cn("tabular text-xl font-semibold", quiet ? "text-fg" : v.text)}>
              {r.overall}
            </span>
          </Tooltip>
          <span className={cn("text-sm font-medium", quiet ? "text-fg-muted" : v.text)}>{v.label}</span>
        </div>
        <p className="text-sm text-fg-muted">{reason(r, failing)}</p>
      </div>
      {r.match && (
        <div className="flex flex-col gap-3">
          <Terms
            title="Missing required"
            items={missing.filter(k => k.kind === "required")}
            total={keywords.filter(k => k.kind === "required").length}
            className={frozen ? "text-fg" : "text-danger-text"}
          />
          <Terms title="Missing preferred" items={missing.filter(k => k.kind === "preferred")} className="text-fg" />
          <Terms title="Missing, mentioned in the posting" items={missing.filter(k => k.kind === "general")} className="text-fg-muted" />
          {found.length > 0 && (
            <Disclosure summary={`Found ${found.length} of ${keywords.length} keywords`}>
              <p className="text-fg">{terms(found)}</p>
            </Disclosure>
          )}
          {!failing.length && parsed}
        </div>
      )}
      {(failing.length > 0 || !r.match) && (
        <div className="flex flex-col gap-3">
          {failing.length > 0 && (
            <ul className="flex flex-col gap-3">
              {failing.map(d => (
                <Failing key={d.id} d={d} frozen={frozen} />
              ))}
            </ul>
          )}
          {parsed}
        </div>
      )}
      {notes.length ? <Tooltip content={notes.join(" ")}>{platform}</Tooltip> : platform}
    </div>
  );
}

function Loading() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </div>
        ))}
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-4 w-64" />
    </div>
  );
}

export function AtsPanel({ jobId, version, frozen }: { jobId: number; version: string; frozen: boolean }) {
  const q = useAtsReport(jobId, version, true);
  if (q.isError && q.error instanceof ApiError && q.error.status === 404) return null;
  return (
    <Section title="ATS score">
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <p className="text-base text-fg-muted">Could not score: {q.error.message}</p>
      ) : (
        <Report r={q.data} frozen={frozen} />
      )}
    </Section>
  );
}
