"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChatStream } from "@/hooks/useChatStream";
import { chatApi, adminApi } from "@/lib/api";
import {
  Send, StopCircle, Trash2, MessageSquare, ExternalLink,
  ChevronDown, Check, Users, Layers, Search, X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { formatIST } from "@/lib/dateUtils";

interface ChatMeeting { meeting_id: string; context: string; date_time: string; user_id: string; }
interface AdminUser   { user_id: string; email: string; name?: string; }

function MeetingSelector({ meetings, selectedIds, onSelectionChange, isAdmin = false }: {
  meetings: ChatMeeting[]; selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void; isAdmin?: boolean;
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = useMemo(
    () => meetings.filter(m => m.context.toLowerCase().includes(search.toLowerCase()) || m.meeting_id.toLowerCase().includes(search.toLowerCase())),
    [meetings, search],
  );

  const allSelected = selectedIds.size === 0;
  const label = allSelected ? "All meetings" : selectedIds.size === 1
    ? meetings.find(m => selectedIds.has(m.meeting_id))?.context || "1 meeting"
    : `${selectedIds.size} meetings selected`;

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:border-indigo-400 transition-colors max-w-xs">
        <Layers className="h-3.5 w-3.5 text-indigo-600 flex-shrink-0" />
        <span className="truncate text-gray-700">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-80 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
              <Search className="h-3.5 w-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search meetings…" className="flex-1 text-xs bg-transparent outline-none text-gray-700" autoFocus />
              {search && <button onClick={() => setSearch("")}><X className="h-3 w-3 text-gray-400" /></button>}
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            <button onClick={() => onSelectionChange(new Set())} className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-indigo-50 ${allSelected ? "bg-indigo-50" : ""}`}>
              <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${allSelected ? "bg-indigo-600 border-indigo-600" : "border-gray-300"}`}>
                {allSelected && <Check className="h-2.5 w-2.5 text-white" />}
              </div>
              <span className={`font-medium ${allSelected ? "text-indigo-700" : "text-gray-700"}`}>All meetings</span>
              {isAdmin && <span className="ml-auto text-xs text-gray-400">all users</span>}
            </button>
            <div className="border-t border-gray-100 mx-2" />
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 p-3 text-center">No indexed meetings found</p>
            ) : filtered.map(m => {
              const isSel = selectedIds.has(m.meeting_id);
              return (
                <button key={m.meeting_id} onClick={() => toggle(m.meeting_id)} className={`w-full flex items-start gap-2 px-3 py-2.5 text-sm text-left hover:bg-indigo-50 ${isSel ? "bg-indigo-50" : ""}`}>
                  <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center mt-0.5 ${isSel ? "bg-indigo-600 border-indigo-600" : "border-gray-300"}`}>
                    {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`truncate text-xs font-medium ${isSel ? "text-indigo-700" : "text-gray-700"}`}>{m.context}</p>
                    <p className="text-xs text-gray-400 truncate">{formatIST(m.date_time, "date")}{isAdmin && ` · ${m.user_id.slice(0,8)}…`}</p>
                  </div>
                </button>
              );
            })}
          </div>
          {selectedIds.size > 0 && (
            <div className="p-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <span className="text-gray-500">{selectedIds.size} selected</span>
              <button onClick={() => onSelectionChange(new Set())} className="text-indigo-600 hover:underline">Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminUserSelector({ selectedUserId, onSelect }: { selectedUserId: string | null; onSelect: (id: string | null) => void }) {
  const { data } = useQuery({
    queryKey: ["admin-users-chat"],
    queryFn: async () => { const res = await adminApi.users(1, 200); return res.data.data as AdminUser[]; },
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const users    = data || [];
  const selected = users.find(u => u.user_id === selectedUserId);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-50 border border-amber-300 rounded-lg hover:border-amber-400 transition-colors">
        <Users className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-amber-800 text-xs font-medium truncate max-w-[120px]">{selected ? (selected.name || selected.email) : "All users"}</span>
        <ChevronDown className={`h-3 w-3 text-amber-500 flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-56 overflow-y-auto">
            <button onClick={() => { onSelect(null); setOpen(false); }} className={`w-full px-3 py-2.5 text-left text-sm hover:bg-amber-50 ${!selectedUserId ? "bg-amber-50 text-amber-800 font-medium" : "text-gray-700"}`}>All users</button>
            <div className="border-t border-gray-100 mx-2" />
            {users.map(u => (
              <button key={u.user_id} onClick={() => { onSelect(u.user_id); setOpen(false); }} className={`w-full px-3 py-2.5 text-left hover:bg-amber-50 ${selectedUserId === u.user_id ? "bg-amber-50" : ""}`}>
                <p className={`text-sm truncate ${selectedUserId === u.user_id ? "text-amber-800 font-medium" : "text-gray-700"}`}>{u.name || u.email}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatInterfaceProps { meetingId?: string; meetingTitle?: string; }

export function ChatInterface({ meetingId, meetingTitle }: ChatInterfaceProps) {
  const { data: session } = useSession();
  const role    = (session as any)?.role;
  const isAdmin = role === "admin";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adminUserId, setAdminUserId] = useState<string | null>(null);

  const { data: meetingsData } = useQuery({
    queryKey: ["chat-meetings", adminUserId],
    queryFn: async () => {
      if (isAdmin && adminUserId) { const r = await chatApi.meetingsByUser(adminUserId); return r.data.data as ChatMeeting[]; }
      const r = await chatApi.meetings(); return r.data.data as ChatMeeting[];
    },
    enabled: !meetingId,
  });

  const availableMeetings = meetingsData || [];
  const { messages, isStreaming, sources, error, sendMessage, stopStream, clearMessages } = useChatStream();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const idsArray = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
    sendMessage(input.trim(), meetingId, idsArray);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const scopeLabel = meetingTitle ? `Chat about: ${meetingTitle}`
    : selectedIds.size === 0 ? "Chat across all meetings"
    : selectedIds.size === 1 ? `Chat: ${availableMeetings.find(m => selectedIds.has(m.meeting_id))?.context || "1 meeting"}`
    : `Chat: ${selectedIds.size} meetings selected`;

  return (
    <div className="flex flex-col h-full border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 text-indigo-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-800 truncate">{scopeLabel}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && !meetingId && (
            <AdminUserSelector selectedUserId={adminUserId} onSelect={(uid) => { setAdminUserId(uid); setSelectedIds(new Set()); }} />
          )}
          {!meetingId && <MeetingSelector meetings={availableMeetings} selectedIds={selectedIds} onSelectionChange={setSelectedIds} isAdmin={isAdmin} />}
          {messages.length > 0 && (
            <button onClick={clearMessages} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500">
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 font-medium">
          ⚠ Admin mode — access to {adminUserId ? "selected user's" : "all users'"} meeting transcripts
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-2">
            <MessageSquare className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {meetingTitle ? `Ask anything about "${meetingTitle}"`
                : selectedIds.size === 0 ? "Ask anything across all your indexed meetings"
                : `Ask about ${selectedIds.size === 1 ? "this meeting" : "the selected meetings"}`}
            </p>
            {!meetingId && availableMeetings.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No indexed meetings yet. Upload a recording and wait for processing.</p>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
              msg.role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm border border-gray-200"}`}>
              {msg.content}
              {msg.role === "assistant" && isStreaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-4 bg-gray-500 ml-1 animate-pulse" />
              )}
            </div>
          </div>
        ))}
        {sources.length > 0 && !isStreaming && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-semibold text-blue-700 mb-1">Sources used:</p>
            <div className="space-y-1">
              {sources.map((s, i) => (
                <div key={i} className="flex items-center gap-1 text-xs text-blue-600">
                  <ExternalLink className="h-3 w-3" />
                  <span>{s.meeting_title || s.meeting_id}</span>
                  <span className="text-blue-400">(chunk {s.chunk_index})</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t bg-white">
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Ask about your meetings…" rows={1} disabled={isStreaming}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white max-h-32 overflow-y-auto"
            style={{ minHeight: "40px" }} />
          {isStreaming ? (
            <button onClick={stopStream} className="flex-shrink-0 p-2 rounded-xl bg-red-100 text-red-600 hover:bg-red-200">
              <StopCircle className="h-5 w-5" />
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()} className="flex-shrink-0 p-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Send className="h-5 w-5" />
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-1.5 px-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
