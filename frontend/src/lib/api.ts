import axios, { AxiosProgressEvent } from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

// ── Token getter registration (set once from providers.tsx) ───────────────────
let _getToken: (() => string) | null = null;

export function registerTokenGetter(fn: () => string) {
  _getToken = fn;
}

// ── Axios instance ─────────────────────────────────────────────────────────────
export const apiClient = axios.create({ baseURL: BASE_URL });

apiClient.interceptors.request.use((config) => {
  const token = _getToken?.();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// ── Meetings API ───────────────────────────────────────────────────────────────
export const meetingsApi = {
  list: (page = 1, limit = 20) =>
    apiClient.get("/api/v1/meetings/", { params: { page, limit } }),

  get: (id: string) =>
    apiClient.get(`/api/v1/meetings/${id}`),

  create: (body: Record<string, unknown>) =>
    apiClient.post("/api/v1/meetings/", body),

  update: (id: string, body: Record<string, unknown>, force = false) =>
    apiClient.patch(`/api/v1/meetings/${id}`, body, { params: { force } }),

  delete: (id: string) =>
    apiClient.delete(`/api/v1/meetings/${id}`),

  presignedUpload: (meetingId: string) =>
    apiClient.post("/api/v1/meetings/presigned-upload", { meeting_id: meetingId }),

  uploadAudioDirectAxios: (
    form: FormData,
    onProgress?: (pct: number) => void,
  ) =>
    apiClient.post("/api/v1/meetings/upload-audio", form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }),

  /**
   * Upload a single audio chunk.
   * Endpoint: POST /api/v1/meetings/{meeting_id}/chunks
   * Backend expects form fields: chunk_id (int), timestamp (ISO string), audio (file).
   */
  uploadChunk: (
    meetingId: string,
    blob:      Blob,
    chunkId:   number,
    _isFinal:  boolean,   // reserved — not used by backend, kept for call-site compat
    mimeType:  string,
  ) => {
    const ext  = mimeType.includes("ogg") ? "ogg" : "webm";
    const form = new FormData();
    form.append("chunk_id",  String(chunkId));
    form.append("timestamp", new Date().toISOString());
    form.append("audio",     blob, `chunk_${String(chunkId).padStart(5, "0")}.${ext}`);
    return apiClient.post(`/api/v1/meetings/${meetingId}/chunks`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  mergeChunks: (meetingId: string) =>
    apiClient.post(`/api/v1/meetings/${meetingId}/merge-chunks`),

  audioUrl: (id: string) =>
    apiClient.get(`/api/v1/meetings/${id}/audio-url`),

  triggerGeneration: (id: string, outputType: string) =>
    apiClient.post(`/api/v1/meetings/${id}/generate/${outputType}`),

  // Meet Bot
  startBotRecording: (id: string, meetLink: string) =>
    apiClient.post(`/api/v1/meetings/bot/${id}/start`, { meet_link: meetLink }),

  stopBotRecording: (id: string) =>
    apiClient.post(`/api/v1/meetings/bot/${id}/stop`),

  getBotStatus: (id: string) =>
    apiClient.get(`/api/v1/meetings/bot/${id}/status`),

  getBotSetupStatus: () =>
    apiClient.get(`/api/v1/meetings/bot/setup/status`),

  startBotSetupLogin: (deleteExisting?: boolean) =>
    apiClient.post(`/api/v1/meetings/bot/setup/login`, { delete_existing: deleteExisting }),

  getBotLoginStatus: (taskId: string) =>
    apiClient.get(`/api/v1/meetings/bot/setup/login/${taskId}`),

  deleteBotProfile: () =>
    apiClient.delete(`/api/v1/meetings/bot/setup/profile`),
};

// ── Diagrams API ───────────────────────────────────────────────────────────────
export const diagramsApi = {
  get: (meetingId: string) =>
    apiClient.get(`/api/meetings/${meetingId}/diagram`),

  regenerate: (meetingId: string) =>
    apiClient.post(`/api/meetings/${meetingId}/diagram/regenerate`),
};

// ── Chat API ───────────────────────────────────────────────────────────────────
export const chatApi = {
  meetings: () =>
    apiClient.get("/api/chat/meetings"),

  meetingsByUser: (userId: string) =>
    apiClient.get(`/api/chat/meetings/by-user/${userId}`),

  history: (meetingId: string) =>
    apiClient.get(`/api/chat/history/${meetingId}`),

  deleteSession: (sessionId: string) =>
    apiClient.delete(`/api/chat/history/session/${sessionId}`),

  status: (meetingId: string) =>
    apiClient.get(`/api/chat/status/${meetingId}`),
};

// ── Stats API ──────────────────────────────────────────────────────────────────
export const statsApi = {
  get: () => apiClient.get("/api/v1/stats"),
  admin: () => apiClient.get("/api/v1/admin/stats"),
};

// ── Admin API ──────────────────────────────────────────────────────────────────
export const adminApi = {
  users: (page = 1, limit = 50) =>
    apiClient.get("/api/v1/admin/users", { params: { page, limit } }),

  setRole: (userId: string, role: string) =>
    apiClient.patch(`/api/v1/admin/users/${userId}/role`, { role }),

  deleteUser: (userId: string) =>
    apiClient.delete(`/api/v1/admin/users/${userId}`),

  meetings: (page = 1, limit = 50, userId?: string) =>
    apiClient.get("/api/v1/admin/meetings", {
      params: { page, limit, ...(userId ? { user_id: userId } : {}) },
    }),

  chunkedMeetings: (page = 1, limit = 50) =>
    apiClient.get("/api/v1/admin/meetings", {
      params: { page, limit, audio_state: "chunked" },
    }),

  storageConfig: () =>
    apiClient.get("/api/v1/admin/system-config/storage"),

  setStorageBackend: (backend: string) =>
    apiClient.put("/api/v1/admin/system-config/storage", { backend }),

  indexUnindexed: () =>
    apiClient.post("/api/v1/admin/meetings/index-unindexed"),

  nextPending: () =>
    apiClient.get("/api/v1/admin/meetings/next-pending"),

  stuckChunked: (page = 1, limit = 50) =>
    apiClient.get("/api/v1/admin/meetings/stuck-chunked", { params: { page, limit } }),
};
