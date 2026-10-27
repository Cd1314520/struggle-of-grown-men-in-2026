// The pipeline's stages, as the panel's segments name them. The stages that wait on the owner tint
// their count while something is in them.
import type { Segment } from "../../components/ui";

interface Stage {
  label: string;
  short: string; // the search's placeholder beside an open job, where the column is narrow
  caption: string; // the panel's title: what the stage holds, as the segment under it names the stage
  tone?: Segment<string>["tone"]; // the count's, when the stage holds anything
}
// In the order the server groups them (src/listing.ts).
export const STAGES: Record<string, Stage> = {
  needs_you: { label: "Needs you", short: "Needs you", caption: "Paused until you act", tone: "warning" },
  questions: { label: "Waiting on answers", short: "Answers", caption: "Paused on form questions", tone: "warning" },
  failed: { label: "Failed", short: "Failed", caption: "Stopped with an error", tone: "danger" },
  applying: { label: "Applying", short: "Applying", caption: "Queued or in the browser" },
  assessing: { label: "Assessing", short: "Assessing", caption: "Being scored before review" },
};

// `counts` is null while the first page loads.
export const stageSegments = (counts: ReadonlyMap<string, number> | null): Segment<string>[] =>
  Object.entries(STAGES).map(([key, stage]) => ({
    value: key,
    label: stage.label,
    count: counts?.get(key),
    tone: stage.tone,
    data: { "data-stage": key },
  }));
