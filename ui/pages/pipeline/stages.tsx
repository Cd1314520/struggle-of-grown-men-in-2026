import type { Segment } from "../../components/ui";

interface Stage {
  label: string;
  short: string;
  tone?: Segment<string>["tone"];
}
export const STAGES: Record<string, Stage> = {
  needs_you: { label: "Needs you", short: "Needs you", tone: "warning" },
  failed: { label: "Failed", short: "Failed", tone: "danger" },
  blocked: { label: "Blocked by site", short: "Blocked" },
  questions: { label: "Questions", short: "Questions", tone: "warning" },
  applying: { label: "Applying", short: "Applying" },
  assessing: { label: "Assessing", short: "Assessing" },
};

export const ATTENTION = ["needs_you", "failed"];

export const stageSegments = (counts: ReadonlyMap<string, number> | null, compact = false): Segment<string>[] =>
  Object.entries(STAGES).map(([key, stage]) => ({
    value: key,
    label: compact ? stage.short : stage.label,
    count: counts?.get(key),
    tone: stage.tone,
    data: { "data-stage": key },
  }));
