"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meetingsApi, diagramsApi } from "@/lib/api";
import { Meeting } from "@/types";
import { useParams, useRouter } from "next/navigation";
import { formatIST } from "@/lib/dateUtils";
import {
  Loader2, Calendar, Users, FileText, Brain,
  BarChart3, MessageSquare, RefreshCw, ArrowLeft, Sparkles,
  Download, CheckCircle2, Trash2, AlertTriangle, Radio,
  ChevronDown, ChevronUp, User as UserIcon, Save, X, Info,
  ExternalLink, Square, Bot,
} from "lucide-react";
import Link from "next/link";
import { useState, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { MermaidRenderer } from "@/components/diagram/MermaidRenderer";
import { useDiagramStatus } from "@/hooks/useDiagramStatus";
import { useMeeting } from "@/hooks/useMeetings";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { meetingsActions } from "@/store/slices/meetingsSlice";
import { MOMViewer } from "@/components/mom/MOMViewer";

type Tab = "transcript" | "mom" | "summary" | "key_points";

export default function MeetingDetailPage() {
  const { id }      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const dispatch    = useAppDispatch();
  const role        = useAppSelector(s => s.session.role);

  const [activeTab,     setActiveTab]     = useState<Tab>("mom");
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDiagramOpen, setIsDiagramOpen] = useState(false);

  // Meet bot recording state
  const [editMeetLink, setEditMeetLink] = useState("");
  const [isSavingMeetLink, setIsSavingMeetLink] = useState(false);
  const [isStartingBot, setIsStartingBot] = useState(false);
  const [isStoppingBot, setIsStoppingBot] = useState(false);
  const [botStatus, setBotStatus] = useState<any>(null);
  const botPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Speaker name editing state
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [isEditingSpeakers, setIsEditingSpeakers] = useState(false);

  // Speaker confirmation before MoM generation
  const [showSpeakerConfirm, setShowSpeakerConfirm] = useState(false);

  const { meeting, isLoading, isError, refetch } = useMeeting(id);
  const diagramQuery = useDiagramStatus(id);

  // ── Audio download ────────────────────────────────────────────────────────
  // For local storage: GET /audio-url returns a signed token URL pointing to
  //   /api/v1/meetings/{id}/download-audio?token=...
  // For S3: GET /audio-url returns a presigned S3 URL.
  // In both cases we just open the returned audio_url directly.
  const handleDownload = useCallback(async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const res      = await meetingsApi.audioUrl(id);
      let audioUrl = res.data?.audio_url as string | undefined;
      if (!audioUrl) { toast.error("No download URL available"); return; }

      // Production fix: if the app is served over HTTPS but the backend returns HTTP,
      // browsers will block the navigation/download as mixed content.
      if (typeof window !== "undefined" && window.location.protocol === "https:" && audioUrl.startsWith("http://")) {
        audioUrl = `https://${audioUrl.slice("http://".length)}`;
      }

      // Trigger download via same-tab navigation (no popup/new tab).
      // This relies on the backend returning Content-Disposition: attachment.
      const a = document.createElement("a");
      a.href = audioUrl;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail?.message || e?.message || "Could not get download link");
    } finally { setIsDownloading(false); }
  }, [id, isDownloading]);

  // ── Diagram download (high-definition PNG) ───────────────────────────────────
  const handleDownloadDiagram = useCallback(async (diagramData: any) => {
    if (!diagramData?.mermaid_syntax) {
      toast.error("No diagram to download");
      return;
    }

    let tempDiv: HTMLDivElement | null = null;

    try {
      // Import html2canvas directly
      const html2canvas = (await import("html2canvas")).default;

      // Create a temporary div to render the diagram - VISIBLE for proper rendering
      tempDiv = document.createElement("div");
      tempDiv.style.position = "fixed";
      tempDiv.style.top = "0";
      tempDiv.style.left = "0";
      tempDiv.style.zIndex = "-9999";
      tempDiv.style.padding = "30px";
      tempDiv.style.background = "white";
      tempDiv.style.fontFamily = "Arial, sans-serif";
      tempDiv.innerHTML = `
        <div style="text-align: center;">
          <h2 style="margin-bottom: 8px; font-size: 18px; color: #1f2937;">${meeting?.context || "Meeting Diagram"}</h2>
          <p style="color: #6b7280; font-size: 12px; margin-bottom: 20px;">Generated: ${new Date().toLocaleString()}</p>
          <div class="mermaid-outer" style="display: inline-block;"></div>
        </div>
      `;
      document.body.appendChild(tempDiv);

      // Render mermaid diagram
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });

      const mermaidContainer = tempDiv.querySelector(".mermaid-outer") as HTMLElement;
      mermaidContainer.innerHTML = diagramData.mermaid_syntax;
      mermaidContainer.removeAttribute("data-processed");

      await mermaid.run({ nodes: [mermaidContainer] });

      // Get the SVG element
      const svgElement = mermaidContainer.querySelector("svg");
      if (!svgElement) {
        throw new Error("SVG element not found");
      }

      // Get natural dimensions from viewBox or current size
      const viewBox = svgElement.getAttribute("viewBox");
      let naturalWidth = 800;
      let naturalHeight = 600;

      if (viewBox) {
        const parts = viewBox.split(/\s+/);
        naturalWidth = parseFloat(parts[2]) || 800;
        naturalHeight = parseFloat(parts[3]) || 600;
      } else {
        const bbox = svgElement.getBoundingClientRect();
        naturalWidth = bbox.width || 800;
        naturalHeight = bbox.height || 600;
      }

      // Set explicit natural size on SVG
      svgElement.setAttribute("width", String(naturalWidth));
      svgElement.setAttribute("height", String(naturalHeight));
      svgElement.style.width = naturalWidth + "px";
      svgElement.style.height = naturalHeight + "px";

      // Wait for rendering to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Use html2canvas with NO scaling - use natural size for clarity
      const canvas = await html2canvas(tempDiv, {
        scale: 1, // No scaling - use natural size
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        allowTaint: true,
        width: tempDiv.offsetWidth,
        height: tempDiv.offsetHeight,
        windowWidth: tempDiv.offsetWidth,
        windowHeight: tempDiv.offsetHeight,
      });

      // Cleanup temp div
      if (tempDiv && document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }

      // Download as PNG
      canvas.toBlob((blob: Blob | null) => {
        if (!blob) {
          toast.error("Failed to create image");
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Diagram_${meeting?.context?.replace(/[^a-z0-9]/gi, "_") || "meeting"}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success("Diagram downloaded as PNG");
      }, "image/png", 1.0);

    } catch (e) {
      console.error("Download error:", e);
      if (tempDiv && document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }
      toast.error("Failed to download diagram");
    }
  }, [meeting]);

  // ── Delete meeting ────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => meetingsApi.delete(id),
    onSuccess: () => {
      toast.success("Meeting deleted");
      // Remove from all caches
      queryClient.removeQueries({ queryKey: ["meeting", id] });
      queryClient.removeQueries({ queryKey: ["diagram",  id] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["stats"]    });
      dispatch(meetingsActions.removeMeeting(id));
      router.push("/dashboard/meetings");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to delete meeting"),
  });

  // ── Cache patcher ─────────────────────────────────────────────────────────
  const patchMeetingCache = useCallback((patch: Partial<Meeting>) => {
    queryClient.setQueryData(["meeting", id], (old: any) => {
      if (!old) return old;
      return { ...old, data: { ...old.data, ...patch } };
    });
    dispatch(meetingsActions.updateMeeting({ meeting_id: id, ...patch }));
  }, [id, queryClient, dispatch]);

  // ── AI generation mutations ───────────────────────────────────────────────
  const generateMomMutation = useMutation({
    mutationFn: () => meetingsApi.triggerGeneration(id, "mom"),
    onSuccess: (res) => { const g = res.data?.mom; if (g) patchMeetingCache({ mom: g }); else refetch(); toast.success("Minutes of Meeting generated"); },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to generate minutes"),
  });
  const generateSummaryMutation = useMutation({
    mutationFn: () => meetingsApi.triggerGeneration(id, "summary"),
    onSuccess: (res) => { const g = res.data?.summary; if (g) patchMeetingCache({ summary: g }); else refetch(); toast.success("Summary generated"); },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to generate summary"),
  });
  const generateKeyPointsMutation = useMutation({
    mutationFn: () => meetingsApi.triggerGeneration(id, "key_points"),
    onSuccess: (res) => { const g = res.data?.key_points; if (g) patchMeetingCache({ key_points: g }); else refetch(); toast.success("Key points generated"); },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to generate key points"),
  });
  const regenerateDiagramMutation = useMutation({
    mutationFn: () => diagramsApi.regenerate(id),
    onSuccess: () => {
      toast.success("Diagram regeneration triggered");
      queryClient.invalidateQueries({ queryKey: ["diagram", id] });
      setIsDiagramOpen(true);
    },
    onError: () => toast.error("Failed to regenerate diagram"),
  });
  const generateDiagramMutation = useMutation({
    mutationFn: () => meetingsApi.triggerGeneration(id, "diagram"),
    onSuccess: (res) => {
      const dr = res.data?.diagram;
      if (dr) {
        queryClient.setQueryData(["diagram", id], (old: any) => ({
          ...(old ?? { success: true, meeting_id: id, rag_indexed: false }),
          diagram: dr,
        }));
      } else { queryClient.invalidateQueries({ queryKey: ["diagram", id] }); }
      if (res.data?.diagram?.status === "ready") {
        toast.success("Diagram generated");
        setIsDiagramOpen(true); // Open accordion after successful generation
      } else if (res.data?.diagram?.status === "not_applicable") {
        toast("No diagrammable structure found", { icon: "ℹ️" });
      } else {
        toast.error("Diagram generation failed");
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to generate diagram"),
  });

  // ── Meet link save ──────────────────────────────────────────────────────
  const saveMeetLink = useCallback(async () => {
    if (!editMeetLink.trim()) return;
    setIsSavingMeetLink(true);
    try {
      await meetingsApi.update(id, { meet_link: editMeetLink.trim() });
      patchMeetingCache({ meet_link: editMeetLink.trim() } as any);
      toast.success("Meeting link saved");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to save meeting link");
    } finally {
      setIsSavingMeetLink(false);
    }
  }, [id, editMeetLink, patchMeetingCache]);

  // ── Reset editMeetLink when meeting loads ────────────────────────────────
  useEffect(() => {
    if (meeting?.meet_link) {
      setEditMeetLink(meeting.meet_link);
    }
  }, [meeting?.meet_link]);

  // ── Bot recording ────────────────────────────────────────────────────────
  const startBotRecording = useCallback(async () => {
    if (!meeting?.meet_link) return;
    setIsStartingBot(true);
    try {
      const { data } = await meetingsApi.startBotRecording(id, meeting.meet_link);
      if (data?.bot_session_id) {
        patchMeetingCache({ bot_session_id: data.bot_session_id, status: "recording" } as any);
        toast.success("Bot is joining the meeting");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to start bot");
    } finally {
      setIsStartingBot(false);
    }
  }, [id, meeting?.meet_link, patchMeetingCache]);

  const stopBotRecording = useCallback(async () => {
    setIsStoppingBot(true);
    try {
      await meetingsApi.stopBotRecording(id);
      toast.success("Bot recording stopped");
      if (botPollRef.current) {
        clearInterval(botPollRef.current);
        botPollRef.current = null;
      }
      setBotStatus(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to stop bot");
    } finally {
      setIsStoppingBot(false);
    }
  }, [id, refetch]);

  // ── Poll bot status when active ──────────────────────────────────────────
  useEffect(() => {
    if (meeting?.bot_session_id) {
      const poll = async () => {
        try {
          const { data } = await meetingsApi.getBotStatus(id);
          setBotStatus(data);
          if (data?.bot_active === false && botPollRef.current) {
            clearInterval(botPollRef.current);
            botPollRef.current = null;
            refetch();
          }
        } catch {
          // ignore poll errors
        }
      };
      poll();
      botPollRef.current = setInterval(poll, 5000);
      return () => {
        if (botPollRef.current) {
          clearInterval(botPollRef.current);
          botPollRef.current = null;
        }
      };
    } else {
      setBotStatus(null);
    }
  }, [id, meeting?.bot_session_id, refetch]);

  // ── Initialize speaker names from transcript ───────────────────────────────────
  useEffect(() => {
    if (meeting?.transcript?.segments) {
      const names: Record<string, string> = {};
      meeting.transcript.segments.forEach((seg: any) => {
        if (seg.speaker && seg.speaker_name) {
          names[seg.speaker] = seg.speaker_name;
        }
      });
      setSpeakerNames(names);
    }
  }, [meeting?.transcript?.segments]);

  // ── Check if speaker names are in default format (SPEAKER_00, SPEAKER_01, etc.) ──
  const areSpeakersInDefaultFormat = useCallback((): boolean => {
    if (!meeting?.transcript?.segments || meeting.transcript.segments.length === 0) {
      return false;
    }
    // Check if any speaker label matches the default pattern (SPEAKER_XX)
    const defaultPattern = /^SPEAKER_\d{2}$/;
    const hasDefaultLabels = meeting.transcript.segments.some((seg: any) =>
      defaultPattern.test(seg.speaker)
    );
    // Also check if speaker names haven't been properly set (empty or same as label)
    const hasUnmappedSpeakers = meeting.transcript.segments.some((seg: any) => {
      const speakerLabel = seg.speaker;
      const speakerName = seg.speaker_name || speakerNames[speakerLabel] || "";
      // If name is empty OR name matches the default SPEAKER_XX pattern exactly
      return !speakerName.trim() || defaultPattern.test(speakerName);
    });
    return hasDefaultLabels && hasUnmappedSpeakers;
  }, [meeting?.transcript?.segments, speakerNames]);

  // ── Handle MoM generation with speaker validation ──────────────────────────────
  const handleGenerateMom = useCallback(() => {
    if (areSpeakersInDefaultFormat()) {
      setShowSpeakerConfirm(true);
    } else {
      generateMomMutation.mutate();
    }
  }, [areSpeakersInDefaultFormat, generateMomMutation]);

  // ── Save speaker names mutation ─────────────────────────────────────────────────
  const saveSpeakerNamesMutation = useMutation({
    mutationFn: async (newSpeakerNames: Record<string, string>) => {
      // Update transcript with new speaker names
      const updatedSegments = meeting?.transcript?.segments?.map((seg: any) => ({
        ...seg,
        speaker_name: newSpeakerNames[seg.speaker] || seg.speaker_name || "",
      }));

      return meetingsApi.update(id, {
        transcript: {
          ...meeting?.transcript,
          segments: updatedSegments,
        },
      }, true);
    },
    onSuccess: () => {
      toast.success("Speaker names updated successfully");
      setIsEditingSpeakers(false);
      refetch();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to update speaker names"),
  });

  // ── Loading / error ───────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
    </div>
  );
  if (isError || !meeting) return (
    <div className="p-8 text-center">
      <p className="text-red-600 font-medium">Meeting not found or access denied.</p>
      <Link href="/dashboard/meetings" className="text-indigo-600 text-sm mt-2 inline-block">← Back to meetings</Link>
    </div>
  );

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "mom",        label: "Minutes",    icon: FileText      },
    { key: "summary",    label: "Summary",    icon: Brain         },
    { key: "key_points", label: "Key Points", icon: BarChart3     },
    { key: "transcript", label: "Transcript", icon: MessageSquare },
  ];

  const diagramStatus       = diagramQuery.data?.diagram;
  const isTranscriptReady   = meeting.status === "transcript_ready";
  const diagramIsGenerating = generateDiagramMutation.isPending;
  const showGenerateButton  = isTranscriptReady && !diagramIsGenerating && diagramStatus?.status !== "ready";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">

      {/* ── Delete confirmation modal ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Delete Meeting?</h3>
                <p className="text-xs text-gray-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              This will permanently delete <strong>"{meeting.context}"</strong> including its transcript, AI outputs,
              diagram, chat history, and audio file.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Speaker name confirmation modal ── */}
      {showSpeakerConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Info className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Speaker names not updated</h3>
                <p className="text-xs text-gray-500">Recommended: Update names before generating</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Speaker names are still in default format (e.g., <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">SPEAKER_00</code>, <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">SPEAKER_01</code>).
              The MoM will use these labels instead of actual names.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSpeakerConfirm(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                No, Cancel
              </button>
              <button
                onClick={() => { setShowSpeakerConfirm(false); generateMomMutation.mutate(); }}
                disabled={generateMomMutation.isPending}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {generateMomMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Yes, Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Back + Header ── */}
      <div className="mb-5 sm:mb-6">
        <Link href="/dashboard/meetings" prefetch={true}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3 sm:mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Meetings
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{meeting.context}</h1>
            <p className="font-mono text-xs text-gray-400 mt-1">{meeting.meeting_id}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2 sm:mt-3 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {formatIST(meeting.date_time, "full")}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                <span className="truncate max-w-[200px] sm:max-w-none">{meeting.attendees.join(", ")}</span>
              </span>
              <StatusBadge status={meeting.status} />
            </div>
          </div>

          {/* Action buttons */}
          <div className="self-start flex items-center gap-2 flex-shrink-0">
            {role === "user" && (
              <Link
                href="/dashboard/record"
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm"
              >
                <Radio className="h-4 w-4" /> Recording
              </Link>
            )}
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all shadow-sm"
            >
              {isDownloading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Getting link…</>
                : <><Download className="h-4 w-4" /> Download Audio</>}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-50 transition-all shadow-sm"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* ── Meet Bot Recording Section ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
            <Bot className="h-4 w-4 text-violet-600" /> Meet Bot Recording
          </h3>

          {/* Meeting Link input */}
          {!meeting.bot_session_id && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editMeetLink}
                onChange={(e) => setEditMeetLink(e.target.value)}
                placeholder={meeting.meet_link || "Paste Google Meet link here..."}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button
                onClick={saveMeetLink}
                disabled={isSavingMeetLink || !editMeetLink.trim()}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isSavingMeetLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
              {meeting.meet_link && !meeting.bot_session_id && (
                <button
                  onClick={startBotRecording}
                  disabled={isStartingBot}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {isStartingBot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  Start Bot Recording
                </button>
              )}
            </div>
          )}

          {/* Active bot session */}
          {meeting.bot_session_id && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                  </span>
                  <span className="text-sm font-medium text-green-700">
                    {botStatus?.bot_active
                      ? `Recording (${botStatus?.bot_status?.uptime_sec || 0}s)`
                      : "Finalizing..."}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {botStatus?.novnc_url && (
                    <a
                      href={botStatus.novnc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" /> Watch (noVNC)
                    </a>
                  )}
                  <button
                    onClick={stopBotRecording}
                    disabled={isStoppingBot}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {isStoppingBot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
                    Stop Recording
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* ── Transcript + AI outputs ── */}
        {isTranscriptReady ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                    activeTab === key
                      ? "border-indigo-600 text-indigo-700 bg-white"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
            <div className="p-5">
              <TabContent
                meeting={meeting} activeTab={activeTab}
                onGenerateMom={handleGenerateMom}
                onGenerateSummary={() => generateSummaryMutation.mutate()}
                onGenerateKeyPoints={() => generateKeyPointsMutation.mutate()}
                generatingMom={generateMomMutation.isPending}
                generatingSummary={generateSummaryMutation.isPending}
                generatingKeyPoints={generateKeyPointsMutation.isPending}
                speakerNames={speakerNames}
                setSpeakerNames={setSpeakerNames}
                isEditingSpeakers={isEditingSpeakers}
                setIsEditingSpeakers={setIsEditingSpeakers}
                saveSpeakerNamesMutation={saveSpeakerNamesMutation}
              />
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-indigo-400" />
            <p className="font-medium">Waiting for transcript…</p>
            <p className="text-sm mt-1">Once transcription is complete, AI generation will be available.</p>
          </div>
        )}

        {/* ── Diagram Accordion Section ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setIsDiagramOpen(!isDiagramOpen)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-teal-600" /> Visual Diagram
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {diagramStatus?.status === "ready" && !diagramIsGenerating && (
                  <button
                    onClick={(e) => { e.stopPropagation(); regenerateDiagramMutation.mutate(); }}
                    disabled={regenerateDiagramMutation.isPending}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${regenerateDiagramMutation.isPending ? "animate-spin" : ""}`} /> Regenerate
                  </button>
                )}
                {showGenerateButton && (
                  <button
                    onClick={(e) => { e.stopPropagation(); generateDiagramMutation.mutate(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors"
                  >
                    <Sparkles className="h-3 w-3" /> Generate Diagram
                  </button>
                )}
              </div>
              {isDiagramOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </div>
          </button>

          {isDiagramOpen && (
            <div className="border-t border-gray-100">
              <div className="p-5">
                {diagramIsGenerating ? (
                  <div className="flex items-center gap-3 text-gray-400 py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-teal-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-600">Generating diagram…</p>
                      <p className="text-xs mt-0.5">Analysing transcript — usually 20–40 seconds.</p>
                    </div>
                  </div>
                ) : diagramStatus?.status === "ready" ? (
                  <div className="space-y-4">
                    <MermaidRenderer diagram={diagramStatus} onRegenerate={() => regenerateDiagramMutation.mutate()} />
                    <button
                      onClick={() => handleDownloadDiagram(diagramStatus)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Download className="h-4 w-4" /> Download PNG
                    </button>
                  </div>
                ) : diagramStatus?.status === "failed" ? (
                  <div className="text-center py-8 text-gray-400">
                    <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm text-red-500">Diagram generation failed.</p>
                    <p className="text-xs mt-1">{diagramStatus.error ?? "Unknown error."}</p>
                  </div>
                ) : diagramStatus?.status === "not_applicable" ? (
                  <div className="text-center py-8 text-gray-400">
                    <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No diagram applicable for this meeting&apos;s content.</p>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    {!isTranscriptReady
                      ? <p className="text-sm">Diagram will be available once the transcript is ready.</p>
                      : (
                        <>
                          <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-20" />
                          <p className="text-sm">No diagram generated yet.</p>
                          <p className="text-xs mt-1">Click &quot;Generate Diagram&quot; above to create one.</p>
                        </>
                      )
                    }
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── RAG / Chat indexing status ── */}
        {isTranscriptReady && (
          meeting.rag_indexed ? (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-indigo-800">Indexed for chat</p>
                  <p className="text-xs text-indigo-600 mt-0.5">Ask questions about this meeting using Smart MoM Chat.</p>
                </div>
              </div>
              <Link href="/dashboard/chat" prefetch={true}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                <MessageSquare className="h-4 w-4" /> Open Chat
              </Link>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3 text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-600">Indexing for chat…</p>
                <p className="text-xs mt-0.5">Building the knowledge base — usually takes under 30 seconds.</p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Tab Content ──────────────────────────────────────────────────────────────
function TabContent({
  meeting, activeTab,
  onGenerateMom, onGenerateSummary, onGenerateKeyPoints,
  generatingMom, generatingSummary, generatingKeyPoints,
  speakerNames, setSpeakerNames, isEditingSpeakers, setIsEditingSpeakers, saveSpeakerNamesMutation,
}: {
  meeting: Meeting; activeTab: Tab;
  onGenerateMom: () => void; onGenerateSummary: () => void; onGenerateKeyPoints: () => void;
  generatingMom: boolean; generatingSummary: boolean; generatingKeyPoints: boolean;
  speakerNames: Record<string, string>;
  setSpeakerNames: (names: Record<string, string>) => void;
  isEditingSpeakers: boolean;
  setIsEditingSpeakers: (editing: boolean) => void;
  saveSpeakerNamesMutation: any;
}) {
  // MOM Tab - Use Professional MOM Viewer
  if (activeTab === "mom") {
    if (generatingMom) {
      return (
        <div className="flex items-center gap-2 text-gray-400 py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Generating Minutes of Meeting… this may take 20–40 seconds</span>
        </div>
      );
    }
    if (!meeting.mom) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm mb-4">No Minutes of Meeting generated yet.</p>
          <button
            onClick={onGenerateMom}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Sparkles className="h-4 w-4" /> Generate Minutes
          </button>
        </div>
      );
    }
    return <MOMViewer meeting={meeting} onRegenerate={onGenerateMom} regenerating={generatingMom} />;
  }

  // Transcript Tab
  if (activeTab === "transcript") {
    // Extract unique speakers from segments
    const uniqueSpeakers = Array.from(
      new Set(meeting.transcript?.segments?.map((s: any) => s.speaker) || [])
    ).sort();

    return (
      <div>
        {/* Speaker Name Mapping Section */}
        {uniqueSpeakers.length > 0 && (
          <div className="mb-4 rounded-xl border border-purple-100 bg-purple-50 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserIcon className="h-4 w-4 text-purple-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-purple-800">Speaker Name Mapping</p>
                <p className="text-xs text-purple-500">{uniqueSpeakers.length} speaker{uniqueSpeakers.length > 1 ? "s" : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                {!isEditingSpeakers ? (
                  <button
                    onClick={() => setIsEditingSpeakers(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-purple-200 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-50 transition-colors"
                  >
                    <UserIcon className="h-3 w-3" /> Edit Names
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditingSpeakers(false)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                      disabled={saveSpeakerNamesMutation.isPending}
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button
                      onClick={() => saveSpeakerNamesMutation.mutate(speakerNames)}
                      disabled={saveSpeakerNamesMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                      {saveSpeakerNamesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      {saveSpeakerNamesMutation.isPending ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {isEditingSpeakers && (
              <p className="text-xs text-purple-600">Map speaker labels to real names. Leave empty to keep the original label.</p>
            )}
            {isEditingSpeakers ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {uniqueSpeakers.map((speaker) => (
                  <div key={speaker} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-purple-100">
                    <span className="font-mono text-xs font-semibold text-purple-700 flex-shrink-0 w-28 truncate">{speaker}</span>
                    <span className="text-purple-300 text-xs flex-shrink-0">→</span>
                    <input
                      type="text"
                      value={speakerNames[speaker] || ""}
                      onChange={(e) => setSpeakerNames({ ...speakerNames, [speaker]: e.target.value })}
                      placeholder={`Name for ${speaker}`}
                      disabled={saveSpeakerNamesMutation.isPending}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder-gray-400 disabled:bg-gray-50 disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {uniqueSpeakers.map((speaker) => {
                  const name = speakerNames[speaker];
                  return name ? (
                    <div key={speaker} className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-purple-100 rounded-lg">
                      <span className="font-mono text-xs text-purple-600">{speaker}</span>
                      <span className="text-purple-300 text-xs">→</span>
                      <span className="text-xs font-medium text-purple-800">{name}</span>
                    </div>
                  ) : null;
                })}
                {!uniqueSpeakers.some(s => speakerNames[s]) && (
                  <p className="text-xs text-purple-400">No speaker names mapped yet. Click "Edit Names" to add speaker names.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Transcript Content */}
        <div className="max-h-96 overflow-y-auto bg-white border border-gray-100 rounded-xl p-4">
          {meeting.transcript ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 mb-3">
                {meeting.transcript.word_count} words · Language: {meeting.transcript.language.toUpperCase()}
              </p>
              {meeting.transcript.segments?.length > 0
                ? meeting.transcript.segments.map((seg, i) => {
                    // Use speaker_names state first, then fall back to segment's speaker_name, then speaker label
                    const displayName = speakerNames[seg.speaker] || seg.speaker_name || seg.speaker;
                    return (
                      <div key={i} className="flex gap-3 text-sm">
                        <span className="font-semibold text-indigo-700 flex-shrink-0 w-28 truncate" title={seg.speaker}>{displayName}</span>
                        <p className="text-gray-700">{seg.text}</p>
                      </div>
                    );
                  })
                : <p className="text-sm text-gray-700 whitespace-pre-wrap">{meeting.transcript.text as any}</p>
              }
            </div>
          ) : <p className="text-gray-400 text-sm">Transcript not yet available.</p>}
        </div>
      </div>
    );
  }

  // Summary and Key Points Tabs (original markdown view)
  const contentMap: Record<string, { content: string | null | undefined; generating: boolean; onGenerate: () => void; label: string; waitMsg: string }> = {
    summary:    { content: meeting.summary,    generating: generatingSummary,    onGenerate: onGenerateSummary,    label: "Generate Summary",    waitMsg: "Generating summary… this may take 10–30 seconds"           },
    key_points: { content: meeting.key_points, generating: generatingKeyPoints,  onGenerate: onGenerateKeyPoints,  label: "Generate Key Points", waitMsg: "Extracting key points… this may take 10–30 seconds"          },
  };

  const item = contentMap[activeTab];
  if (!item) return null;

  if (item.generating) return (
    <div className="flex items-center gap-2 text-gray-400 py-4">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{item.waitMsg}</span>
    </div>
  );
  if (!item.content) return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="text-sm text-gray-500">Not generated yet.</p>
      <button onClick={item.onGenerate}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
        <Sparkles className="h-4 w-4" /> {item.label}
      </button>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">{item.content}</div>
      <button onClick={item.onGenerate} disabled={item.generating}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 mt-2">
        <RefreshCw className="h-3 w-3" /> Regenerate
      </button>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    created:          "bg-gray-100 text-gray-600",
    audio_uploaded:   "bg-blue-100 text-blue-700",
    processing:       "bg-amber-100 text-amber-700",
    transcript_ready: "bg-green-100 text-green-700",
    recording:        "bg-orange-100 text-orange-700",
  };
  const labels: Record<string, string> = {
    created:          "Created",
    audio_uploaded:   "Uploaded",
    processing:       "Processing",
    transcript_ready: "Transcript Ready",
    recording:        "Recording",
  };
  return (
    <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${cfg[status] || "bg-gray-100 text-gray-600"}`}>
      {labels[status] || status}
    </span>
  );
}
