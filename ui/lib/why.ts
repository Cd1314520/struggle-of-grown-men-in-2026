import type { QuestionReason } from "../../src/questions";

const WHY: Record<QuestionReason, string> = {
  agreement: "Agreement",
  fact_missing: "Not on file",
  skill_not_on_resume: "Skill not on resume",
  free_text: "Free-text answer",
  sensitive_id: "ID number",
  history_detail: "Work history detail",
  other: "Other",
};

export const whyLabel = (why: QuestionReason | null) => (why ? WHY[why] : null);
