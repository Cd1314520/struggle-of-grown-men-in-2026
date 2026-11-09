import { keepPreviousData, QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import type {
  AtsReport,
  ActivityResult,
  AnswerResult,
  BlockersResult,
  DigestResult,
  JobDetail,
  ListResult,
  ListView,
  ModelsResult,
  ModelStage,
  ResumeState,
  SettingsResult,
  SetupResult,
  Stats,
  Summary,
} from "../../src/api-types";
import type { DigestStatus } from "../../src/digest";
import type { QuestionGroup } from "../../src/questions";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, send?: { method: string; body?: unknown; raw?: boolean; quiet?: boolean }): Promise<T> {
  const init: RequestInit | undefined = send && {
    method: send.method,
    ...(send.raw ? { body: send.body as BodyInit } : { headers: { "content-type": "application/json" }, body: JSON.stringify(send.body ?? {}) }),
  };
  const res = await fetch(path, init).catch((err: unknown) => {
    if (send && !send.quiet) toast.error("Can't reach the app. Nothing was changed.");
    throw err;
  });
  const data: unknown = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const error = typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : "Request failed";
    if (send && !send.quiet) toast.error(error.charAt(0).toUpperCase() + error.slice(1));
    throw new ApiError(error, res.status, data);
  }
  return data as T;
}
const post = <T = { ok: true }>(path: string, body: unknown, quiet = false) => request<T>(path, { method: "POST", body, quiet });

export interface ListParams {
  view: ListView;
  group?: string | null | undefined;
  q?: string | undefined;
  filters?: readonly string[] | undefined;
  sort?: string | null | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
  focus?: number | null | undefined;
}
const listUrl = (p: ListParams) => {
  const s = new URLSearchParams({ view: p.view });
  if (p.group) s.set("group", p.group);
  if (p.q) s.set("q", p.q);
  for (const f of p.filters ?? []) s.append("filter", f);
  if (p.sort) s.set("sort", p.sort);
  if (p.offset) s.set("offset", String(p.offset));
  if (p.limit) s.set("limit", String(p.limit));
  if (p.focus) s.set("focus", String(p.focus));
  return `/api/jobs?${s.toString()}`;
};

