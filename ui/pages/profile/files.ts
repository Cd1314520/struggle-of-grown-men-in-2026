// What each profile file is for, and the drafts being edited. Drafts live outside the page so leaving it
// by a key or Back keeps the words; a link click asks first (see ProfilePage).
import { queryClient } from "../../lib/api";

// In one line: who reads it and what it changes.
export const PROFILE_DESC: Record<string, string> = {
  "targets.md": "The roles, places and pay you want. Triage and assessment read it to decide what is worth applying to.",
  "rubric.yml": "How a posting is scored: the checks and the points each is worth.",
  "main.typ": "Your resume, in Typst. Each application gets a copy tailored from it.",
  "resume-notes.md": "Facts about your work that tailoring may draw on beyond what the resume says.",
  "answers.md": "Standing answers to application questions, so the form filler asks you less.",
  "personal.yml": "Contact details and the fields every application form asks for.",
  "companies.yml": "The companies whose job boards each scan reads.",
};
// The same, in a few words, for the list of files.
export const PROFILE_GIST: Record<string, string> = {
  "targets.md": "Roles, places and pay you want",
  "rubric.yml": "How postings are scored",
  "main.typ": "Your resume, in Typst",
  "resume-notes.md": "Extra facts for tailoring",
  "answers.md": "Standing answers to questions",
  "personal.yml": "Contact details and form fields",
  "companies.yml": "Boards each scan reads",
};
export const PLACEHOLDER = "TODO-FILL"; // as src/profile.ts: the shipped templates carry it until filled in

// profileProblems names the resume "resume"; its file is the Typst one.
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
  // A draft that differs from the file as last loaded.
  unsaved: (file?: string) => [...drafts].some(([f, text]) => (file === undefined || f === file) && text !== queryClient.getQueryData<string>(["profile", f])),
};

// Leaving the tab with unsaved words asks first.
addEventListener("beforeunload", ev => {
  if (draftStore.unsaved()) ev.preventDefault();
});
