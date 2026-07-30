export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:3001";

export interface AppSummary {
  name: string;
  container: string;
  resources: { memory: string[]; cpu: string[] };
}

export interface LoadStage {
  duration: string;
  target: number;
}

export interface AppDetail extends AppSummary {
  load: { vus: number; stages: LoadStage[] };
  manifestContent: string;
  scriptContent: string;
}

export type JobStatus = "starting" | "running" | "done" | "failed";

export interface JobState {
  appName: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  logTail: string;
  outputDir?: string;
}

export interface OutputEntry {
  folder: string;
  timestamp: string;
}

export interface ResultRow {
  memory: string;
  cpu: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  p95_ms: number | null;
  p99_ms: number | null;
  error_rate: number | null;
  http_reqs_total: number | null;
  oom_killed: boolean;
  restart_count: number;
}

export interface CheckResult {
  ready: boolean;
  output: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(`Cannot reach perftest-api at ${API_BASE}`, 0);
  }

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body?.message ?? body?.error ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg, res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  check: () => request<CheckResult>("/check"),
  listApps: () => request<AppSummary[]>("/apps"),
  getApp: (name: string) => request<AppDetail>(`/apps/${encodeURIComponent(name)}`),
  createApp: (body: AppDetail) =>
    request<AppDetail>("/apps", { method: "POST", body: JSON.stringify(body) }),
  updateApp: (name: string, body: Partial<AppDetail>) =>
    request<AppDetail>(`/apps/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteApp: (name: string) =>
    request<void>(`/apps/${encodeURIComponent(name)}`, { method: "DELETE" }),
  template: () => request<AppDetail>("/templates/example"),
  startRun: (name: string) =>
    request<JobState>(`/apps/${encodeURIComponent(name)}/runs`, { method: "POST" }),
  currentJob: () => request<JobState>("/jobs/current"),
  cancelJob: () => request<{ cancelled: boolean }>("/jobs/current", { method: "DELETE" }),
  outputs: (name: string) => request<OutputEntry[]>(`/apps/${encodeURIComponent(name)}/outputs`),
  outputRows: (name: string, folder: string) =>
    request<{ rows: ResultRow[] }>(
      `/apps/${encodeURIComponent(name)}/outputs/${encodeURIComponent(folder)}`,
    ),
  rawCsvUrl: (name: string, folder: string) =>
    `${API_BASE}/apps/${encodeURIComponent(name)}/outputs/${encodeURIComponent(folder)}/raw`,
};

export function isActive(status?: JobStatus) {
  return status === "starting" || status === "running";
}

export function formatElapsed(startedAt: string, finishedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
