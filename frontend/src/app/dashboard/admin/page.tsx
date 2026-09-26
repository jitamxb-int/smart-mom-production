"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, adminApi, meetingsApi } from "@/lib/api";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Users, BarChart3, Loader2, Trash2, Shield, ShieldOff,
  Search, ChevronLeft, ChevronRight, AlertTriangle, X,
  Settings, HardDrive, Cloud, CheckCircle2, RefreshCw, Database,
  FileText, Download, Play, Edit2, Save, XCircle,
  GitMerge, Zap, Clock, CheckSquare, AlertCircle, ChevronDown, ChevronUp,
  UserPlus, Users as UsersIcon, User,
  ExternalLink, Monitor, LogIn, Trash,
} from "lucide-react";
import { format } from "date-fns";
import { formatIST } from "@/lib/dateUtils";
import toast from "react-hot-toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser {
  user_id:       string;
  email:         string;
  name:          string;
  role:          "user" | "admin";
  created_at:    string;
  last_login_at: string;
  avatar_url?:   string;
  auth_provider?: string;
}

interface AdminStats {
  users:    number;
  meetings: number;
  chat_sessions: number;
  meetings_by_status: Record<string, number>;
}

interface StorageConfig {
  active_backend:   "s3" | "local";
  s3_bucket:        string;
  s3_region:        string;
  local_path:       string;
  changed_at:       string | null;
  changed_by_email: string | null;
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  message, onConfirm, onCancel, danger = false,
}: {
  message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${danger ? "text-red-500" : "text-amber-500"}`} />
          <p className="text-gray-800 text-sm">{message}</p>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-500 hover:bg-amber-600"}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Panel ──────────────────────────────────────────────────────────────

function AdminStatsPanel() {
  const { data, isLoading } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await apiClient.get("/api/v1/admin/stats");
      return res.data.data;
    },
  });

  const statuses = data?.meetings_by_status || {};

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {[
        { label: "Total Users",      value: data?.users,                       color: "indigo" },
        { label: "Total Meetings",   value: data?.meetings,                    color: "teal"   },
        { label: "Chat Sessions",    value: data?.chat_sessions,               color: "purple" },
        { label: "Transcript Ready", value: statuses["transcript_ready"] ?? 0, color: "green"  },
      ].map(({ label, value, color }) => (
        <div key={label} className={`rounded-xl border p-4 bg-${color}-50 text-${color}-600 border-${color}-100`}>
          <p className="text-xs font-medium opacity-75">{label}</p>
          <p className="text-2xl font-bold mt-0.5">
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin inline" /> : (value ?? 0)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Storage Config Panel ─────────────────────────────────────────────────────

function StorageConfigPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<StorageConfig>({
    queryKey: ["admin-storage-config"],
    queryFn: async () => {
      const res = await adminApi.storageConfig();
      return res.data.data;
    },
  });

  const switchMutation = useMutation({
    mutationFn: (backend: "s3" | "local") => adminApi.setStorageBackend(backend),
    onSuccess: (res) => {
      toast.success(res.data.message || "Storage backend updated");
      queryClient.invalidateQueries({ queryKey: ["admin-storage-config"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to switch storage backend"),
  });

  const active   = data?.active_backend;
  const isBusy   = switchMutation.isPending;
  const isS3     = active === "s3";
  const isLocal  = active === "local";

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-indigo-600" />
          Audio Storage Backend
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Choose where audio files are stored and retrieved. This setting applies
          platform-wide immediately and persists across server restarts.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading storage configuration…</span>
        </div>
      ) : isError ? (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Failed to load storage config.
          <button onClick={() => refetch()} className="ml-auto flex items-center gap-1 text-red-600 hover:underline text-xs">
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* Toggle cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">

            {/* S3 Card */}
            <button
              onClick={() => !isS3 && !isBusy && switchMutation.mutate("s3")}
              disabled={isBusy}
              className={`relative text-left p-5 rounded-2xl border-2 transition-all focus:outline-none
                ${isS3
                  ? "border-indigo-500 bg-indigo-50 shadow-md"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
                }
                ${isBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              {/* Active indicator */}
              {isS3 && (
                <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 bg-indigo-600 text-white text-xs font-semibold rounded-full">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </span>
              )}

              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3
                ${isS3 ? "bg-indigo-600" : "bg-gray-100"}`}>
                <Cloud className={`h-5 w-5 ${isS3 ? "text-white" : "text-gray-500"}`} />
              </div>

              <p className={`font-semibold text-base ${isS3 ? "text-indigo-700" : "text-gray-800"}`}>
                AWS S3 Bucket
              </p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Audio files are stored in and served from your S3 bucket via presigned URLs.
                Best for production and multi-instance deployments.
              </p>

              {isS3 && data && (
                <div className="mt-3 pt-3 border-t border-indigo-200 space-y-1">
                  <p className="text-xs text-indigo-700">
                    <span className="font-medium">Bucket:</span> {data.s3_bucket}
                  </p>
                  <p className="text-xs text-indigo-700">
                    <span className="font-medium">Region:</span> {data.s3_region}
                  </p>
                </div>
              )}

              {/* Loading spinner when switching TO s3 */}
              {isBusy && !isS3 && switchMutation.variables === "s3" && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-2xl">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                </div>
              )}
            </button>

            {/* Local Storage Card */}
            <button
              onClick={() => !isLocal && !isBusy && switchMutation.mutate("local")}
              disabled={isBusy}
              className={`relative text-left p-5 rounded-2xl border-2 transition-all focus:outline-none
                ${isLocal
                  ? "border-teal-500 bg-teal-50 shadow-md"
                  : "border-gray-200 bg-white hover:border-teal-300 hover:bg-teal-50/40"
                }
                ${isBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              {/* Active indicator */}
              {isLocal && (
                <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 bg-teal-600 text-white text-xs font-semibold rounded-full">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </span>
              )}

              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3
                ${isLocal ? "bg-teal-600" : "bg-gray-100"}`}>
                <HardDrive className={`h-5 w-5 ${isLocal ? "text-white" : "text-gray-500"}`} />
              </div>

              <p className={`font-semibold text-base ${isLocal ? "text-teal-700" : "text-gray-800"}`}>
                Local File System
              </p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Audio files are saved to and served from the server's local disk.
                Useful when S3 is unavailable or for development.
              </p>

              {isLocal && data && (
                <div className="mt-3 pt-3 border-t border-teal-200">
                  <p className="text-xs text-teal-700">
                    <span className="font-medium">Path:</span> {data.local_path}
                  </p>
                </div>
              )}

              {/* Loading spinner when switching TO local */}
              {isBusy && !isLocal && switchMutation.variables === "local" && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-2xl">
                  <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
                </div>
              )}
            </button>
          </div>

          {/* Last-changed metadata */}
          {data?.changed_at && (
            <p className="text-xs text-gray-400">
              Last changed {format(new Date(data.changed_at), "MMM d, yyyy 'at' h:mm a")}
              {data.changed_by_email && <> by <span className="font-medium">{data.changed_by_email}</span></>}
            </p>
          )}

          {/* Warning for local storage in production */}
          {isLocal && (
            <div className="mt-4 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Local storage is active</p>
                <p className="text-xs mt-0.5 text-amber-700">
                  Audio files are stored on this server's disk. If you run multiple backend
                  instances or restart the server, files may not be accessible. Only recommended
                  for development or single-instance deployments.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Meet Bot Setup ───────────────────────────────────────────────────────────

function BotSetupCard() {
  const queryClient = useQueryClient();

  // ── Profile status ──────────────────────────────────────────────────────────
  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["bot-setup-status"],
    queryFn: async () => {
      const res = await meetingsApi.getBotSetupStatus();
      return res.data as {
        profile_exists: boolean;
        profile_path: string;
        setup_required: boolean;
      };
    },
  });

  const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [novncUrl, setNovncUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReSetup, setConfirmReSetup] = useState(false);
  const [startingLogin, setStartingLogin] = useState(false);

  // ── Start login ─────────────────────────────────────────────────────────────
  const startLogin = async (deleteExisting: boolean) => {
    setStartingLogin(true);
    setLoginError(null);
    setConfirmReSetup(false);
    try {
      const res = await meetingsApi.startBotSetupLogin(deleteExisting);
      const body = res.data;

      if (body.confirmation_required) {
        setConfirmReSetup(true);
        setStartingLogin(false);
        return;
      }

      if (body.profile_exists) {
        setNovncUrl(null);
        setLoginTaskId(null);
        setLoginStatus("completed");
        refetchStatus();
        setStartingLogin(false);
        return;
      }

      setLoginTaskId(body.task_id);
      setNovncUrl(body.novnc_url);
      setLoginStatus("running");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setLoginError(detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : (e.message || "Failed to start login"));
    }
    setStartingLogin(false);
  };

  // ── Poll login task ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loginTaskId || loginStatus !== "running") return;

    const interval = setInterval(async () => {
      try {
        const res = await meetingsApi.getBotLoginStatus(loginTaskId);
        const body = res.data;
        setLoginStatus(body.status);
        if (body.status === "completed") {
          setNovncUrl(null);
          refetchStatus();
          clearInterval(interval);
        } else if (body.status === "failed") {
          setLoginError(body.error || "Login failed");
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [loginTaskId, loginStatus, refetchStatus]);

  // ── Delete profile ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => meetingsApi.deleteBotProfile(),
    onSuccess: (res) => {
      const body = res.data;
      if (body.confirmation_required) {
        setConfirmDelete(true);
        return;
      }
      toast.success("Chrome profile deleted");
      setConfirmDelete(false);
      refetchStatus();
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete profile"),
  });

  const confirmDeleteProfile = useMutation({
    mutationFn: () => meetingsApi.deleteBotProfile(),
    onSuccess: () => {
      toast.success("Chrome profile deleted");
      setConfirmDelete(false);
      refetchStatus();
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete profile"),
  });

  const profileExists = statusData?.profile_exists;
  const setupRequired = statusData?.setup_required;

  return (
    <div className="max-w-2xl mt-8">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Monitor className="h-5 w-5 text-indigo-600" />
          Meet Bot — Chrome Profile
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          The meet bot uses a dedicated Chrome profile with a logged-in Google account
          to join Google Meet calls. Set it up once via noVNC.
        </p>
      </div>

      {statusLoading ? (
        <div className="flex items-center gap-3 py-6 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Checking profile status…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status indicator */}
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${
            profileExists
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          }`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              profileExists ? "bg-green-600" : "bg-amber-500"
            }`}>
              {profileExists
                ? <CheckCircle2 className="h-4 w-4 text-white" />
                : <AlertTriangle className="h-4 w-4 text-white" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${
                profileExists ? "text-green-800" : "text-amber-800"
              }`}>
                {profileExists ? "Chrome profile ready" : "Setup required"}
              </p>
              <p className="text-xs mt-0.5 text-gray-500 truncate font-mono">
                {statusData?.profile_path}
              </p>
            </div>
          </div>

          {/* Confirmation dialog to delete and re-setup */}
          {confirmReSetup && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                A Chrome profile already exists. What do you want to do?
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => startLogin(false)} disabled={startingLogin}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Keep Existing Profile
                </button>
                <button onClick={() => startLogin(true)} disabled={startingLogin}
                  className="px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 transition-colors"
                >
                  {startingLogin ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting & Re-setting…</> : "Delete & Re-setup"}
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {(!loginTaskId || loginStatus !== "running") && !confirmReSetup ? (
              <>
                {!profileExists && (
                  <button onClick={() => startLogin(false)} disabled={startingLogin}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {startingLogin
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
                      : <><LogIn className="h-3.5 w-3.5" /> Setup Login</>
                    }
                  </button>
                )}

                {profileExists && (
                  <>
                    <button onClick={() => startLogin(false)} disabled={startingLogin}
                      className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {startingLogin
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
                        : <><LogIn className="h-3.5 w-3.5" /> Use Existing Profile</>
                      }
                    </button>
                    <button onClick={() => setConfirmReSetup(true)} disabled={startingLogin}
                      className="flex items-center gap-1.5 px-4 py-2 bg-white border border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-50 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Re-setup Login
                    </button>
                  </>
                )}

                {profileExists && (
                  <button
                    onClick={() => {
                      if (confirmDelete) {
                        confirmDeleteProfile.mutate();
                      } else {
                        deleteMutation.mutate();
                      }
                    }}
                    disabled={deleteMutation.isPending || confirmDeleteProfile.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white border border-red-300 text-red-700 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {deleteMutation.isPending || confirmDeleteProfile.isPending
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
                      : <><Trash className="h-3.5 w-3.5" /> {confirmDelete ? "Confirm Delete" : "Delete Profile"}</>
                    }
                  </button>
                )}
              </>
            ) : null}

            <button
              onClick={() => refetchStatus()}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          {/* Login running state */}
          {loginStatus === "running" && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-blue-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p className="text-sm font-medium">Login in progress…</p>
              </div>
              {novncUrl && (
                <a
                  href={novncUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open noVNC to complete login
                </a>
              )}
              <p className="text-xs text-blue-600">
                Use the noVNC link to interact with Chrome and sign in to Google.
                The bot will wait for a logged-in session.
              </p>
            </div>
          )}

          {/* Completed state */}
          {loginStatus === "completed" && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {profileExists ? "Using existing profile" : "Profile is ready"}
              </p>
            </div>
          )}

          {/* Error */}
          {loginError && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Login failed</p>
                <p className="text-xs mt-0.5">{loginError}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Users Table ──────────────────────────────────────────────────────────────

function UsersTable({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const [confirm, setConfirm] = useState<{ type: "delete" | "role"; user: AdminUser } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", page],
    queryFn: async () => {
      const res = await apiClient.get("/api/v1/admin/users", { params: { page, limit: 50 } });
      return res.data as { data: AdminUser[]; meta: { total: number } };
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiClient.patch(`/api/v1/admin/users/${userId}/role`, { role }),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setConfirm(null);
    },
    onError: (e: any) => toast.error(e.message || "Failed to update role"),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/v1/admin/users/${userId}`),
    onSuccess: () => {
      toast.success("User deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-users", "admin-stats"] });
      setConfirm(null);
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete user"),
  });

  const users = (data?.data || []).filter(
    (u) => !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase())
  );
  const total = data?.meta?.total || 0;

  return (
    <div>
      {confirm && (
        <ConfirmDialog
          danger={confirm.type === "delete"}
          message={
            confirm.type === "delete"
              ? `Delete ${confirm.user.email} and ALL their meetings? This is irreversible.`
              : `Change ${confirm.user.email}'s role to '${confirm.user.role === "admin" ? "user" : "admin"}'?`
          }
          onConfirm={() => {
            if (confirm.type === "delete") deleteMutation.mutate(confirm.user.user_id);
            else roleMutation.mutate({ userId: confirm.user.user_id, role: confirm.user.role === "admin" ? "user" : "admin" });
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text" placeholder="Search by name or email…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500">{total} total users</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Provider</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last Login</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.user_id} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold">
                          {user.name?.[0] || user.email[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-gray-800">{user.name || "—"}</p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${user.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${user.auth_provider === "google" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-600"}`}>
                      {user.auth_provider === "google" ? "Google" : "Email"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {user.created_at ? format(new Date(user.created_at), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {user.last_login_at ? format(new Date(user.last_login_at), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {user.user_id !== currentUserId ? (
                        <>
                          <button
                            onClick={() => setConfirm({ type: "role", user })}
                            title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-amber-600"
                          >
                            {user.role === "admin" ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => setConfirm({ type: "delete", user })}
                            title="Delete user"
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 px-2">You</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No users found</p>}
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded border disabled:opacity-40 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-600">Page {page}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(data?.data || []).length < 50} className="p-1.5 rounded border disabled:opacity-40 hover:bg-gray-50">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── RAG Indexing Panel ───────────────────────────────────────────────────────

interface IndexResult {
  summary: {
    total_found:  number;
    indexed:      number;
    skipped:      number;
    failed:       number;
  };
  errors:  string[];
  message: string;
}

function RagIndexingPanel() {
  const [result, setResult] = useState<IndexResult | null>(null);

  const indexMutation = useMutation({
    mutationFn: () => adminApi.indexUnindexed(),
    onSuccess: (res) => {
      setResult(res.data);
      const { indexed, failed } = res.data.summary;
      if (failed > 0) {
        toast.error(`Completed with ${failed} failure${failed > 1 ? "s" : ""}. ${indexed} indexed.`);
      } else if (indexed === 0) {
        toast("All meetings are already indexed.", { icon: "✅" });
      } else {
        toast.success(`${indexed} meeting${indexed > 1 ? "s" : ""} indexed successfully.`);
      }
    },
    onError: (e: any) => toast.error(e.message || "Indexing failed"),
  });

  const { isPending } = indexMutation;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Database className="h-5 w-5 text-indigo-600" />
          RAG / Chat Indexing
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Index all meetings that have a transcript but have not yet been added to the
          vector database. This enables the AI chat feature for those meetings.
          Already-indexed meetings are always skipped.
        </p>
      </div>

      {/* Trigger button */}
      <button
        onClick={() => { setResult(null); indexMutation.mutate(); }}
        disabled={isPending}
        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        {isPending ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Indexing in progress…</>
        ) : (
          <><Database className="h-4 w-4" /> Index All Unindexed Meetings</>
        )}
      </button>

      {isPending && (
        <div className="mt-4 flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-700 text-sm">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Indexing in progress…</p>
            <p className="text-xs mt-0.5 text-indigo-600">
              Each meeting requires embedding its transcript — this may take a minute for large backlogs.
              Please keep this page open.
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !isPending && (
        <div className="mt-6 space-y-4">
          <div className="p-5 bg-white border border-gray-200 rounded-xl">
            <p className="text-sm font-semibold text-gray-800 mb-4">{result.message}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Found",   value: result.summary.total_found, color: "gray"   },
                { label: "Indexed", value: result.summary.indexed,     color: "green"  },
                { label: "Skipped", value: result.summary.skipped,     color: "amber"  },
                { label: "Failed",  value: result.summary.failed,      color: "red"    },
              ].map(({ label, value, color }) => (
                <div key={label} className={`rounded-lg p-3 bg-${color}-50 border border-${color}-100 text-center`}>
                  <p className={`text-xl font-bold text-${color}-700`}>{value}</p>
                  <p className={`text-xs font-medium text-${color}-500 mt-0.5`}>{label}</p>
                </div>
              ))}
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Errors ({result.errors.length})
              </p>
              <ul className="space-y-1">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-700 font-mono bg-red-100 rounded px-2 py-1">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.summary.indexed > 0 && result.summary.failed === 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              All meetings indexed successfully. The AI chat feature is now available for them.
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-600">How this works</p>
        <p>• Scans every meeting where <code className="bg-gray-100 px-1 rounded">rag_indexed = false</code> and a transcript is present.</p>
        <p>• Chunks each transcript, generates embeddings via OpenAI, and upserts them to Qdrant.</p>
        <p>• Sets <code className="bg-gray-100 px-1 rounded">rag_indexed = true</code> on each meeting upon completion.</p>
        <p>• Skipped meetings have a transcript record but no text content.</p>
        <p>• This operation is idempotent — running it multiple times is safe.</p>
      </div>
    </div>
  );
}


// ─── Transcripts Management Panel ────────────────────────────────────────────

interface AdminMeeting {
  meeting_id:      string;
  user_id:         string;
  context:         string;
  status:          string;
  audio_state:     string;
  rag_indexed:     boolean;
  rag_indexed_at:  string | null;
  transcript:      { text: string; word_count: number; language: string } | null;
  created_at:      string;
  updated_at:      string;
  attendees:       string[];
  no_of_persons:   number;
  date_time:       string;
  audio_s3_key?:   string;
}

interface NextPendingData {
  meeting_id:      string;
  user_id:         string;
  context:         string;
  status:          string;
  audio_state:     string;
  created_at:      string;
  audio_s3_key?:   string;
  stuck_chunked?:  number;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    transcript_ready: "bg-green-100 text-green-700 border-green-200",
    audio_uploaded:   "bg-blue-100 text-blue-700 border-blue-200",
    processing:       "bg-amber-100 text-amber-700 border-amber-200",
    created:          "bg-gray-100 text-gray-600 border-gray-200",
    recording:        "bg-orange-100 text-orange-700 border-orange-200",
  };
  return map[status] || "bg-gray-100 text-gray-600 border-gray-200";
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusColor(label)}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ── Transcript Edit Modal (JSON-only, strict structured format) ───────────────
function TranscriptEditModal({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: AdminMeeting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();

  // ── Build initial JSON lines from existing transcript ─────────────────────
  const existingSegmentsRaw = (() => {
    const t = meeting.transcript as any;
    if (!t) return "";
    // First check if segments array exists (preferred structure after backend fix)
    if (Array.isArray(t.segments) && t.segments.length > 0) {
      return t.segments.map((s: any) => JSON.stringify(s)).join("\n");
    }
    // Legacy check: if text is an array (old format before fix)
    if (Array.isArray(t.text)) {
      return t.text.map((s: any) => JSON.stringify(s)).join("\n");
    }
    // If text is a string but no segments, create a single segment
    if (typeof t.text === "string" && t.text) {
      return JSON.stringify({ speaker: "SPEAKER_00", speaker_name: "", start: 0, end: 0, text: t.text });
    }
    return "";
  })();

  const [segmentsRaw, setSegmentsRaw] = useState(existingSegmentsRaw);
  const [language,    setLanguage]    = useState((meeting.transcript as any)?.language || "en");
  const [parseError,  setParseError]  = useState("");
  const [preview,     setPreview]     = useState<any[] | null>(null);

  // ── Speaker name mappings ─────────────────────────────────────────────────────
  // Extract existing speaker names from segments
  const extractSpeakerNames = (segments: any[]): Record<string, string> => {
    const names: Record<string, string> = {};
    segments.forEach(seg => {
      if (seg.speaker && seg.speaker_name) {
        names[seg.speaker] = seg.speaker_name;
      }
    });
    return names;
  };

  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>(() => {
    const t = meeting.transcript as any;
    if (t?.segments) {
      return extractSpeakerNames(t.segments);
    }
    return {};
  });
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);

  // Auto-detect unique speakers from transcript
  const updateDetectedSpeakers = (text: string) => {
    const speakers = new Set<string>();
    const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.speaker && typeof obj.speaker === "string") {
          speakers.add(obj.speaker);
        }
      } catch {
        // Skip invalid JSON
      }
    }
    const sorted = Array.from(speakers).sort();
    setDetectedSpeakers(sorted);
  };

  // Initial detection on mount
  useEffect(() => {
    updateDetectedSpeakers(existingSegmentsRaw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, any>) =>
      meetingsApi.update(meeting.meeting_id, payload, true),
    onSuccess: () => {
      toast.success("Transcript saved successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  // ── Parse and validate — always produces array of segment objects ─────────
  const parseSegments = (): { ok: true; segments: any[] } | { ok: false; error: string } => {
    const lines = segmentsRaw.split("\n").map((l: string) => l.trim()).filter(Boolean);
    if (lines.length === 0) return { ok: false, error: "Transcript cannot be empty." };
    const segments: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      let obj: any;
      try { obj = JSON.parse(lines[i]); } catch (e: any) {
        return { ok: false, error: `Line ${i + 1}: Invalid JSON — ${e.message}` };
      }
      if (typeof obj.speaker !== "string" || !obj.speaker.trim())
        return { ok: false, error: `Line ${i + 1}: Missing or invalid 'speaker' field (must be a string).` };
      if (typeof obj.text !== "string" || !obj.text.trim())
        return { ok: false, error: `Line ${i + 1}: Missing or invalid 'text' field (must be a non-empty string).` };
      if (typeof obj.start !== "number")
        return { ok: false, error: `Line ${i + 1}: Missing or invalid 'start' field (must be a number in seconds).` };
      if (typeof obj.end !== "number")
        return { ok: false, error: `Line ${i + 1}: Missing or invalid 'end' field (must be a number in seconds).` };
      // speaker_name is optional
      segments.push({
        speaker: obj.speaker,
        speaker_name: obj.speaker_name || "",
        start: obj.start,
        end: obj.end,
        text: obj.text
      });
    }
    return { ok: true, segments };
  };

  const handlePreview = () => {
    setParseError("");
    const result = parseSegments();
    if (!result.ok) { setParseError(result.error); setPreview(null); return; }
    setPreview(result.segments);
  };

  const handleSave = () => {
    setParseError("");
    const result = parseSegments();
    if (!result.ok) { setParseError(result.error); setPreview(null); return; }
    const { segments } = result;

    // Apply speaker names to all segments
    const segmentsWithNames = segments.map(seg => ({
      ...seg,
      speaker_name: speakerNames[seg.speaker] || ""
    }));

    const wordCount = segments.map(s => s.text).join(" ").trim().split(/\s+/).filter(Boolean).length;
    // Always build the exact backend-required structure
    const payload = {
      transcript: {
        text:        segmentsWithNames,  // array of segment objects with speaker_name
        word_count:  wordCount,
        language:    language.trim() || "en",
        received_at: (meeting.transcript as any)?.received_at || new Date().toISOString(),
      },
      status: "transcript_ready",
    };
    updateMutation.mutate(payload);
  };

  const insertExample = () => {
    setSegmentsRaw(
      `{"speaker":"SPEAKER_00","speaker_name":"","start":0.0,"end":12.5,"text":"Hello everyone, welcome to the meeting."}\n` +
      `{"speaker":"SPEAKER_01","speaker_name":"","start":12.6,"end":28.0,"text":"Thank you for having me here today."}\n` +
      `{"speaker":"SPEAKER_00","speaker_name":"","start":28.1,"end":45.0,"text":"Let us begin with the first agenda item."}`
    );
    setParseError("");
    setPreview(null);
  };

  const segmentCount = segmentsRaw.split("\n").filter((l: string) => l.trim()).length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 sm:px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600 flex-shrink-0" />
              Edit Transcript
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-[280px]">{meeting.meeting_id}</p>
            {meeting.context && <p className="text-xs text-gray-500 mt-0.5 font-medium truncate">{meeting.context}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4 min-h-0">

          {/* Format spec */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 sm:p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-bold">i</span>
              </div>
              <p className="text-xs font-semibold text-blue-800">Required format — one JSON object per line</p>
            </div>
            <div className="bg-blue-900/10 rounded-lg p-2 overflow-x-auto">
              <code className="text-xs font-mono text-blue-900 whitespace-nowrap">
                {`{"speaker":"SPEAKER_00","speaker_name":"","start":1.027,"end":12.5,"text":"Spoken text here"}`}
              </code>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs">
              {[
                { field: "speaker", type: "string", eg: "SPEAKER_00" },
                { field: "speaker_name", type: "string", eg: "John (optional)" },
                { field: "start",   type: "number", eg: "1.027 (sec)"  },
                { field: "end",     type: "number", eg: "12.5 (sec)"   },
                { field: "text",    type: "string", eg: "Spoken words" },
              ].map(f => (
                <div key={f.field} className="bg-white rounded-lg px-2 py-1.5 border border-blue-100">
                  <p className="font-mono font-semibold text-blue-800">{f.field}</p>
                  <p className="text-blue-500">{f.type} — {f.eg}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Language + stats row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Language</label>
              <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="en"
                className="w-16 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 text-center" />
            </div>
            <span className="text-xs text-gray-400">{segmentCount} segment{segmentCount !== 1 ? "s" : ""}</span>
            <button onClick={insertExample}
              className="ml-auto text-xs text-indigo-500 hover:text-indigo-700 hover:underline font-medium">
              Insert example
            </button>
          </div>

          {/* Speaker Name Mappings */}
          {detectedSpeakers.length > 0 && (
            <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 sm:p-4 space-y-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-purple-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-purple-800">Speaker Name Mapping (Optional)</p>
                <p className="text-xs text-purple-500 ml-auto">{detectedSpeakers.length} speaker{detectedSpeakers.length > 1 ? "s" : ""} detected</p>
              </div>
              <p className="text-xs text-purple-600">Map speaker labels to real names. Leave empty to keep the original label.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {detectedSpeakers.map((speaker) => (
                  <div key={speaker} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-purple-100">
                    <span className="font-mono text-xs font-semibold text-purple-700 flex-shrink-0 w-28 truncate">{speaker}</span>
                    <span className="text-purple-300 text-xs flex-shrink-0">→</span>
                    <input
                      type="text"
                      value={speakerNames[speaker] || ""}
                      onChange={(e) => setSpeakerNames(prev => ({ ...prev, [speaker]: e.target.value }))}
                      placeholder={`Name for ${speaker}`}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder-gray-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="relative">
            <textarea
              value={segmentsRaw}
              onChange={e => { setSegmentsRaw(e.target.value); setParseError(""); setPreview(null); updateDetectedSpeakers(e.target.value); }}
              rows={12}
              spellCheck={false}
              placeholder={
                `{"speaker":"SPEAKER_00","speaker_name":"","start":0.0,"end":12.5,"text":"Hello everyone."}\n` +
                `{"speaker":"SPEAKER_01","speaker_name":"","start":12.6,"end":28.0,"text":"Thank you."}`
              }
              className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none bg-gray-50 text-gray-800 placeholder-gray-300"
            />
            {/* Line counter overlay hint */}
            <div className="absolute bottom-2 right-2 text-xs text-gray-300 font-mono pointer-events-none select-none">
              {segmentCount} lines
            </div>
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Validation Error</p>
                <p className="mt-0.5">{parseError}</p>
              </div>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="rounded-xl border border-green-100 bg-green-50 p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Valid — {preview.length} segment{preview.length !== 1 ? "s" : ""} parsed
                </p>
                <button onClick={() => setPreview(null)} className="text-green-400 hover:text-green-600">
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {preview.slice(0, 5).map((seg, i) => {
                  // Use the speaker_name from the parsed segment, or fall back to speaker_names state, or just the speaker label
                  const displayName = seg.speaker_name || speakerNames[seg.speaker] || seg.speaker;
                  return (
                    <div key={i} className="flex items-start gap-2.5 bg-white rounded-lg px-3 py-2 border border-green-100 text-xs">
                      <span className="font-mono font-semibold text-purple-700 flex-shrink-0 pt-0.5 text-[10px]" title={seg.speaker}>{displayName}</span>
                      <span className="text-gray-400 flex-shrink-0 pt-0.5 text-[10px]">{seg.start}s–{seg.end}s</span>
                      <span className="text-gray-700 flex-1 leading-relaxed">{seg.text}</span>
                    </div>
                  );
                  })}
                  {preview.length > 5 && (
                    <p className="text-xs text-center text-green-600">… and {preview.length - 5} more segments</p>
                  )}
                </div>
              </div>
            )}
        </div>

        {/* ── Footer ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/60 flex-shrink-0">
          <p className="text-xs text-gray-400 hidden sm:block">Saves as structured array — never plain text.</p>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={handlePreview}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 border border-gray-200 rounded-xl text-xs font-medium text-gray-600 hover:bg-white hover:border-gray-300 transition-colors">
              <CheckCircle2 className="h-3.5 w-3.5" /> Validate
            </button>
            <button onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-white text-gray-600 transition-colors font-medium">
              Cancel
            </button>
            <button onClick={handleSave} disabled={updateMutation.isPending}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm">
              {updateMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                : <><Save className="h-3.5 w-3.5" /> Save Transcript</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Meeting Edit Modal ─────────────────────────────────────────────────────────
function MeetingEditModal({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: AdminMeeting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [context, setContext] = useState(meeting.context || "");
  const [attendees, setAttendees] = useState(meeting.attendees?.join(", ") || "");
  const [attendeeError, setAttendeeError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, any>) =>
      meetingsApi.update(meeting.meeting_id, payload, true),
    onSuccess: () => {
      toast.success("Meeting details updated successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to update meeting");
      setIsSaving(false);
    },
  });

  const handleSave = () => {
    // Validate attendees
    const attendeeList = attendees
      .split(",")
      .map(a => a.trim())
      .filter(a => a.length > 0);

    if (attendeeList.length === 0) {
      setAttendeeError("At least one attendee is required");
      return;
    }

    if (attendeeList.length > 50) {
      setAttendeeError("Maximum 50 attendees allowed");
      return;
    }

    setAttendeeError("");
    setIsSaving(true);

    const payload = {
      context: context.trim() || "Untitled Meeting",
      attendees: attendeeList,
      no_of_persons: attendeeList.length,
    };

    updateMutation.mutate(payload);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-indigo-600" />
              Edit Meeting Details
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-[280px]">{meeting.meeting_id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 min-h-0">

          {/* Meeting Title / Context */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Meeting Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g., Weekly Team Standup, Q3 Planning Meeting"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              maxLength={500}
            />
            <p className="text-xs text-gray-400 mt-1">{context.length}/500 characters</p>
          </div>

          {/* Attendees */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Attendees <span className="text-red-500">*</span>
            </label>
            <textarea
              value={attendees}
              onChange={(e) => {
                setAttendees(e.target.value);
                setAttendeeError("");
              }}
              placeholder="Enter names separated by commas&#10;e.g., John Doe, Jane Smith, Bob Wilson"
              rows={4}
              className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none ${
                attendeeError ? "border-red-300 bg-red-50" : "border-gray-200"
              }`}
            />
            {attendeeError ? (
              <p className="text-xs text-red-500 mt-1">{attendeeError}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">
                {attendees.split(",").filter(a => a.trim()).length} attendee(s) • Separate names with commas
              </p>
            )}
          </div>

          {/* Read-only info */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Meeting Information</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Meeting Date:</span>
                <p className="text-gray-700 font-medium">
                  {meeting.date_time ? formatIST(meeting.date_time, "full") : "—"}
                </p>
              </div>
              <div>
                <span className="text-gray-400">Status:</span>
                <p className="text-gray-700 font-medium">{meeting.status}</p>
              </div>
              <div>
                <span className="text-gray-400">Created:</span>
                <p className="text-gray-700 font-medium">
                  {format(new Date(meeting.created_at), "MMM d, yyyy")}
                </p>
              </div>
              <div>
                <span className="text-gray-400">User ID:</span>
                <p className="text-gray-700 font-mono text-xs">{meeting.user_id.slice(0, 12)}...</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/60 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Single meeting card ───────────────────────────────────────────────────────
function MeetingRow({
  meeting,
  highlighted,
  onDeleted,
}: {
  meeting: AdminMeeting;
  highlighted: boolean;
  onDeleted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded,       setExpanded]       = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showEdit,       setShowEdit]       = useState(false);
  const [confirmDel,     setConfirmDel]     = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Auto-scroll into view when highlighted
  if (highlighted && rowRef.current) {
    setTimeout(() => rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  }

  const deleteMutation = useMutation({
    mutationFn: () => meetingsApi.delete(meeting.meeting_id),
    onSuccess: () => {
      toast.success("Meeting deleted");
      setConfirmDel(false);
      onDeleted(meeting.meeting_id);
      queryClient.invalidateQueries({ queryKey: ["admin-transcripts", "admin-stats"] });
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  // Prefetch the audio URL so it's ready when the user clicks download
  const { data: audioUrlData } = useQuery({
    queryKey: ["audio-url", meeting.meeting_id],
    queryFn: async () => {
      const res = await meetingsApi.audioUrl(meeting.meeting_id);
      return res.data?.audio_url as string | undefined;
    },
    enabled: !!meeting.audio_s3_key,
    staleTime: 10 * 60 * 1000,
  });

  const handleDownload = () => {
    let url = audioUrlData;
    if (!url) { toast.error("Audio URL not available yet — try again in a moment"); return; }

    // Production fix: avoid mixed-content blocking (HTTPS app + HTTP download URL).
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
      url = `https://${url.slice("http://".length)}`;
    }

    // Trigger download without popups/new tabs or async fetching.
    // Relies on the backend returning Content-Disposition: attachment.
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isProcessed = meeting.status === "transcript_ready";
  const transcriptSegments = (() => {
    const t = meeting.transcript as any;
    if (!t) return 0;
    if (Array.isArray(t.text)) return t.text.length;
    return t.text ? 1 : 0;
  })();

  return (
    <>
      {showTranscript && (
        <TranscriptEditModal
          meeting={meeting}
          onClose={() => setShowTranscript(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] })}
        />
      )}
      {showEdit && (
        <MeetingEditModal
          meeting={meeting}
          onClose={() => setShowEdit(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] })}
        />
      )}

      <div
        ref={rowRef}
        className={`rounded-2xl border transition-all duration-200 overflow-hidden
          ${highlighted ? "border-indigo-300 ring-2 ring-indigo-200 shadow-md shadow-indigo-50" : "border-gray-150 hover:border-gray-250 hover:shadow-sm"}
          bg-white`}
      >
        {/* ── Status accent bar ── */}
        <div className={`h-0.5 w-full ${isProcessed ? "bg-green-400" : "bg-amber-300"}`} />

        {/* ── Main content ── */}
        <div className="p-4 sm:p-5">
          {/* Top row: title + badges + actions */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Title */}
              <p className="text-sm font-semibold text-gray-900 leading-snug truncate">
                {meeting.context || <span className="text-gray-400 italic font-normal">Untitled Meeting</span>}
              </p>
              {/* Meeting ID */}
              <p className="font-mono text-[10px] text-gray-400 mt-0.5 truncate">{meeting.meeting_id}</p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => setShowEdit(true)} title="Edit meeting details"
                className="p-2 rounded-xl hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors">
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setShowTranscript(true)} title="Edit transcript"
                className="p-2 rounded-xl hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors">
                <FileText className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleDownload} disabled={!audioUrlData}
                title={audioUrlData ? "Download audio" : "Loading audio URL…"}
                className="p-2 rounded-xl hover:bg-blue-50 text-gray-400 hover:text-blue-500 disabled:opacity-30 transition-colors">
                <Download className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setConfirmDel(true)} title="Delete"
                className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setExpanded(!expanded)} title="Details"
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Badge row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <StatusPill label={meeting.status} />
            {meeting.rag_indexed
              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-100"><CheckCircle2 className="h-2.5 w-2.5" />AI Ready</span>
              : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-50 text-gray-500 border border-gray-200"><Clock className="h-2.5 w-2.5" />Not Indexed</span>
            }
            {meeting.audio_state === "chunked" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200"><AlertCircle className="h-2.5 w-2.5" />Chunked</span>
            )}
            {transcriptSegments > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100">
                <FileText className="h-2.5 w-2.5" />{meeting.transcript?.word_count || 0}w · {transcriptSegments} seg
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2.5 text-[11px] text-gray-400">
            <span>User: <span className="font-mono text-gray-500">{meeting.user_id.slice(0, 8)}…</span></span>
            <span>Created: <span className="text-gray-500">{format(new Date(meeting.created_at), "MMM d, yyyy")}</span></span>
            {meeting.date_time && <span>Meeting: <span className="text-gray-500">{formatIST(meeting.date_time, "date")}</span></span>}
          </div>
        </div>

        {/* ── Expanded detail panel ── */}
        {expanded && (
          <div className="border-t border-gray-100 bg-gray-50/70 px-4 sm:px-5 py-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Full Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Meeting ID",   value: meeting.meeting_id,  mono: true  },
                { label: "User ID",      value: meeting.user_id,     mono: true  },
                { label: "Status",       value: meeting.status,      mono: false },
                { label: "Audio State",  value: meeting.audio_state || "—", mono: false },
                { label: "RAG Indexed",  value: meeting.rag_indexed ? `Yes${meeting.rag_indexed_at ? " · " + format(new Date(meeting.rag_indexed_at), "MMM d, h:mm a") : ""}` : "No", mono: false },
                { label: "Attendees",    value: meeting.attendees?.join(", ") || "—", mono: false },
                { label: "Meeting Date", value: meeting.date_time ? formatIST(meeting.date_time, "full") : "—", mono: false },
                { label: "Updated",      value: format(new Date(meeting.updated_at), "MMM d, yyyy h:mm a"), mono: false },
              ].map(({ label, value, mono }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                  <p className={`text-xs text-gray-700 truncate ${mono ? "font-mono" : ""}`}>{value}</p>
                </div>
              ))}
            </div>
            {/* Transcript link */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowEdit(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-xl text-xs font-medium hover:bg-amber-700 transition-colors">
                <Edit2 className="h-3 w-3" />
                Edit Details
              </button>
              <button onClick={() => setShowTranscript(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-medium hover:bg-indigo-700 transition-colors">
                <FileText className="h-3 w-3" />
                {transcriptSegments > 0 ? `Edit Transcript (${transcriptSegments} segments)` : "Add Transcript"}
              </button>
              {transcriptSegments === 0 && (
                <span className="text-xs text-gray-400">No transcript yet</span>
              )}
            </div>
          </div>
        )}

        {/* ── Delete confirm ── */}
        {confirmDel && (
          <ConfirmDialog
            danger
            message={`Delete "${meeting.context || meeting.meeting_id}"? This removes the audio and Qdrant vectors permanently.`}
            onConfirm={() => deleteMutation.mutate()}
            onCancel={() => setConfirmDel(false)}
          />
        )}
      </div>
    </>
  );
}

// ── Stuck-chunked meetings section ────────────────────────────────────────────
function StuckChunkedSection() {
  const queryClient = useQueryClient();
  const [mergeAllProgress, setMergeAllProgress] = useState<{ current: number; total: number; failed: number } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-chunked-audio"],
    queryFn: async () => {
      const res = await adminApi.chunkedMeetings(1, 200);
      return res.data as { data: AdminMeeting[]; meta: { total: number } };
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (meetingId: string) =>
      apiClient.post(`/api/v1/meetings/${meetingId}/merge-chunks`),
    onSuccess: (_, meetingId) => {
      toast.success(`Chunks merged for ${meetingId}`);
      // Immediately remove from the "chunked" list, then refetch to stay consistent
      queryClient.setQueryData(
        ["admin-chunked-audio"],
        (prev: { data: AdminMeeting[]; meta?: { total?: number } } | undefined) => {
          if (!prev) return prev;
          const nextData = prev.data.filter((m) => m.meeting_id !== meetingId);
          const nextTotal =
            typeof prev.meta?.total === "number" ? Math.max(0, prev.meta.total - 1) : prev.meta?.total;
          return { ...prev, data: nextData, meta: { ...prev.meta, total: nextTotal } };
        },
      );
      queryClient.invalidateQueries({ queryKey: ["admin-chunked-audio"] });
      queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] });
    },
    onError: (e: any) => toast.error(e.message || "Merge failed"),
  });

  const handleMergeAll = async () => {
    const ids = (data?.data || [])
      .filter((m) => m.audio_state === "chunked")
      .map((m) => m.meeting_id);
    if (ids.length === 0) return;
    const progress = { current: 0, total: ids.length, failed: 0 };
    setMergeAllProgress({ ...progress });
    for (const id of ids) {
      progress.current++;
      setMergeAllProgress({ ...progress });
      try {
        await apiClient.post(`/api/v1/meetings/${id}/merge-chunks`);
        // Optimistically remove as we go so the UI updates even before refetch.
        queryClient.setQueryData(
          ["admin-chunked-audio"],
          (prev: { data: AdminMeeting[]; meta?: { total?: number } } | undefined) => {
            if (!prev) return prev;
            const nextData = prev.data.filter((m) => m.meeting_id !== id);
            const nextTotal =
              typeof prev.meta?.total === "number" ? Math.max(0, prev.meta.total - 1) : prev.meta?.total;
            return { ...prev, data: nextData, meta: { ...prev.meta, total: nextTotal } };
          },
        );
      } catch {
        progress.failed++;
        setMergeAllProgress({ ...progress });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["admin-chunked-audio"] });
    queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] });
    if (progress.failed === 0) {
      toast.success(`All ${progress.total} meetings merged successfully`);
    } else {
      toast.error(`${progress.total - progress.failed} merged, ${progress.failed} failed`);
    }
    setMergeAllProgress(null);
  };

  const meetings = (data?.data || []).filter((m) => m.audio_state === "chunked");
  const total    = meetings.length;
  const isMergingAll = mergeAllProgress !== null;

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-orange-100 flex items-center justify-center">
            <GitMerge className="h-3.5 w-3.5 text-orange-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              Stuck Audio — Needs Merge
              {total > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 rounded-full border border-orange-200">{total}</span>
              )}
            </h3>
            <p className="text-xs text-gray-400">Audio was uploaded in chunks but never merged</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {meetings.length > 0 && (
            <button
              onClick={handleMergeAll}
              disabled={isMergingAll || mergeMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              {isMergingAll
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Merging {mergeAllProgress.current}/{mergeAllProgress.total}…</>
                : <><GitMerge className="h-3 w-3" /> Merge All ({meetings.length})</>
              }
            </button>
          )}
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {/* Merge-all progress banner */}
      {isMergingAll && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-xl">
          <div className="flex items-center gap-2 text-sm text-orange-800 font-medium mb-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Merging meeting {mergeAllProgress.current} of {mergeAllProgress.total}…
            {mergeAllProgress.failed > 0 && <span className="text-red-600">({mergeAllProgress.failed} failed)</span>}
          </div>
          <div className="w-full bg-orange-200 rounded-full h-1.5">
            <div className="bg-orange-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(mergeAllProgress.current / mergeAllProgress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-gray-400 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Checking…</span>
        </div>
      ) : meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
            <CheckSquare className="h-5 w-5 text-green-500" />
          </div>
          <p className="text-sm font-medium text-gray-600">All Clear</p>
          <p className="text-xs text-gray-400 mt-0.5">No stuck chunked meetings — all audio is fully merged.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map(m => (
            <div key={m.meeting_id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-orange-50 border border-orange-200 rounded-2xl">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-orange-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <AlertCircle className="h-4 w-4 text-orange-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{m.context || "Untitled Meeting"}</p>
                    <p className="text-xs text-gray-500 font-mono truncate">{m.meeting_id}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Created {format(new Date(m.created_at), "MMM d, yyyy · h:mm a")}</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => mergeMutation.mutate(m.meeting_id)}
                disabled={isMergingAll || (mergeMutation.isPending && mergeMutation.variables === m.meeting_id)}
                className="self-end sm:self-auto flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {mergeMutation.isPending && mergeMutation.variables === m.meeting_id
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Merging…</>
                  : <><GitMerge className="h-3 w-3" /> Merge Chunks</>
                }
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Transcripts Panel ────────────────────────────────────────────────────
function TranscriptsPanel() {
  const queryClient = useQueryClient();
  const [page,              setPage]              = useState(1);
  const [search,            setSearch]            = useState("");
  const [highlightedId,     setHighlightedId]     = useState<string | null>(null);
  const [deletedIds,        setDeletedIds]        = useState<Set<string>>(new Set());
  const [indexResult,       setIndexResult]       = useState<any>(null);
  const [nextPendingResult, setNextPendingResult] = useState<NextPendingData | null>(null);

  // ── Fetch all meetings ────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-transcripts", page],
    queryFn: async () => {
      const res = await adminApi.meetings(page, 100);
      return res.data as { data: AdminMeeting[]; meta: { total: number } };
    },
  });

  // ── Index unindexed ───────────────────────────────────────────────────────
  const indexMutation = useMutation({
    mutationFn: () => adminApi.indexUnindexed(),
    onSuccess: (res) => {
      setIndexResult(res.data);
      const { indexed, failed } = res.data.summary;
      if (failed > 0) toast.error(`${indexed} indexed, ${failed} failed`);
      else if (indexed === 0) toast("All meetings already indexed ✅");
      else toast.success(`${indexed} meeting${indexed > 1 ? "s" : ""} indexed`);
      queryClient.invalidateQueries({ queryKey: ["admin-transcripts"] });
    },
    onError: (e: any) => toast.error(e.message || "Indexing failed"),
  });

  // ── Next pending ──────────────────────────────────────────────────────────
  const nextPendingMutation = useMutation({
    mutationFn: () => adminApi.nextPending(),
    onSuccess: (res) => {
      const meeting = res.data?.data;
      if (!meeting) {
        toast("No meetings pending processing ✅");
        setNextPendingResult(null);
      } else {
        setNextPendingResult(meeting);
        setHighlightedId(meeting.meeting_id);
        toast.success(`Next pending: ${meeting.meeting_id}`);
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to fetch next pending"),
  });

  // ── Sort: unprocessed first, processed second ─────────────────────────────
  const allMeetings = (data?.data || []).filter(m => !deletedIds.has(m.meeting_id));
  const filtered    = search
    ? allMeetings.filter(m =>
        m.meeting_id.toLowerCase().includes(search.toLowerCase()) ||
        m.context?.toLowerCase().includes(search.toLowerCase()) ||
        m.user_id.toLowerCase().includes(search.toLowerCase())
      )
    : allMeetings;

  const unprocessed = filtered.filter(m => m.status !== "transcript_ready");
  const processed   = filtered.filter(m => m.status === "transcript_ready");
  const total       = data?.meta?.total || 0;

  return (
    <div>
      {/* ── Global actions bar ── */}
      <div className="flex flex-col gap-3 mb-6 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
        {/* Search row - full width on mobile */}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by meeting name, ID or user…"
            className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
        </div>
        {/* Action buttons row */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => nextPendingMutation.mutate()}
            disabled={nextPendingMutation.isPending}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs sm:text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
          >
            {nextPendingMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching…</>
              : <><Play className="h-3.5 w-3.5" /> Next Pending</>
            }
          </button>

          {/* <button
            onClick={() => { setIndexResult(null); indexMutation.mutate(); }}
            disabled={indexMutation.isPending}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-teal-600 text-white rounded-xl text-xs sm:text-sm font-medium hover:bg-teal-700 disabled:opacity-60 transition-colors shadow-sm"
          >
            {indexMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Indexing…</>
              : <><Zap className="h-3.5 w-3.5" /> Index Unindexed</>
            }
          </button> */}

          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs sm:text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* ── Next pending result banner ── */}
      {nextPendingResult && (
        <div className="mb-5 p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-indigo-800 flex items-center gap-2">
              <Play className="h-3.5 w-3.5 flex-shrink-0" /> Next Meeting to Process
            </p>
            <p className="text-xs text-indigo-700 mt-1 font-mono truncate">{nextPendingResult.meeting_id}</p>
            <p className="text-xs text-indigo-600 mt-0.5 truncate">{nextPendingResult.context} · Audio: {nextPendingResult.audio_state}</p>
          </div>
          <button onClick={() => { setNextPendingResult(null); setHighlightedId(null); }}
            className="text-indigo-400 hover:text-indigo-600 flex-shrink-0 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Index result banner ── */}
      {indexResult && !indexMutation.isPending && (
        <div className="mb-5 p-4 bg-teal-50 border border-teal-200 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-teal-800">{indexResult.message}</p>
            <button onClick={() => setIndexResult(null)} className="text-teal-400 hover:text-teal-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { l: "Found",   v: indexResult.summary.total_found, c: "gray"  },
              { l: "Indexed", v: indexResult.summary.indexed,     c: "green" },
              { l: "Skipped", v: indexResult.summary.skipped,     c: "amber" },
              { l: "Failed",  v: indexResult.summary.failed,      c: "red"   },
            ].map(({ l, v, c }) => (
              <div key={l} className={`rounded-xl p-3 text-center bg-${c}-50 border border-${c}-100`}>
                <p className={`text-xl font-bold text-${c}-700`}>{v}</p>
                <p className={`text-xs text-${c}-500 mt-0.5`}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
          <p className="text-sm">Loading meetings…</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ── Section 1: Unprocessed ── */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  Pending / Unprocessed
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full border border-amber-200">{unprocessed.length}</span>
                </h3>
                <p className="text-xs text-gray-400">Awaiting audio upload or transcription</p>
              </div>
            </div>
            {unprocessed.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                  <CheckSquare className="h-5 w-5 text-green-500" />
                </div>
                <p className="text-sm font-medium text-gray-600">All Caught Up</p>
                <p className="text-xs text-gray-400 mt-0.5">No pending meetings to process.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {unprocessed.map(m => (
                  <MeetingRow key={m.meeting_id} meeting={m}
                    highlighted={highlightedId === m.meeting_id}
                    onDeleted={id => setDeletedIds(prev => { const s = new Set(Array.from(prev)); s.add(id); return s; })} />
                ))}
              </div>
            )}
          </div>

          {/* ── Section 2: Processed ── */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-xl bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  Transcript Ready
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-green-100 text-green-700 rounded-full border border-green-200">{processed.length}</span>
                </h3>
                <p className="text-xs text-gray-400">Transcription complete — ready for AI indexing and chat</p>
              </div>
            </div>
            {processed.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
                <p className="text-sm text-gray-400">No processed meetings yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {processed.map(m => (
                  <MeetingRow key={m.meeting_id} meeting={m}
                    highlighted={highlightedId === m.meeting_id}
                    onDeleted={id => setDeletedIds(prev => { const s = new Set(Array.from(prev)); s.add(id); return s; })} />
                ))}
              </div>
            )}
          </div>

          {/* ── Pagination ── */}
          {total > 100 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-2 rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm text-gray-600 font-medium">Page {page} <span className="text-gray-400 font-normal">of {Math.ceil(total / 100)}</span></span>
              <button onClick={() => setPage(p => p + 1)} disabled={(data?.data || []).length < 100}
                className="p-2 rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: Stuck chunked ── */}
      <StuckChunkedSection />
    </div>
  );
}


// ─── Error Logs Panel ─────────────────────────────────────────────────────────

interface ErrorLog {
  id:                 string;
  timestamp:          string;
  exception_type:     string;
  message:            string;
  module:             string;
  function:           string;
  file_path:          string;
  line_number:        number;
  traceback:          string;
  has_full_traceback?: boolean;
  request_method:     string | null;
  request_path:       string | null;
  status_code:        number | null;
  user_id:            string | null;
  user_email:         string | null;
  source:             string;
  context:            Record<string, unknown>;
}

function ErrorLogDetailModal({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-error-log-detail", logId],
    queryFn: async () => {
      const res = await adminApi.errorLogDetail(logId);
      return res.data.data as ErrorLog;
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Error Detail</h3>
          <button onClick={onClose}>
            <X className="h-5 w-5 text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        {isLoading || !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p><span className="font-medium">Type:</span> {data.exception_type} — {data.message}</p>
            <p><span className="font-medium">Location:</span> {data.file_path}:{data.line_number} ({data.module}.{data.function})</p>
            <p><span className="font-medium">Source:</span> {data.source}</p>
            {data.request_path && (
              <p><span className="font-medium">Request:</span> {data.request_method} {data.request_path} → {data.status_code ?? "—"}</p>
            )}
            {data.user_email && <p><span className="font-medium">User:</span> {data.user_email}</p>}
            {data.context && Object.keys(data.context).length > 0 && (
              <p><span className="font-medium">Context:</span> {JSON.stringify(data.context)}</p>
            )}
            <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">{data.traceback}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorLogsPanel() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-error-logs", page, search, moduleFilter],
    queryFn: async () => {
      const res = await adminApi.errorLogs(page, 50, {
        search: search || undefined,
        module: moduleFilter || undefined,
      });
      return res.data as { data: ErrorLog[]; meta: { total: number } };
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (logId: string) => adminApi.deleteErrorLog(logId),
    onSuccess: () => {
      toast.success("Error log deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-error-logs"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete error log"),
  });

  const clearMutation = useMutation({
    mutationFn: () => adminApi.clearErrorLogs(),
    onSuccess: () => {
      toast.success("Error logs cleared");
      queryClient.invalidateQueries({ queryKey: ["admin-error-logs"] });
      setConfirmClear(false);
    },
    onError: (e: any) => toast.error(e.message || "Failed to clear logs"),
  });

  const logs = data?.data || [];
  const total = data?.meta?.total || 0;

  return (
    <div>
      {confirmClear && (
        <ConfirmDialog
          danger
          message="Clear ALL captured error logs? This cannot be undone."
          onConfirm={() => clearMutation.mutate()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
      {detailId && <ErrorLogDetailModal logId={detailId} onClose={() => setDetailId(null)} />}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text" placeholder="Search message…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <input
          type="text" placeholder="Filter by module…" value={moduleFilter}
          onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-48"
        />
        <p className="text-sm text-gray-500">{total} total errors</p>
        <button
          onClick={() => setConfirmClear(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear all
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Message</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log.id} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {log.timestamp ? format(new Date(log.timestamp), "MMM d, HH:mm:ss") : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <p className="font-medium">{log.module}.{log.function}</p>
                    <p className="text-xs text-gray-400">{log.file_path}:{log.line_number}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={log.message}>
                    {log.exception_type}: {log.message}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{log.source}</span>
                  </td>
                  <td className="px-4 py-3">{log.status_code ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setDetailId(log.id)}
                        title="View traceback"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(log.id)}
                        title="Delete"
                        className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No errors captured</p>}
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded border disabled:opacity-40 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-600">Page {page}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={logs.length < 50} className="p-1.5 rounded border disabled:opacity-40 hover:bg-gray-50">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

type AdminTab = "stats" | "users" | "system" | "indexing" | "transcripts" | "logs";

export default function AdminPage() {
  const { data: session } = useSession() as any;
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>("stats");

  if (session && session.role !== "admin") {
    router.replace("/dashboard");
    return null;
  }

  const currentUserId = session?.user_id || "";

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-amber-500 flex-shrink-0" />
          Admin Panel
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Platform-wide management. Changes take effect immediately.
        </p>
      </div>

      <div className="flex gap-0 mb-6 border-b border-gray-200 overflow-x-auto -mx-1 px-1">
        {(
          [
            { key: "stats",       label: "Stats",       icon: BarChart3 },
            { key: "users",       label: "Users",       icon: Users     },
            { key: "transcripts", label: "Transcripts", icon: FileText  },
            { key: "system",      label: "System",      icon: Settings  },
            { key: "indexing",    label: "RAG Index",   icon: Database  },
            { key: "logs",        label: "Error Logs",  icon: AlertCircle },
          ] as { key: AdminTab; label: string; icon: any }[]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
              tab === key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.split(" ")[0]}</span>
          </button>
        ))}
      </div>

      {tab === "stats"       && <AdminStatsPanel />}
      {tab === "users"       && <UsersTable currentUserId={currentUserId} />}
      {tab === "transcripts" && <TranscriptsPanel />}
      {tab === "system"      && <><StorageConfigPanel /><BotSetupCard /></>}
      {tab === "indexing"    && <RagIndexingPanel />}
      {tab === "logs"        && <ErrorLogsPanel />}
    </div>
  );
}