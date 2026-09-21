"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMeetingsList } from "@/hooks/useMeetings";
import { meetingsApi } from "@/lib/api";
import { Meeting } from "@/types";
import { useAppDispatch } from "@/store/hooks";
import { meetingsActions } from "@/store/slices/meetingsSlice";
import Link from "next/link";
import { formatIST } from "@/lib/dateUtils";
import {
  Mic, Loader2, Calendar, Users, CheckCircle2, Clock,
  AlertCircle, Radio, ChevronLeft, ChevronRight, Brain,
  GitBranch, Search, Trash2,
} from "lucide-react";
import toast from "react-hot-toast";

const STATUS_CONFIG: Record<string, { label: string; icon: any; bg: string; text: string; dot: string }> = {
  created:          { label: "Created",    icon: Clock,        bg: "bg-gray-100",  text: "text-gray-600",  dot: "bg-gray-400"  },
  audio_uploaded:   { label: "Processing Transcript",   icon: Loader2,        bg: "bg-blue-50",   text: "text-blue-600",  dot: "bg-blue-400"  },
  processing:       { label: "Processing", icon: Loader2,      bg: "bg-amber-50",  text: "text-amber-600", dot: "bg-amber-400" },
  transcript_ready: { label: "Transcript Ready", icon: CheckCircle2, bg: "bg-green-50",  text: "text-green-600", dot: "bg-green-400" },
};

export default function MeetingsPage() {
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState("");
  const dispatch    = useAppDispatch();
  const queryClient = useQueryClient();

  const { meetings: allMeetings, meta, isLoading, isError, refetch } = useMeetingsList(page, 20);

  const deleteMutation = useMutation({
    mutationFn: (meetingId: string) => meetingsApi.delete(meetingId),
    onSuccess: (_, meetingId) => {
      toast.success("Meeting deleted");
      dispatch(meetingsActions.removeMeeting(meetingId));
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.detail?.message || e?.message || "Failed to delete meeting"),
  });

  const meetings = allMeetings.filter((m: Meeting) =>
    !search ||
    m.context.toLowerCase().includes(search.toLowerCase()) ||
    m.meeting_id.toLowerCase().includes(search.toLowerCase()) ||
    m.attendees.some(a => a.toLowerCase().includes(search.toLowerCase()))
  );
  const total = meta?.total || 0;

  const handleDelete = (e: React.MouseEvent, meeting: Meeting) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${meeting.context}"? This cannot be undone.`)) return;
    deleteMutation.mutate(meeting.meeting_id);
  };

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 sm:mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Meetings</h1>
            <p className="text-gray-500 text-sm mt-0.5">{total} total meeting{total !== 1 ? "s" : ""}</p>
          </div>
          <Link href="/dashboard/record" prefetch={true}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm">
            <Radio className="h-4 w-4" /> New Recording
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search meetings by title or attendees…"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-sm" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <AlertCircle className="h-4 w-4" /> Failed to load meetings.
            <button onClick={() => refetch()} className="ml-auto underline text-red-600 text-xs">Retry</button>
          </div>
        ) : meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <Mic className="h-8 w-8 opacity-40" />
            </div>
            <p className="text-base font-semibold text-gray-500">
              {search ? "No meetings match your search" : "No meetings yet"}
            </p>
            <p className="text-sm mt-1">
              {search ? "Try a different search term" : "Record your first meeting to get started"}
            </p>
            {!search && (
              <Link href="/dashboard/record" prefetch={true}
                className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                <Radio className="h-4 w-4" /> Record Now
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {meetings.map(m => (
              <MeetingCard
                key={m.meeting_id}
                meeting={m}
                onDelete={handleDelete}
                isDeleting={deleteMutation.isPending && deleteMutation.variables === m.meeting_id}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-600 font-medium">Page {page} of {Math.ceil(total / 20)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={meetings.length < 20}
              className="p-2 rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MeetingCard({
  meeting,
  onDelete,
  isDeleting,
}: {
  meeting: Meeting;
  onDelete: (e: React.MouseEvent, m: Meeting) => void;
  isDeleting: boolean;
}) {
  const cfg  = STATUS_CONFIG[meeting.status] || STATUS_CONFIG.created;
  const isProcessing = meeting.status === "processing" || meeting.status === "audio_uploaded";
  const hasMoM = meeting.mom && meeting.mom.trim().length > 0;

  // Show "Ready" status badge only when MoM is generated
  const statusLabel = hasMoM ? "Ready" : cfg.label;
  const statusBg = hasMoM ? "bg-emerald-50" : cfg.bg;
  const statusText = hasMoM ? "text-emerald-600" : cfg.text;
  const statusDot = hasMoM ? "bg-emerald-400" : cfg.dot;

  return (
    <div className="relative group">
      <Link href={`/dashboard/meetings/${meeting.meeting_id}`} prefetch={true}>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer pr-14">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors truncate">
                {meeting.context}
              </p>
              <p className="text-xs text-gray-400 font-mono mt-0.5">{meeting.meeting_id}</p>
            </div>
            <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${statusBg} ${statusText}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot} ${isProcessing ? "animate-pulse" : ""}`} />
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatIST(meeting.date_time, "full")}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {meeting.attendees.slice(0, 3).join(", ")}
              {meeting.attendees.length > 3 && <span className="text-gray-400">+{meeting.attendees.length - 3}</span>}
            </span>
          </div>

          {(meeting.rag_indexed || meeting.diagram?.status === "ready" || meeting.diagram?.status === "pending" || hasMoM) && (
            <div className="flex items-center gap-2 mt-3">
              {meeting.rag_indexed && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-violet-50 text-violet-700 rounded-full font-medium border border-violet-100">
                  <Brain className="h-3 w-3" /> Chat Ready
                </span>
              )}
              {hasMoM && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-teal-50 text-teal-700 rounded-full font-medium border border-teal-100">
                  <CheckCircle2 className="h-3 w-3" /> MoM Ready
                </span>
              )}
              {meeting.diagram?.status === "ready" && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full font-medium border border-indigo-100">
                  <GitBranch className="h-3 w-3" /> Diagram Ready
                </span>
              )}
              {meeting.diagram?.status === "pending" && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded-full font-medium border border-blue-100">
                  <Loader2 className="h-3 w-3 animate-spin" /> Generating Diagram…
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Delete button — sits on top of the card, outside the Link */}
      <button
        onClick={e => onDelete(e, meeting)}
        disabled={isDeleting}
        title="Delete meeting"
        className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 z-10"
      >
        {isDeleting
          ? <Loader2 className="h-4 w-4 animate-spin text-red-400" />
          : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
