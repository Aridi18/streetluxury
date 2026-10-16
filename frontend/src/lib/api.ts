import type {
  Analysis,
  Comparison,
  Page,
  Recording,
  SystemStatus,
  User,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CSRF = { "X-Requested-With": "AudioSentinel" };

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...CSRF, ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, body, headers, credentials: "same-origin" });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("as:unauthorized"));
    throw new ApiError(res.status, detail || `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  me: () => request<User>("/api/auth/me"),
  login: (email: string, password: string) => request<User>("/api/auth/login", { method: "POST", json: { email, password } }),
  register: (email: string, password: string, display_name?: string) =>
    request<User>("/api/auth/register", { method: "POST", json: { email, password, display_name } }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  dashboard: () => request<{
    recordings: number;
    analyses: number;
    comparisons: number;
    active_jobs: number;
    verdicts: Record<string, number>;
    recent: Analysis[];
  }>("/api/dashboard"),

  recordings: (q?: string, limit = 50, offset = 0) =>
    request<Page<Recording>>(`/api/recordings?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  recording: (id: string) => request<Recording>(`/api/recordings/${id}`),
  renameRecording: (id: string, title: string) => request<Recording>(`/api/recordings/${id}`, { method: "PATCH", json: { title } }),
  deleteRecording: (id: string) => request<void>(`/api/recordings/${id}`, { method: "DELETE" }),
  recordingAnalyses: (id: string) => request<Page<Analysis>>(`/api/recordings/${id}/analyses`),
  peaks: (id: string) => request<{ duration: number; peaks: number[]; scale: number }>(`/api/recordings/${id}/peaks`),
  audioUrl: (id: string) => `/api/recordings/${id}/audio`,
  downloadUrl: (id: string) => `/api/recordings/${id}/audio?download=1`,
  tileUrl: (id: string, index: number) => `/api/recordings/${id}/spectrogram/${index}.png`,

  analyse: (id: string, opts: { start?: number; end?: number; run_synthetic?: boolean }) =>
    request<Analysis>(`/api/recordings/${id}/analyses`, { method: "POST", json: opts }),
  analyses: (params: { status?: string; verdict?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && q.set(k, String(v)));
    return request<Page<Analysis>>(`/api/analyses?${q.toString()}`);
  },
  analysis: (id: string) => request<Analysis>(`/api/analyses/${id}`),
  cancelAnalysis: (id: string) => request<Analysis>(`/api/analyses/${id}/cancel`, { method: "POST" }),
  deleteAnalysis: (id: string) => request<void>(`/api/analyses/${id}`, { method: "DELETE" }),
  reportUrl: (id: string) => `/api/analyses/${id}/report.pdf`,

  compare: (original_id: string, suspect_id: string) =>
    request<Comparison>("/api/comparisons", { method: "POST", json: { original_id, suspect_id } }),
  comparisons: () => request<Page<Comparison>>("/api/comparisons"),
  comparison: (id: string) => request<Comparison>(`/api/comparisons/${id}`),
  deleteComparison: (id: string) => request<void>(`/api/comparisons/${id}`, { method: "DELETE" }),
  comparisonReportUrl: (id: string) => `/api/comparisons/${id}/report.pdf`,

  settings: () => request<User>("/api/settings"),
  updateSettings: (body: Partial<Pick<User, "retention_days" | "delete_audio_after_analysis" | "research_consent" | "display_name">>) =>
    request<User>("/api/settings", { method: "PUT", json: body }),
  deleteAllData: (password: string) => request<{ deleted_recordings: number }>("/api/account/delete-data", { method: "POST", json: { password } }),
  deleteAccount: (password: string) => request<void>("/api/account/delete", { method: "POST", json: { password } }),

  system: () => request<SystemStatus>("/api/system/status"),
};

/** Upload raw bytes with progress (fetch cannot report upload progress). */
export function uploadRecording(
  file: Blob,
  opts: { filename: string; source: "upload" | "microphone" | "voice_note"; title?: string },
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ source: opts.source });
    if (opts.title) q.set("title", opts.title);
    xhr.open("POST", `/api/recordings?${q.toString()}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Requested-With", "AudioSentinel");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(opts.filename));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: { detail?: string } & Partial<Recording> = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Recording);
      else reject(new ApiError(xhr.status, data.detail || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload."));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