export const api = {
  summary: () => request<Summary>("/api/summary"),
  stats: () => request<Stats>("/api/stats"),
  list: (p: ListParams) => request<ListResult>(listUrl(p)),
  job: (id: number) => request<JobDetail>(`/api/jobs/${id}`),
  ats: (id: number) => request<AtsReport>(`/api/jobs/${id}/ats`),
  questions: async () => (await request<{ groups: QuestionGroup[] }>("/api/questions")).groups,
  blockers: async () => (await request<BlockersResult>("/api/blockers")).blockers,
  activity: (p: { feed: "highlights" | "all"; kinds?: readonly string[]; before?: number | null; limit?: number }) => {
    const s = new URLSearchParams({ feed: p.feed });
    for (const k of p.kinds ?? []) s.append("kind", k);
    if (p.before) s.set("before", String(p.before));
    if (p.limit) s.set("limit", String(p.limit));
    return request<ActivityResult>(`/api/activity?${s.toString()}`);
  },
  profile: (file: string) => request<string>(`/api/profile/${file}`),
  digestStatus: () => request<DigestStatus>("/api/digest/status"),
  setup: (refresh = false) => request<SetupResult>(`/api/setup${refresh ? "?refresh" : ""}`),
  models: (refresh = false) => request<ModelsResult>(`/api/models${refresh ? "?refresh" : ""}`),
  resume: () => request<ResumeState>("/api/resume"),
  settings: () => request<SettingsResult>("/api/settings"),

  jobAction: (id: number, body: { action: string; text?: string; gateId?: string | undefined }) => post(`/api/jobs/${id}/action`, { text: "", ...body }),
  stepAction: (id: number, body: Record<string, unknown>) => post(`/api/jobs/${id}/steps`, body),
  refreshBrief: (id: number, step: number) => post(`/api/jobs/${id}/steps/${step}/brief`, {}),
  browserAction: (id: number, body: { action: "reserve" | "release"; gateId: string }) => post(`/api/jobs/${id}/browser`, body),
  recover: (id: number, gateId: string) => post(`/api/jobs/${id}/recover`, { gateId }),
  addPosting: (url: string) => post<{ id: number }>("/api/jobs", { url }, true),
  run: (what: "scan" | "track" | "discover" | "release_held" | "release_targets") => post("/api/run", { what }),
  answer: (gateId: string, answer: string, scope: "application" | "bank") =>
    post<AnswerResult>(`/api/questions/${encodeURIComponent(gateId)}/answer`, { answer, scope }),
  sendDigest: () => post<DigestResult>("/api/digest/send", {}),
  saveProfile: (file: string, text: string) => request<{ ok: true }>(`/api/profile/${file}`, { method: "PUT", body: text, raw: true }),
  setSetting: (path: readonly string[], value: unknown) =>
    request<{ ok: true; restart: boolean }>("/api/settings", { method: "PUT", body: value === undefined ? { path, reset: true } : { path, value } }),
  setModel: (stage: ModelStage, model: string | null) => request<{ ok: true }>(`/api/models/${stage}`, { method: "PUT", body: { model } }),
  importResume: (files: readonly File[], note: string) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    form.append("note", note);
    return request<{ ok: true }>("/api/resume/import", { method: "POST", body: form, raw: true });
  },
  reviseImport: (feedback: string) => post("/api/resume/import/revise", { feedback }),
  acceptImport: (notes: boolean) => post("/api/resume/import/accept", { notes }),
  discardImport: () => post("/api/resume/import/discard", {}),
  cancelImport: () => post("/api/resume/import/cancel", {}),
  exampleResume: () => post("/api/resume/example", {}),
};

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: api.summary });
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: api.stats });
export function useJobList(p: ListParams) {
  const query = useQuery({ queryKey: ["jobs", p], queryFn: () => api.list(p), placeholderData: keepPreviousData });
  const d = query.isPlaceholderData ? undefined : query.data;
  const next = d && d.offset + d.limit < d.total ? JSON.stringify({ ...p, offset: d.offset + d.limit }) : null;
  useEffect(() => {
    if (!next) return;
    const params = JSON.parse(next) as ListParams;
    queryClient.query({ queryKey: ["jobs", params], queryFn: () => api.list(params) }).catch(() => undefined);
  }, [next]);
  return query;
}
export const useJob = (id: number | null) => useQuery({ queryKey: ["job", id], queryFn: () => api.job(id ?? 0), enabled: id !== null });
export const useAtsReport = (id: number, version: string, enabled: boolean) =>
  useQuery({ queryKey: ["ats", id, version], queryFn: () => api.ats(id), enabled, staleTime: Infinity, retry: false });
export const prefetchJobs = (ids: readonly (number | undefined)[]) => {
  for (const id of ids) if (id !== undefined) queryClient.query({ queryKey: ["job", id], queryFn: () => api.job(id) }).catch(() => undefined);
};
export const useSetup = () => useQuery({ queryKey: ["setup"], queryFn: () => api.setup() });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.settings });
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: () => api.models() });
export const useResume = () => useQuery({ queryKey: ["resume"], queryFn: api.resume });
export const useQuestions = () => useQuery({ queryKey: ["questions"], queryFn: api.questions });
export const useBlockers = () => useQuery({ queryKey: ["blockers"], queryFn: api.blockers });
export const useProfileFile = (file: string | null) =>
  useQuery({ queryKey: ["profile", file], queryFn: () => api.profile(file ?? ""), enabled: !!file, staleTime: Infinity });

export const refreshAll = () => queryClient.invalidateQueries({ predicate: q => q.queryKey[0] !== "profile" });
