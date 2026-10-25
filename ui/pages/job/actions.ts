// What the owner does to an open job, and what each says when it worked. Every write refetches what is
// on screen afterwards, failed or not: a refusal usually means the job moved on (a gate closed, a worker
// finished), and the page should show where it is now.
import { useState } from "react";
import { toast } from "sonner";
import type { JobDetail } from "../../../src/api-types";
import { api, refreshAll } from "../../lib/api";
import { navigate } from "../../lib/router";
import { gateIdOf } from "./model";

const GATE_CLOSED = "This gate is no longer open. Reload the application.";

const DONE: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  hold: "Held for later",
  redo: "Redo requested",
  retry: "Back in the queue",
  respond: "Response saved, queued to resume",
  mark_submitted: "Marked as submitted",
  confirmed_not_submitted: "Verified not submitted, queued to resume",
  mark_offer: "Marked as an offer",
  mark_declined: "Marked as declined",
  withdraw: "Withdrawn",
  reopen_application: "Back in process",
};

const STEP_DONE: Record<string, string> = {
  add: "Step added",
  done: "Marked done, watching for their reply",
  book: "Time saved",
  edit: "Step saved",
  todo: "Back to to-do",
  cancel: "Step cancelled",
  remove: "Step removed",
};

// The fields of a step as the form holds them.
export interface StepFields {
  kind: string;
  title: string;
  due: string;
  link: string;
  detail: string;
}

export function useJobActions(job: JobDetail, onActed?: (action: string) => void) {
  // The action running now, so its button spins and the others wait.
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, write: () => Promise<unknown>, done: string) => {
    if (busy) return false;
    setBusy(key);
    try {
      await write();
      toast.success(done);
      return true;
    } catch {
      // The request already showed the server's refusal.
      return false;
    } finally {
      setBusy(null);
      void refreshAll();
    }
  };

  const id = job.id,
    gateId = gateIdOf(job);
  return {
    busy,
    gateId,
    // A decision on the job. Rejecting can be undone from the toast, unless the application may already
    // have gone out: then retrying it could send it twice.
    act: async (action: string, text = "") => {
      if (busy) return false;
      // Where this job was open, so Undo can bring it back after the list has moved on. Only a job rejected
      // from review returns to the same list: retrying anything else sends it to review or assessment.
      const from = job.status === "awaiting_approval" ? location.hash : null;
      setBusy(action);
      try {
        await api.jobAction(id, { action, text, gateId });
      } catch {
        void refreshAll();
        return false;
      } finally {
        setBusy(null);
      }
      const done = DONE[action] ?? "Saved";
      if (action === "reject" && !job.submissionAmbiguous)
        toast.success(done, {
          description: job.title,
          action: {
            label: "Undo",
            onClick: () => {
              void api
                .jobAction(id, { action: "retry" })
                .then(
                  () => {
                    toast.success("Back in the queue");
                    if (from) navigate(from, { replace: true });
                  },
                  () => undefined, // the request already showed why it was refused
                )
                .finally(() => void refreshAll());
            },
          },
        });
      else toast.success(done);
      void refreshAll();
      onActed?.(action);
      return true;
    },
    browser: (action: "reserve" | "release") => {
      if (!gateId) {
        toast.error(GATE_CLOSED);
        return Promise.resolve(false);
      }
      return run(action, () => api.browserAction(id, { action, gateId }), action === "reserve" ? "Browser reserved" : "Browser reservation released");
    },
    recover: () => {
      if (!gateId) {
        toast.error(GATE_CLOSED);
        return Promise.resolve(false);
      }
      return run("recover", () => api.recover(id, gateId), "Recovery queued");
    },
    step: (op: string, body: Record<string, unknown> = {}) =>
      run(`step:${op}:${typeof body["step"] === "number" ? body["step"] : ""}`, () => api.stepAction(id, { op, ...body }), STEP_DONE[op] ?? "Saved"),
  };
}
export type JobActions = ReturnType<typeof useJobActions>;

// Typed text that should survive switching to another job and back: an answer, a cover letter.
const drafts = new Map<string, string>();
export function useDraft(key: string) {
  const [value, setValue] = useState(() => drafts.get(key) ?? "");
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setValue(drafts.get(key) ?? "");
  }
  return [
    value,
    (v: string) => {
      if (v) drafts.set(key, v);
      else drafts.delete(key);
      setValue(v);
    },
  ] as const;
}
