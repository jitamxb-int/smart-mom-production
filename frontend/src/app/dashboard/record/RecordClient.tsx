"use client";

/**
 * Record Meeting Page — Chunk Upload Mode Only
 *
 * Key fixes applied:
 * 1. Chunk merge race condition: all in-flight uploads are tracked via a
 *    Promise set; merge only fires once every pending upload resolves.
 * 2. Correct API endpoint: POST /api/v1/meetings/{meeting_id}/chunks
 * 3. Full recording mode removed (commented block at bottom of file).
 * 4. Offline recording: audio chunks are queued in the Origin Private File
 *    System (OPFS) with sync metadata in IndexedDB, then uploaded and merged
 *    automatically when the browser reconnects.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { meetingsApi } from "@/lib/api";
import { getCurrentISTISO } from "@/lib/dateUtils";
import {
  savePendingChunk, updatePendingChunkStatus, deletePendingChunk,
  getPendingChunksForMeeting, getAllPendingChunks,
  savePendingMeeting, getPendingMeeting, markPendingMeetingCreated,
  deletePendingMeeting, getAllPendingMeetings,
  type PendingChunk, type PendingMeeting,
} from "@/lib/offlineQueue";
import {
  writeChunkFile, readChunkFile, deleteChunkFile, deleteMeetingChunks, isOpfsAvailable,
} from "@/lib/opfsChunks";
import { useAppSelector } from "@/store/hooks";
import toast from "react-hot-toast";
import {
  Mic, Square, Loader2, CheckCircle2, AlertCircle, LogOut,
  Play, Pause, Layers, CloudUpload, CheckCheck,
  WifiOff, Wifi, RefreshCw, ArrowRight, Sparkles, LayoutDashboard,
  Bot, ExternalLink,
} from "lucide-react";

type RecordState =
  | "idle" | "recording" | "paused" | "merging" | "done" | "error";

interface MeetingMeta {
  context: string; attendees: string; no_of_persons: string; meet_url: string;
}
interface ChunkStatus {
  chunk_id: number;
  status:   "pending" | "uploading" | "done" | "failed" | "cached";
  size_bytes: number;
}

/** Maximum audio duration per chunk, in seconds. */
function getChunkDurationSeconds(): number {
  const seconds = parseInt(process.env.NEXT_PUBLIC_CHUNK_DURATION_SECONDS || "", 10);
  if (seconds > 0) return seconds;

  // Backwards compatibility with the old millisecond setting.
  const ms = parseInt(process.env.NEXT_PUBLIC_CHUNK_INTERVAL_MS || "", 10);
  if (ms > 0) return Math.max(1, Math.round(ms / 1000));

  return 30;
}

const CHUNK_DURATION_SECONDS = getChunkDurationSeconds();

/** Axios network/timeout failures have no HTTP response attached. */
function isNetworkError(err: any): boolean {
  return !err?.response;
}

function formatTime(sec: number) {
  return `${Math.floor(sec/60).toString().padStart(2,"0")}:${(sec%60).toString().padStart(2,"0")}`;
}
function getMimeType() {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "audio/ogg";
}
function validateMeta(meta: MeetingMeta, setError: (e: string) => void): boolean {
  if (!meta.context.trim()) { setError("Meeting title / context is required."); return false; }
  const list = meta.attendees.split(",").map(a => a.trim()).filter(Boolean);
  if (!list.length) { setError("Enter at least one attendee."); return false; }
  const np = parseInt(meta.no_of_persons);
  if (isNaN(np) || np < 1) { setError("Number of persons must be at least 1."); return false; }
  if (np !== list.length) { setError(`No. of persons (${np}) must match attendees count (${list.length}).`); return false; }
  setError(""); return true;
}

