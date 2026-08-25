import type {
  CompanyRow,
  Dashboard,
  JobDetail,
  JobFilters,
  JobsPage,
  SourceRow,
} from "../types";

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
  requestId?: string;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const envelope = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope?.ok) {
    throw new ApiClientError(
      response.status,
      envelope?.error?.code ?? `HTTP_${response.status}`,
      envelope?.error?.message ?? "API 요청에 실패했습니다.",
      envelope?.requestId,
    );
  }
  return envelope.data;
}

function queryString(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const api = {
  dashboard: () => request<Dashboard>("/api/dashboard"),
  jobs: (filters: JobFilters, cursor: string | null = null) => request<JobsPage>(`/api/jobs${queryString({
    ...filters,
    eligibility: filters.eligibility,
    async: filters.async,
    remoteScope: filters.remoteScope,
    skills: filters.skills,
    changed: filters.changed,
    cursor,
    limit: 50,
  })}`),
  job: (id: string) => request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`),
  versions: (id: string) => request<Array<{ contentHash: string; snapshot: Record<string, unknown>; observedAt: number }>>(`/api/jobs/${encodeURIComponent(id)}/versions`),
  setAction: (id: string, payload: { action: string; dismissReason?: string | null; notes?: string | null; appliedAt?: number | null }) =>
    request(`/api/jobs/${encodeURIComponent(id)}/action`, { method: "PATCH", body: JSON.stringify(payload) }),
  clearAction: (id: string) => request(`/api/jobs/${encodeURIComponent(id)}/action`, { method: "DELETE" }),
  companies: () => request<CompanyRow[]>("/api/companies"),
  createCompany: (payload: Record<string, unknown>) => request("/api/companies", { method: "POST", body: JSON.stringify(payload) }),
  patchCompany: (id: string, payload: Record<string, unknown>) => request(`/api/companies/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  sources: () => request<SourceRow[]>("/api/sources"),
  createSource: (payload: Record<string, unknown>) => request("/api/sources", { method: "POST", body: JSON.stringify(payload) }),
  patchSource: (id: string, payload: Record<string, unknown>) => request(`/api/sources/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  testSource: (id: string) => request(`/api/sources/${encodeURIComponent(id)}/test`, { method: "POST", body: "{}" }),
  resetSource: (id: string) => request(`/api/sources/${encodeURIComponent(id)}/reset-health`, { method: "POST", body: "{}" }),
};
