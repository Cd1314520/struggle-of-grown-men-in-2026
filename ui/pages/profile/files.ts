import { queryClient } from "../../lib/api";

export const PROFILE_DESC: Record<string, string> = {
  "targets.md": "The roles, places and pay you want. Triage and assessment read it to decide what is worth applying to.",
  "rubric.yml": "How a posting is scored: the checks and the points each is worth.",
  "main.typ": "Your resume, in Typst. Each application gets a copy tailored from it.",
  "resume-notes.md": "Facts about your work that tailoring may draw on beyond what the resume says.",
  "answers.md": "Answers to application questions, so the form filler asks you less. Answers you keep on Questions are added here.",
  "personal.yml": "Contact details and the fields every application form asks for.",
  "companies.yml": "The companies whose job boards each scan reads.",
  "employers.yml": "Employers you have settled by hand: the ones you most want, and the ones that are fine to practise on.",
};
export const PLACEHOLDER = "TODO-FILL";

export const needsFilling = (problems: readonly string[], file: string) => problems.some(p => p === file || (p === "resume" && file.endsWith(".typ")));

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
export const draftStore = {
  get: (file: string) => drafts.get(file),
  set: (file: string, text: string) => {
    drafts.set(file, text);
    changed();
  },
  clear: (file: string) => {
    drafts.delete(file);
    changed();
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  unsaved: (file?: string) => [...drafts].some(([f, text]) => (file === undefined || f === file) && text !== queryClient.getQueryData<string>(["profile", f])),
};

addEventListener("beforeunload", ev => {
  if (draftStore.unsaved()) ev.preventDefault();
});
