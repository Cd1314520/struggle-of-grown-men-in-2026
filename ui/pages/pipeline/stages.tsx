import type { Segment } from "../../components/ui";

interface Stage {
  label: string;
  short: string;
  tone?: Segment<string>["tone"];
}
export const STAGES: Record<string, Stage> = {
  needs_you: { label: "Needs you", short: "Needs you", tone: "warning" },
  questions: { label: "Waiting on answers", short: "Answers", tone: "warning" },
  failed: { label: "Failed", short: "Failed", tone: "danger" },
  applying: { label: "Applying", short: "Applying" },
  assessing: { label: "Assessing", short: "Assessing" },
};

export const stageSegments = (counts: ReadonlyMap<string, number> | null): Segment<string>[] =>
  Object.entries(STAGES).map(([key, stage]) => ({
    value: key,
    label: stage.label,
    count: counts?.get(key),
    tone: stage.tone,
    data: { "data-stage": key },
  }));
