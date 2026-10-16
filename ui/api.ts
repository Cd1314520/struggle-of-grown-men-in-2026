// Calls to the server. A failed request has already told the user why by the time it throws.
import type { AnswerResult, AppState, DigestResult, JobDetail } from "../src/api-types";
import type { DigestStatus } from "../src/digest";
import { toast } from "./util";

// A refusal from the server, with its status and whatever else the body said (e.g. the job a posting matched).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}
async function request(path: string, send?: { method: string; body: unknown }): Promise<unknown> {
  const res = await fetch(path, send && { method: send.method, headers: { "content-type": "application/json" }, body: JSON.stringify(send.body) }).catch(
    (err: unknown) => {
      if (send) toast("Can't reach the app. Nothing was changed.");
      throw err;
    },
  );
  const data: unknown = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const error = typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : undefined;
    toast(error ?? "Request failed");
    throw new ApiError(error ?? "Request failed", res.status, data);
  }
  return data;
}
const post = (path: string, body: unknown) => request(path, { method: "POST", body });

export const loadState = async () => (await request("/api/state")) as AppState;
// null when the job is gone or the server cannot be reached.
export const loadJob = (id: number) =>
  request(`/api/jobs/${id}`).then(
    job => job as JobDetail,
    () => null,
  );
export const loadProfile = async (file: string) => (await request(`/api/profile/${file}`)) as string;
export const loadDigestStatus = async () => (await request("/api/digest/status")) as DigestStatus;

export const jobAction = (id: number, body: { action: string; text: string; gateId?: string | undefined }) => post(`/api/jobs/${id}/action`, body);
export const browserAction = (id: number, body: { action: string; gateId: string }) => post(`/api/jobs/${id}/browser`, body);
export const recoverJob = (id: number, gateId: string) => post(`/api/jobs/${id}/recover`, { gateId });
export const addPosting = async (url: string) => (await post("/api/jobs", { url })) as { id: number };
export const run = (what: string) => post("/api/run", { what });
export const answerQuestion = async (gateId: string, answer: string, scope: string) =>
  (await post(`/api/questions/${encodeURIComponent(gateId)}/answer`, { answer, scope })) as AnswerResult;
export const sendDigest = async () => (await post("/api/digest/send", {})) as DigestResult;
// Profile files travel as plain text. False when the save did not go through.
export const saveProfileFile = (file: string, text: string) =>
  fetch(`/api/profile/${file}`, { method: "PUT", body: text }).then(
    res => res.ok,
    () => false,
  );