function MetaForm({ meta, onChange, disabled, metaError, audioDevices, selectedDeviceId, onDeviceChange }: {
  meta: MeetingMeta; onChange: (m: MeetingMeta) => void;
  disabled: boolean; metaError: string;
  audioDevices: MediaDeviceInfo[]; selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Meeting Title / Context <span className="text-red-500">*</span>
        </label>
        <input type="text" value={meta.context} disabled={disabled}
          onChange={e => onChange({ ...meta, context: e.target.value })}
          placeholder="e.g. Q3 Product Review"
          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Attendees <span className="text-gray-400 font-normal">(comma-separated)</span> <span className="text-red-500">*</span>
        </label>
        <input type="text" value={meta.attendees} disabled={disabled}
          onChange={e => {
            const val = e.target.value;
            const cnt = val.split(",").map(a => a.trim()).filter(Boolean).length;
            onChange({ ...meta, attendees: val, no_of_persons: cnt > 0 ? String(cnt) : meta.no_of_persons });
          }}
          placeholder="Alice, Bob, Charlie"
          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Number of Persons <span className="text-red-500">*</span>
        </label>
        <input type="number" min={1} value={meta.no_of_persons} disabled={disabled}
          onChange={e => onChange({ ...meta, no_of_persons: e.target.value })}
          className="w-28 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Microphone <span className="text-gray-400 font-normal">(used for local recording)</span>
        </label>
        <select
          value={selectedDeviceId}
          disabled={disabled || audioDevices.length === 0}
          onChange={e => onDeviceChange(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
        >
          {audioDevices.length === 0 && <option value="">No microphone detected</option>}
          {audioDevices.map((device, index) => (
            <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Google Meet URL <span className="text-gray-400 font-normal">(optional — bot joins automatically)</span>
        </label>
        <div className="flex">
          <span className="inline-flex items-center px-3.5 py-2.5 border border-r-0 border-gray-200 rounded-l-xl bg-gray-50 text-sm text-gray-500 font-mono">
            https://
          </span>
          <input type="text" value={meta.meet_url.replace(/^https?:\/\//, '')} disabled={disabled}
            onChange={e => onChange({ ...meta, meet_url: `https://${e.target.value.replace(/^https?:\/\//, '')}` })}
            placeholder="meet.google.com/xxx-xxxx-xxx"
            className="flex-1 border border-gray-200 rounded-r-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
        </div>
      </div>
      {metaError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {metaError}
        </div>
      )}
    </div>
  );
}

export function RecordClient(props: {
  initialRole: string;
  initialUser?: { name?: string | null; email?: string | null };
}) {
  const { initialRole, initialUser } = props;
  const router = useRouter();
  const isSimpleUser = initialRole === "user";
  const accessToken = useAppSelector(s => s.session.accessToken);

  const [state,          setState]          = useState<RecordState>("idle");
  const [elapsed,        setElapsed]        = useState(0);
  const [error,          setError]          = useState("");
  const [statusMsg,      setStatusMsg]      = useState("");
  const [chunkStatuses,  setChunkStatuses]  = useState<ChunkStatus[]>([]);
  const [isOffline,      setIsOffline]      = useState(false);
  const [globalPending,  setGlobalPending]  = useState(0);
  const [isRetrying,     setIsRetrying]     = useState(false);
  const [pendingSync,    setPendingSync]    = useState(false);
  const [chunkMeetingId, setChunkMeetingId] = useState<string | null>(null);
  const [meta,           setMeta]           = useState<MeetingMeta>({ context: "", attendees: "", no_of_persons: "", meet_url: "" });
  const [metaError,      setMetaError]      = useState("");
  const [formDone,       setFormDone]       = useState(false);
  const [audioDevices,   setAudioDevices]   = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");

  const mrRef             = useRef<MediaRecorder | null>(null);
  const chunkBlobRef         = useRef<Blob[]>([]);
  const chunkIdRef           = useRef(0);
  const chunkStartElapsedRef = useRef(0);
  const elapsedRef           = useRef(0);
  const elapsedTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const mimeTypeRef       = useRef("audio/webm");
  const isStoppingRef     = useRef(false);
  const retryTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentMeetingRef = useRef<string | null>(null);
  const isBotRef          = useRef(false);
  const [novncUrl, setNovncUrl] = useState<string | null>(null);

  const pendingUploadsRef = useRef<Set<Promise<void>>>(new Set());
  const creatingRef       = useRef<Map<string, Promise<void>>>(new Map());
  const retryingRef       = useRef(false);
  const networkErrorRef   = useRef(false);
  const networkDownRef    = useRef(false);
  const wakeLockRef = useRef<any>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as any)?.wakeLock;
      if (!wl?.request) return;
      wakeLockRef.current = await wl.request("screen");
    } catch {
      // Wake lock is best-effort; ignore failures (unsupported, denied, etc.)
    }
  }, []);
  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release?.();
    } catch {}
    wakeLockRef.current = null;
  }, []);

  const startET = () => {
    elapsedTimerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
  };
  const stopET  = () => { if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; } };

  const checkGP = useCallback(async () => {
    try {
      const all = await getAllPendingChunks();
      const f   = currentMeetingRef.current ? all.filter(c => c.meeting_id !== currentMeetingRef.current) : all;
      setGlobalPending(f.length);
    } catch {}
  }, []);

  useEffect(() => { checkGP(); const t = setInterval(checkGP, 10_000); return () => clearInterval(t); }, [checkGP]);

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs  = devices.filter(d => d.kind === "audioinput");
      setAudioDevices(inputs);
      // Keep the current choice when it still exists, otherwise pick the first.
      setSelectedDeviceId(prev => {
        if (prev && inputs.some(d => d.deviceId === prev)) return prev;
        return inputs[0]?.deviceId ?? "";
      });
    } catch {
      // Enumeration is best-effort; recording still falls back to the default device.
    }
  }, []);

  useEffect(() => {
    refreshAudioDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    md.addEventListener("devicechange", refreshAudioDevices);
    return () => md.removeEventListener("devicechange", refreshAudioDevices);
  }, [refreshAudioDevices]);

  /**
   * Creates the backend meeting record for a recording that was started while
   * offline. Safe to call more than once (409 means it already exists) and
   * de-duplicated while a request is in flight.
   */
  const ensureMeetingCreated = useCallback(async (details: PendingMeeting) => {
    const inFlight = creatingRef.current.get(details.meeting_id);
    if (inFlight) return inFlight;

    const task = (async () => {
      const { data } = await meetingsApi.presignedUpload(details.meeting_id);
      try {
        await meetingsApi.create({
          meeting_id:    details.meeting_id,
          attendees:     details.attendees,
          context:       details.context,
          no_of_persons: details.no_of_persons,
          date_time:     details.date_time,
          audio_s3_key:  data.audio_s3_key,
          audio_state:   "chunked",
          meet_link:     details.meet_url || undefined,
        });
      } catch (e: any) {
        // Another tab/sync already created it — that's fine.
        if (e?.response?.status !== 409) throw e;
      }
      await markPendingMeetingCreated(details.meeting_id);
    })();

    creatingRef.current.set(details.meeting_id, task);
    try {
      await task;
    } finally {
      creatingRef.current.delete(details.meeting_id);
    }
  }, []);

  /** Persists a chunk's audio to OPFS and its sync metadata to IndexedDB. */
  const storeChunk = useCallback(async (
    meetingId: string,
    chunkId: number,
    blob: Blob,
    mimeType: string,
  ) => {
    await writeChunkFile(meetingId, chunkId, blob, mimeType);
    try {
      await savePendingChunk({
        meeting_id: meetingId,
        chunk_id:   chunkId,
        timestamp:  new Date().toISOString(),
        size_bytes: blob.size,
        mime_type:  mimeType,
        status:     "pending",
      });
    } catch (err) {
      // Don't leave an orphan file behind if the metadata write fails.
      await deleteChunkFile(meetingId, chunkId, mimeType);
      throw err;
    }
  }, []);

  const retryCachedChunks = useCallback(async (meetingId: string): Promise<boolean> => {
    networkErrorRef.current = false;
    if (!navigator.onLine) return false;

    // A recording started offline has no backend record yet — create it first.
    try {
      const pendingMeeting = await getPendingMeeting(meetingId);
      if (pendingMeeting && !pendingMeeting.created) {
        await ensureMeetingCreated(pendingMeeting);
      }
    } catch (e: any) {
      const networkErr = isNetworkError(e);
      networkErrorRef.current = networkErr || e?.response?.status === 401;
      if (networkErr) {
        networkDownRef.current = true;
        setIsOffline(true);
      }
      return false;
    }

    let cached: PendingChunk[];
    try { cached = await getPendingChunksForMeeting(meetingId); } catch { return false; }
    if (!cached.length) return true;

    let ok = true;
    for (const c of cached.sort((a, b) => a.chunk_id - b.chunk_id)) {
      if (!navigator.onLine) return false;
      setChunkStatuses(prev => {
        const n = [...prev]; const i = n.findIndex(x => x.chunk_id === c.chunk_id);
        if (i >= 0) n[i] = { ...n[i], status: "uploading" };
        else n.push({ chunk_id: c.chunk_id, status: "uploading", size_bytes: c.size_bytes });
        return n;
      });

      const mimeType = c.mime_type || mimeTypeRef.current;

      // A previous sync uploaded this chunk but was interrupted before cleanup.
      if (c.status === "uploaded") {
        if (!c.blob) await deleteChunkFile(meetingId, c.chunk_id, mimeType);
        await deletePendingChunk(meetingId, c.chunk_id).catch(() => {});
        setChunkStatuses(prev => prev.map(x => x.chunk_id === c.chunk_id ? { ...x, status: "done" } : x));
        continue;
      }

      let blob: Blob;
      try {
        blob = c.blob ?? await readChunkFile(meetingId, c.chunk_id, mimeType);
      } catch {
        // Audio file is missing; keep the record so the meeting isn't merged
        // with incomplete audio.
        await updatePendingChunkStatus(meetingId, c.chunk_id, "failed").catch(() => {});
        setChunkStatuses(prev => prev.map(x => x.chunk_id === c.chunk_id ? { ...x, status: "failed" } : x));
        ok = false;
        continue;
      }

      try {
        await meetingsApi.uploadChunk(meetingId, blob, c.chunk_id, false, mimeType, c.timestamp);
        await updatePendingChunkStatus(meetingId, c.chunk_id, "uploaded").catch(() => {});
        if (!c.blob) await deleteChunkFile(meetingId, c.chunk_id, mimeType);
        await deletePendingChunk(meetingId, c.chunk_id).catch(() => {});
        networkDownRef.current = false;
        setIsOffline(false);
        setChunkStatuses(prev => prev.map(x => x.chunk_id === c.chunk_id ? { ...x, status: "done" } : x));
      } catch (e: any) {
        const networkErr = isNetworkError(e);
        if (networkErr || e?.response?.status === 401) networkErrorRef.current = true;
        if (networkErr) {
          networkDownRef.current = true;
          setIsOffline(true);
        }
        await updatePendingChunkStatus(meetingId, c.chunk_id, "failed").catch(() => {});
        setChunkStatuses(prev => prev.map(x => x.chunk_id === c.chunk_id ? { ...x, status: "cached" } : x));
        ok = false;
        if (networkErr) break;
      }
    }
    return ok;
  }, [ensureMeetingCreated]);

  useEffect(() => () => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (retryTimerRef.current)   clearInterval(retryTimerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    releaseWakeLock();
  }, []);

  // Keep the screen awake during active recording to prevent mobile devices from sleeping.
  useEffect(() => {
    const active = state === "recording" || state === "paused";
    if (active) requestWakeLock();
    else releaseWakeLock();
  }, [state, requestWakeLock, releaseWakeLock]);

  // Some browsers automatically release wake locks when the page is hidden.
  // If the user comes back while still recording, re-request.
  useEffect(() => {
    const onVis = () => {
      const active = state === "recording" || state === "paused";
      if (!document.hidden && active) requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [state, requestWakeLock]);

  const uploadChunkBlob = useCallback((meetingId: string, chunkId: number, blob: Blob, mimeType: string) => {
    setChunkStatuses(prev => {
      const n = [...prev]; const i = n.findIndex(c => c.chunk_id === chunkId);
      if (i >= 0) n[i] = { ...n[i], status: "uploading" };
      else n.push({ chunk_id: chunkId, status: "uploading", size_bytes: blob.size });
      return n;
    });

    const promise: Promise<void> = (async () => {
      // If the browser is offline, or a recent request failed with a network
      // error, persist locally without attempting another network call.
      if (!navigator.onLine || networkDownRef.current) {
        try {
          await storeChunk(meetingId, chunkId, blob, mimeType);
          setChunkStatuses(prev => prev.map(c => c.chunk_id === chunkId ? { ...c, status: "cached" } : c));
        } catch {
          setChunkStatuses(prev => prev.map(c => c.chunk_id === chunkId ? { ...c, status: "failed" } : c));
        }
        return;
      }

      try {
        await meetingsApi.uploadChunk(meetingId, blob, chunkId, false, mimeType);
        networkDownRef.current = false;
        setIsOffline(false);
        setChunkStatuses(prev => prev.map(c => c.chunk_id === chunkId ? { ...c, status: "done" } : c));
        await deletePendingChunk(meetingId, chunkId).catch(() => {});
        await deleteChunkFile(meetingId, chunkId, mimeType);
      } catch (err: any) {
        // A timeout or a network failure means we're effectively offline even
        // when navigator.onLine still reports true.
        if (isNetworkError(err) || err?.code === "ECONNABORTED") {
          networkDownRef.current = true;
          setIsOffline(true);
        }

        try {
          await storeChunk(meetingId, chunkId, blob, mimeType);
          setChunkStatuses(prev => prev.map(c => c.chunk_id === chunkId ? { ...c, status: "cached" } : c));
          toast.error("Upload failed. Audio is saved on this device and will retry when the connection is available.");
        } catch {
          setChunkStatuses(prev => prev.map(c => c.chunk_id === chunkId ? { ...c, status: "failed" } : c));
          toast.error("Upload and local save both failed. Keep this page open and retry before leaving.");
        }
      }
    })();

    pendingUploadsRef.current.add(promise);
    promise.finally(() => pendingUploadsRef.current.delete(promise));
  }, [storeChunk]);

  const retryAllPending = useCallback(async () => {
    if (!navigator.onLine || retryingRef.current || !accessToken) return;
    retryingRef.current = true;
    setIsRetrying(true);
    try {
      const all     = await getAllPendingChunks();
      const current = currentMeetingRef.current;
      const byMeeting = new Map<string, PendingChunk[]>();
      for (const c of all) {
        if (c.meeting_id === current) continue; // still recording
        if (!byMeeting.has(c.meeting_id)) byMeeting.set(c.meeting_id, []);
        byMeeting.get(c.meeting_id)!.push(c);
      }

      for (const [mid, chunks] of byMeeting) {
        if (!navigator.onLine) break;

        let ok = true;
        try {
          // Create the meeting if the recording started offline.
          const pendingMeeting = await getPendingMeeting(mid);
          if (pendingMeeting && !pendingMeeting.created) {
            await ensureMeetingCreated(pendingMeeting);
          }
        } catch (e: any) {
          if (isNetworkError(e)) {
            networkDownRef.current = true;
            setIsOffline(true);
          }
          ok = false;
        }

        if (ok) {
          for (const c of chunks.sort((a, b) => a.chunk_id - b.chunk_id)) {
            if (!navigator.onLine) { ok = false; break; }

            const mimeType = c.mime_type || mimeTypeRef.current;

            // A previous sync uploaded this chunk but was interrupted before cleanup.
            if (c.status === "uploaded") {
              if (!c.blob) await deleteChunkFile(mid, c.chunk_id, mimeType);
              await deletePendingChunk(mid, c.chunk_id).catch(() => {});
              continue;
            }

            let blob: Blob;
            try {
              blob = c.blob ?? await readChunkFile(mid, c.chunk_id, mimeType);
            } catch {
              await updatePendingChunkStatus(mid, c.chunk_id, "failed").catch(() => {});
              ok = false;
              break;
            }

            try {
              await meetingsApi.uploadChunk(mid, blob, c.chunk_id, false, mimeType, c.timestamp);
              await updatePendingChunkStatus(mid, c.chunk_id, "uploaded").catch(() => {});
              if (!c.blob) await deleteChunkFile(mid, c.chunk_id, mimeType);
              await deletePendingChunk(mid, c.chunk_id).catch(() => {});
            } catch (e: any) {
              if (isNetworkError(e)) {
                networkDownRef.current = true;
                setIsOffline(true);
              }
              await updatePendingChunkStatus(mid, c.chunk_id, "failed").catch(() => {});
              ok = false;
            }
          }
        }

        if (!ok || !navigator.onLine) {
          if (networkDownRef.current) break;
          continue;
        }

        try {
          await meetingsApi.mergeChunks(mid);
          await deletePendingMeeting(mid);
          await deleteMeetingChunks(mid);
          networkDownRef.current = false;
          setIsOffline(false);
          if (mid === chunkMeetingId) {
            setPendingSync(false);
            setStatusMsg("Offline recording uploaded!");
          } else {
            toast.success(`Meeting ${mid.slice(-8)} merged`);
          }
        } catch (e: any) {
          if (isNetworkError(e)) {
            networkDownRef.current = true;
            setIsOffline(true);
          }
          toast.error(`Merge failed: ${e?.message || "unknown error"}`);
        }
      }

      // Offline-started meetings that no longer have queued chunks either never
      // captured audio or already had every chunk uploaded. Clean those up and
      // retry a merge that may have been interrupted (e.g. tab closed).
      const chunkMeetingIds = new Set(all.map(c => c.meeting_id));
      const pendingMeetings = await getAllPendingMeetings();
      for (const m of pendingMeetings) {
        if (m.meeting_id === current || chunkMeetingIds.has(m.meeting_id)) continue;

        if (!m.created) {
          await deletePendingMeeting(m.meeting_id);
          await deleteMeetingChunks(m.meeting_id);
          continue;
        }

        try {
          await meetingsApi.mergeChunks(m.meeting_id);
          await deletePendingMeeting(m.meeting_id);
          await deleteMeetingChunks(m.meeting_id);
          if (m.meeting_id === chunkMeetingId) {
            setPendingSync(false);
            setStatusMsg("Offline recording uploaded!");
          }
        } catch (e: any) {
          // NO_CHUNKS means the merge already completed.
          if (e?.response?.data?.detail?.code === "NO_CHUNKS") {
            await deletePendingMeeting(m.meeting_id);
            await deleteMeetingChunks(m.meeting_id);
          }
        }
      }

      await checkGP();
    } catch {
      // Best effort — the queue is kept for the next sync attempt.
    } finally {
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }, [accessToken, checkGP, ensureMeetingCreated, chunkMeetingId]);

  const flushChunk = useCallback((meetingId: string, mimeType: string) => {
    chunkStartElapsedRef.current = elapsedRef.current;
    const blobs = [...chunkBlobRef.current]; chunkBlobRef.current = [];
    if (!blobs.length) return;
    const blob    = new Blob(blobs, { type: mimeType });
    const chunkId = chunkIdRef.current++;
    setChunkStatuses(prev => { if (prev.find(c => c.chunk_id === chunkId)) return prev; return [...prev, { chunk_id: chunkId, status: "pending", size_bytes: blob.size }]; });
    uploadChunkBlob(meetingId, chunkId, blob, mimeType);
  }, [uploadChunkBlob]);

  // Start a new chunk once the configured maximum audio duration is reached.
  useEffect(() => {
    if (state !== "recording") return;
    if (elapsed - chunkStartElapsedRef.current < CHUNK_DURATION_SECONDS) return;

    const meetingId = currentMeetingRef.current;
    if (meetingId) flushChunk(meetingId, mimeTypeRef.current);
  }, [elapsed, state, flushChunk]);

  useEffect(() => {
    const off = () => {
      networkDownRef.current = true;
      setIsOffline(true);
      // Flush the buffered audio immediately so a sudden disconnect doesn't
      // have to wait for the next chunk boundary.
      if (currentMeetingRef.current) flushChunk(currentMeetingRef.current, mimeTypeRef.current);
    };
    const on  = () => {
      networkDownRef.current = false;
      setIsOffline(false);
      if (currentMeetingRef.current) {
        // Still recording: create the record if needed and drain cached chunks,
        // but don't merge until the user stops.
        retryCachedChunks(currentMeetingRef.current);
      } else {
        // Nothing is recording — finish any meetings saved while offline.
        retryAllPending();
      }
      checkGP();
    };
    window.addEventListener("offline", off); window.addEventListener("online", on);
    networkDownRef.current = !navigator.onLine;
    setIsOffline(!navigator.onLine);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [retryCachedChunks, retryAllPending, checkGP, flushChunk]);

  useEffect(() => {
    const retry = () => {
      if (!navigator.onLine) return;

      const meetingId = currentMeetingRef.current;

      if (meetingId) {
        void retryCachedChunks(meetingId);
      } else {
        void retryAllPending();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        retry();
      }
    };

    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    window.addEventListener("pageshow", retry);
    document.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );

    // Mobile browsers do not always fire `online` reliably. Retry queued
    // meetings periodically while the app is open.
    const interval = setInterval(() => {
      if (!currentMeetingRef.current) retry();
    }, 30_000);

    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      window.removeEventListener("pageshow", retry);
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
      clearInterval(interval);
    };
  }, [retryCachedChunks, retryAllPending]);

  // On page load, upload anything queued while offline (e.g. the tab was closed
  // before the connection came back). Wait until the auth token is available.
  useEffect(() => {
    if (accessToken && navigator.onLine) retryAllPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const triggerMerge = useCallback(async (meetingId: string) => {
    try {
      const pending = Array.from(pendingUploadsRef.current);
      if (pending.length > 0) {
        setStatusMsg(`Waiting for ${pending.length} upload${pending.length > 1 ? "s" : ""} to finish…`);
        await Promise.allSettled(pending);
      }

      // Stopped without a connection: keep the chunks and let the online
      // handler (or the next page load) finish the upload and merge.
      if (!navigator.onLine) {
        setPendingSync(true);
        setStatusMsg("Recording saved on this device — it will upload when you're back online.");
        setState("done");
        currentMeetingRef.current = null;
        return;
      }

      // Create the backend record if the recording started offline.
      const pendingMeeting = await getPendingMeeting(meetingId);
      if (pendingMeeting && !pendingMeeting.created) {
        await ensureMeetingCreated(pendingMeeting);
      }

      setStatusMsg("Merging audio chunks…");
      const uploaded = await retryCachedChunks(meetingId);
      if (!uploaded) {
        if (!navigator.onLine || networkErrorRef.current) {
          setPendingSync(true);
          setStatusMsg("Recording saved on this device — it will upload when you're back online.");
          setState("done");
          currentMeetingRef.current = null;
          return;
        }
        setError("Some audio chunks could not be uploaded. Chunks saved — retry from the meetings page.");
        setState("error");
        return;
      }

      await meetingsApi.mergeChunks(meetingId);
      await deletePendingMeeting(meetingId);
      await deleteMeetingChunks(meetingId);

      setPendingSync(false);
      setStatusMsg("Done!");
      setState("done");
      currentMeetingRef.current = null;
      if (!isSimpleUser) {
        setTimeout(() => router.push("/dashboard/meetings"), 2000);
      }
    } catch (e: any) {
      // The connection may have dropped between the uploads and the merge.
      // A 401 means the session expired; keep the audio queued for after the
      // user signs in again.
      if (!navigator.onLine || isNetworkError(e) || e?.response?.status === 401) {
        setPendingSync(true);
        setStatusMsg("Recording saved on this device — it will upload when you're back online.");
        setState("done");
        currentMeetingRef.current = null;
        return;
      }
      setError(`Merge failed: ${e.message}. Chunks saved — retry from the meetings page.`);
      setState("error");
    }
  }, [retryCachedChunks, ensureMeetingCreated, router, isSimpleUser]);

  const submitForm = useCallback(() => {
    if (!validateMeta(meta, setMetaError)) return;
    setFormDone(true);
  }, [meta]);

  const startRecording = useCallback(async () => {
    if (!formDone) return;
    setError(""); setChunkStatuses([]); setPendingSync(false);
    chunkIdRef.current = 0; isStoppingRef.current = false;
    pendingUploadsRef.current.clear();
    isBotRef.current = false;
    setNovncUrl(null);

    const attendeeList = meta.attendees.split(",").map(a => a.trim()).filter(Boolean);
    const meetingId    = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setChunkMeetingId(meetingId); currentMeetingRef.current = meetingId;

    const details: PendingMeeting = {
      meeting_id:    meetingId,
      context:       meta.context.trim(),
      attendees:     attendeeList,
      no_of_persons: parseInt(meta.no_of_persons),
      meet_url:      meta.meet_url.trim() || undefined,
      date_time:     getCurrentISTISO(),
      created:       false,
      created_at:    new Date().toISOString(),
    };
    const wantsBot = !!details.meet_url;

    if (!isOpfsAvailable()) {
      toast.error("Offline audio storage isn't available in this browser. Keep the connection on while recording.");
    }

    // Bot-assisted recording needs the backend and the bot worker.
    if (wantsBot) {
      if (!navigator.onLine || networkDownRef.current) {
        setError("Bot-assisted recording needs an internet connection. Remove the Meet URL to record from your microphone offline.");
        currentMeetingRef.current = null;
        setChunkMeetingId(null);
        setState("idle");
        return;
      }

      try {
        await ensureMeetingCreated(details);
      } catch (e: any) {
        setError(e?.response?.data?.detail?.message || e?.message || "Failed to create meeting record.");
        currentMeetingRef.current = null;
        setChunkMeetingId(null);
        setState("idle");
        return;
      }

      isBotRef.current = true;
      try {
        setState("recording");
        setStatusMsg("Starting bot to join the meeting...");
        const { data } = await meetingsApi.startBotRecording(meetingId, details.meet_url!);
        if (data?.novnc_url) setNovncUrl(data.novnc_url);
        setStatusMsg("Bot is recording the meeting. Click Stop when done.");
      } catch (e: any) {
        setError(e?.response?.data?.detail?.message || e?.message || "Failed to start bot recording.");
        setState("error");
      }
      return;
    }

    // Microphone flow: save the details locally, start recording immediately,
    // and create the backend record in the background. Offline / expired-token
    // failures therefore never block the recording.
    if (!isOpfsAvailable()) {
      setError("Offline recording isn't supported in this browser. Reconnect to record.");
      currentMeetingRef.current = null;
      setChunkMeetingId(null);
      setState("idle");
      return;
    }

    try {
      await savePendingMeeting(details);
    } catch {
      setError("Could not save the meeting details on this device. Check available storage and try again.");
      currentMeetingRef.current = null;
      setChunkMeetingId(null);
      setState("idle");
      return;
    }

    // Normal mic recording flow
    try {
      const audioConstraint: MediaTrackConstraints | boolean = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : true;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
      } catch (err: any) {
        // The chosen device may have been unplugged between selection and start.
        if (selectedDeviceId && (err?.name === "OverconstrainedError" || err?.name === "NotFoundError")) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw err;
        }
      }

      streamRef.current = stream;

      // Device labels only become available after microphone permission is granted.
      const actualDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (actualDeviceId) setSelectedDeviceId(actualDeviceId);
      refreshAudioDevices();

      const mimeType = getMimeType(); mimeTypeRef.current = mimeType;
      const mr = new MediaRecorder(stream, { mimeType }); mrRef.current = mr;
      chunkBlobRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunkBlobRef.current.push(e.data); };

      mr.onstop = () => {
        if (!isStoppingRef.current) return;
        flushChunk(meetingId, mimeType);
        stream.getTracks().forEach(t => t.stop());
        setState("merging");
        setStatusMsg("Finalising upload…");
        triggerMerge(meetingId);
      };

      retryTimerRef.current = setInterval(() => {
        if (navigator.onLine) retryCachedChunks(meetingId);
      }, 15_000);
      mr.start(1000);
      elapsedRef.current = 0; chunkStartElapsedRef.current = 0;
      setState("recording"); setElapsed(0); startET();

      // Create the backend record after recording has started. If this fails
      // (offline, expired token, server error) the local queue handles it.
      if (navigator.onLine && !networkDownRef.current) {
        void ensureMeetingCreated(details).catch(() => {});
      }
    } catch (err: any) {
      const isDenied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
      const noDevice = err?.name === "NotFoundError"   || err?.name === "DevicesNotFoundError";
      setError(isDenied ? "Microphone access denied. Allow access in browser settings." : noDevice ? "No microphone found. Connect a microphone and try again." : `Could not start: ${err?.message || "Unknown error"}`);
      if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      deletePendingMeeting(meetingId).catch(() => {});
      deleteMeetingChunks(meetingId).catch(() => {});
      currentMeetingRef.current = null;
      setState("idle");
    }
  }, [formDone, meta, flushChunk, retryCachedChunks, triggerMerge, selectedDeviceId, refreshAudioDevices, ensureMeetingCreated]);

  const togglePause = useCallback(() => {
    const mr = mrRef.current; if (!mr) return;
    if (mr.state === "recording") {
      mr.pause(); stopET();
      setState("paused");
    } else if (mr.state === "paused") {
      mr.resume(); startET();
      setState("recording");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (isBotRef.current) {
      const mid = currentMeetingRef.current;
      if (!mid) return;
      try {
        setStatusMsg("Stopping bot recording…");
        await meetingsApi.stopBotRecording(mid);
        setState("done");
        setStatusMsg("Bot recording stopped and saved!");
        if (!isSimpleUser) setTimeout(() => router.push("/dashboard/meetings"), 2000);
      } catch (e: any) {
        setError(`Failed to stop bot: ${e.message}`);
        setState("error");
      }
      return;
    }
    const mr = mrRef.current;
    if (!mr || (mr.state !== "recording" && mr.state !== "paused")) return;
    isStoppingRef.current = true; stopET();
    if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
    mr.stop();
  }, [router, isSimpleUser]);

  const resetForm = useCallback(() => {
    elapsedRef.current = 0; chunkStartElapsedRef.current = 0;
    setElapsed(0); setError(""); setStatusMsg(""); setChunkStatuses([]);
    setChunkMeetingId(null); setNovncUrl(null); setPendingSync(false);
    // Both admin and normal users must manually fill the form for each recording
    setMeta({ context: "", attendees: "", no_of_persons: "", meet_url: "" });
    setMetaError("");
    setFormDone(false);
    isStoppingRef.current = false; chunkIdRef.current = 0;
    currentMeetingRef.current = null; pendingUploadsRef.current.clear();
    isBotRef.current = false;
    setState("idle");
  }, []);

  const isActive = state === "recording" || state === "paused";
  const isBusy   = state === "merging"   || state === "done";

  if (isSimpleUser) {
    const canStart = state === "idle" && formDone && !isBusy;
    const showStart = state === "idle" && !isBusy;
    const showStop = state === "recording" || state === "paused";
    const canSignOut = state === "idle" || state === "done" || state === "error";
    const statusLabel =
      state === "recording" ? (isBotRef.current ? "Bot recording · active" : isOffline ? "Recording · offline (caching)" : "Recording · uploading")
      : state === "paused"  ? "Paused"
      : state === "merging" ? (statusMsg || "Finalising upload…")
      : state === "done"    ? (isBotRef.current ? "Bot recording saved" : pendingSync ? "Saved offline" : "Done")
      : state === "error"   ? "Error"
      : "Ready";

    return (
      <div className="h-full bg-slate-50 relative">
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm">
            <Image src="/smart-mom.png" alt="Smart MoM" width={36} height={36} priority />
          </div>
          <span className="hidden sm:inline text-sm font-bold text-gray-900">Smart MoM</span>
        </div>
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {isSimpleUser && (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl font-semibold text-sm shadow-sm transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Link>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            disabled={!canSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 rounded-xl font-semibold text-sm shadow-sm transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
        <div className="h-full flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-sm p-6">
            <div className="flex flex-col items-center text-center">
              <div
                className={`relative w-24 h-24 rounded-full flex items-center justify-center ${
                  state === "recording"
                    ? "bg-red-50 ring-4 ring-red-200"
                    : "bg-indigo-50 ring-4 ring-indigo-100"
                }`}
              >
                {isBotRef.current && state === "recording" ? (
                  <Bot className={`h-10 w-10 ${state === "recording" ? "text-red-600" : "text-indigo-600"}`} />
                ) : (
                  <Mic className={`h-10 w-10 ${state === "recording" ? "text-red-600" : "text-indigo-600"}`} />
                )}
                {state === "recording" && (
                  <>
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 animate-pulse" />
                    <span className="absolute inset-0 rounded-full border-2 border-red-200 animate-ping" />
                  </>
                )}
              </div>

              <div className="mt-4">
                <p className="text-lg font-semibold text-gray-900">
                  {state === "recording" ? (isBotRef.current ? "Bot Recording…" : "Recording…") : state === "merging" ? "Finalising…" : state === "done" ? (isBotRef.current ? "Bot Recording Saved" : pendingSync ? "Saved Offline" : "Saved") : "Ready"}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {state === "recording" && isBotRef.current
                    ? statusMsg || "Bot has joined the meeting. Click Stop when finished."
                    : state === "recording"
                      ? "Tap stop when you’re finished."
                      : state === "merging"
                        ? (statusMsg || "Uploading and merging audio…")
                        : state === "done"
                          ? pendingSync
                            ? "Audio is stored on this device and will upload automatically when you're back online."
                            : "You can start a new recording."
                          : "Press start to begin recording immediately."}
                </p>
              </div>

              {(state === "recording" || state === "paused" || state === "merging" || state === "done" || state === "error") && chunkMeetingId && (
                <div className="mt-4 w-full bg-slate-50 border border-gray-200 rounded-2xl p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-600">Meeting ID</p>
                      <p className="mt-0.5 font-mono text-sm text-gray-900 break-all">{chunkMeetingId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-gray-600">Status</p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-800">{statusLabel}</p>
                    </div>
                  </div>

                  {novncUrl && (
                    <div className="mt-3">
                      <a href={novncUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors">
                        <ExternalLink className="h-3 w-3" /> Watch Bot (noVNC)
                      </a>
                    </div>
                  )}

                  {chunkStatuses.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                          <CloudUpload className="h-3.5 w-3.5" /> Chunks
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                          Uploaded: {chunkStatuses.filter(c => c.status === "done").length}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        {(() => {
                          const uploaded = chunkStatuses.filter(c => c.status === "done").length;
                          const uploading = chunkStatuses.filter(c => c.status === "uploading").length;
                          const pending = chunkStatuses.filter(c => c.status === "pending").length;
                          const cached = chunkStatuses.filter(c => c.status === "cached").length;
                          const failed = chunkStatuses.filter(c => c.status === "failed").length;
                          return (
                            <>
                              <span className="px-2 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200">
                                Uploaded {uploaded}
                              </span>
                              {uploading > 0 && (
                                <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                                  Uploading {uploading}
                                </span>
                              )}
                              {pending > 0 && (
                                <span className="px-2 py-1 rounded-lg bg-gray-50 text-gray-700 border border-gray-200">
                                  Pending {pending}
                                </span>
                              )}
                              {cached > 0 && (
                                <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                                  Cached {cached}
                                </span>
                              )}
                              {failed > 0 && (
                                <span className="px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200">
                                  Failed {failed}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && state !== "merging" && (
                <div className="mt-4 w-full flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 text-left">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {error}
                </div>
              )}

              {/* Show form when not filled, show controls when form is done */}
              {state === "idle" && !formDone ? (
                <div className="w-full mt-6 text-left self-start">
                  <div className="space-y-4">
                    <MetaForm meta={meta} onChange={setMeta} disabled={false} metaError={metaError} audioDevices={audioDevices} selectedDeviceId={selectedDeviceId} onDeviceChange={setSelectedDeviceId} />
                    <button
                      onClick={submitForm}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-semibold transition-colors shadow-sm"
                    >
                      Continue <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 w-full text-left">
                  {formDone && (
                    <div className="mb-4 p-4 bg-violet-50 border border-violet-100 rounded-2xl">
                      <p className="text-xs font-semibold text-violet-700">Meeting Details</p>
                      <p className="text-sm font-medium text-gray-800 mt-1">{meta.context}</p>
                      <p className="text-xs text-gray-500 mt-1">{meta.attendees}</p>
                      {state === "idle" && (
                        <button onClick={() => setFormDone(false)} className="text-xs text-violet-600 hover:underline mt-2">Edit</button>
                      )}
                    </div>
                  )}

                  {showStart && (
                    <button
                      onClick={startRecording}
                      disabled={!canStart}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl font-semibold transition-colors"
                    >
                      <Mic className="h-5 w-5" /> Start Recording
                    </button>
                  )}

                  {showStop && (
                    <button
                      onClick={stopRecording}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-semibold transition-colors"
                    >
                      <Square className="h-4 w-4 fill-current" /> Stop
                    </button>
                  )}

                  {state === "done" && (
                    <button
                      onClick={resetForm}
                      className="mt-3 w-full flex items-center justify-center gap-2 px-6 py-3.5 border border-gray-300 hover:bg-gray-50 text-gray-800 rounded-2xl font-semibold transition-colors"
                    >
                      Start Another Recording
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 text-xs text-gray-400">
                {pendingSync ? "Offline — will upload when you're back online." : isOffline ? "Offline — audio will be cached locally." : "Online"}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-xl mx-auto px-4 py-5 sm:py-8">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
              <Mic className="h-5 w-5 text-white" />
            </div>
            Record Meeting
          </h1>
          <p className="text-gray-500 text-sm mt-1 ml-11">
            Fill in meeting details, then start recording. Optionally provide a Google Meet URL for bot-assisted recording.
          </p>
        </div>

        {globalPending > 0 && (
          <div className="mb-4 flex items-center justify-between gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <span className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              {globalPending} chunk{globalPending > 1 ? "s" : ""} pending from a previous session.
            </span>
            <button onClick={retryAllPending} disabled={isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
              {isRetrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Retry
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Visualizer */}
          <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 px-4 sm:px-6 py-6 sm:py-8 flex flex-col items-center gap-4">
            {isBusy ? (
              state === "done" ? (
                <>
                  <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center">
                    {pendingSync ? <WifiOff className="h-10 w-10 text-white" /> : <CheckCircle2 className="h-10 w-10 text-white" />}
                  </div>
                  <p className="text-white font-semibold text-lg">
                    {isBotRef.current ? "Bot Recording Saved!" : pendingSync ? "Saved Offline!" : "Chunks uploaded!"}
                  </p>
                  <p className="text-white/70 text-sm">
                    {isBotRef.current
                      ? statusMsg || "Redirecting to meetings…"
                      : pendingSync
                        ? statusMsg || "Audio is stored on this device and will upload when you're back online."
                        : statusMsg && statusMsg !== "Done!"
                          ? statusMsg
                          : "Redirecting to meetings…"}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="h-12 w-12 text-white animate-spin" />
                  <p className="text-white font-medium">{statusMsg}</p>
                  <div className="w-full max-w-xs">
                    {chunkStatuses.length > 0 && (
                      <p className="text-white/60 text-xs text-center">
                        {chunkStatuses.filter(c => c.status === "done").length} / {chunkStatuses.length} chunks uploaded
                      </p>
                    )}
                  </div>
                </>
              )
            ) : (
              <>
                <div className={`relative w-24 h-24 rounded-full flex items-center justify-center
                  ${state === "recording" ? "bg-red-500/30 ring-4 ring-red-400/40 animate-pulse"
                    : state === "paused"  ? "bg-amber-500/30 ring-4 ring-amber-400/40"
                    : "bg-white/10"}`}>
                  {isBotRef.current && state === "recording" ? (
                    <Bot className={`h-10 w-10 ${state === "recording" ? "text-red-200" : "text-white/70"}`} />
                  ) : (
                    <Mic className={`h-10 w-10 ${state === "recording" ? "text-red-200" : state === "paused" ? "text-amber-200" : "text-white/70"}`} />
                  )}
                  {state === "recording" && <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-red-400 animate-pulse" />}
                </div>
                {!isBotRef.current && (
                  <div className="font-mono text-5xl font-bold text-white tracking-widest tabular-nums">
                    {formatTime(elapsed)}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${state === "recording" ? "bg-red-400 animate-pulse" : state === "paused" ? "bg-amber-400" : "bg-white/30"}`} />
                  <p className="text-white/80 text-sm">
                    {state === "idle"      && (formDone ? "Ready · click Start Recording" : "Fill in meeting details below")}
                    {state === "recording" && (isBotRef.current ? (statusMsg || "Bot recording …") : `Recording · uploading every ${CHUNK_DURATION_SECONDS} s`)}
                    {state === "paused"    && "Paused"}
                    {state === "error"     && "Error — see below"}
                  </p>
                </div>
                {isActive && !isBotRef.current && (
                  <div className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full ${isOffline ? "bg-amber-500/30 text-amber-200" : "bg-green-500/30 text-green-200"}`}>
                    {isOffline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                    {isOffline ? "Offline — caching locally" : `Online — uploading every ${CHUNK_DURATION_SECONDS} s`}
                  </div>
                )}
                {isBotRef.current && state === "recording" && novncUrl && (
                  <a href={novncUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 text-white rounded-lg text-xs font-medium hover:bg-white/30 transition-colors">
                    <ExternalLink className="h-3 w-3" /> Watch Bot (noVNC)
                  </a>
                )}
                {chunkStatuses.length > 0 && (
                  <div className="w-full bg-black/20 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/70 flex items-center gap-1.5"><CloudUpload className="h-3.5 w-3.5" /> Chunks</span>
                      <span className="text-xs text-white/60">{chunkStatuses.filter(c=>c.status==="done").length}/{chunkStatuses.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {chunkStatuses.map(c => (
                        <div key={c.chunk_id} title={`Chunk ${c.chunk_id} · ${c.status}`}
                          className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold
                            ${c.status==="done"      ? "bg-green-400/30 text-green-200"
                            : c.status==="uploading" ? "bg-blue-400/30 text-blue-200 animate-pulse"
                            : c.status==="cached"    ? "bg-amber-400/30 text-amber-200"
                            : c.status==="failed"    ? "bg-red-400/30 text-red-200"
                            : "bg-white/10 text-white/40"}`}>
                          {c.status==="done"      ? <CheckCheck className="h-3 w-3" />
                          : c.status==="uploading" ? <Loader2 className="h-3 w-3 animate-spin" />
                          : c.status==="cached"    ? <WifiOff className="h-3 w-3" />
                          : c.status==="failed"    ? "!" : c.chunk_id}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Controls */}
          {!isBusy && (
            <div className="px-6 py-5 flex items-center justify-center gap-3 border-b border-gray-100">
              {state === "idle" && formDone && (
                <button onClick={startRecording}
                  className="flex items-center gap-2 px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-medium transition-colors shadow-sm">
                  <Mic className="h-5 w-5" /> Start Recording
                </button>
              )}
              {isActive && (
                <>
                  <button onClick={togglePause}
                    className="p-3 rounded-xl bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">
                    {state === "recording" ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </button>
                  <button onClick={stopRecording}
                    className="flex items-center gap-2 px-7 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors">
                    <Square className="h-4 w-4 fill-current" /> Stop
                  </button>
                </>
              )}
            </div>
          )}

          {error && !isBusy && (
            <div className="mx-6 mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {state === "idle" && !formDone && (
            <div className="p-6 space-y-5">
              <div className="flex items-start gap-2 p-3 bg-violet-50 border border-violet-200 rounded-xl text-xs text-violet-800">
                <Layers className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>Fill in the meeting details, then click <strong>Continue</strong>. Audio uploads every <strong>{CHUNK_DURATION_SECONDS} seconds</strong> — cached locally if offline.</span>
              </div>
              <MetaForm meta={meta} onChange={setMeta} disabled={false} metaError={metaError} audioDevices={audioDevices} selectedDeviceId={selectedDeviceId} onDeviceChange={setSelectedDeviceId} />
              <button onClick={submitForm}
                className="w-full flex items-center justify-center gap-2 py-3 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 transition-colors shadow-sm">
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {(state === "idle" || isActive) && formDone && (
            <div className="px-6 py-4 bg-violet-50/60 border-b border-violet-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-violet-700">Meeting details</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5">{meta.context}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{meta.attendees}</p>
                </div>
                {state === "idle" && (
                  <button onClick={() => setFormDone(false)} className="text-xs text-violet-600 hover:underline">Edit</button>
                )}
              </div>
            </div>
          )}
        </div>

        {(state === "idle" || state === "error") && (
          <div className="mt-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-2 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Tips for best results
            </p>
            <ul className="space-y-1 text-xs text-gray-500 list-disc list-inside">
              <li>Fill in meeting details first, then click Continue</li>
              <li>Paste a Google Meet URL to have the bot join and record automatically</li>
              <li>Without a Meet URL, audio records from your microphone and uploads every <strong>{CHUNK_DURATION_SECONDS} seconds</strong></li>
              <li>Recording works offline — audio is saved on this device and uploaded when you reconnect</li>
              <li>Click Stop when done — all chunks are merged automatically</li>
            </ul>
          </div>
        )}
        {state === "error" && (
          <button onClick={resetForm}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Start Over
          </button>
        )}
        {state === "done" && pendingSync && (
          <button onClick={resetForm}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Start Another Recording
          </button>
        )}
      </div>
    </div>
  );
}

