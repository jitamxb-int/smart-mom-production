"use client";

import { useState, useCallback, useRef } from "react";
import { ChatMessage, ChatSource } from "@/types";
import { store } from "@/store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function useChatStream() {
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sources,     setSources]     = useState<ChatSource[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (
    message:     string,
    meetingId?:  string,
    meetingIds?: string[],
  ) => {
    if (!message.trim() || isStreaming) return;

    setError(null);
    setSources([]);

    const userMessage: ChatMessage = { role: "user", content: message };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    abortRef.current = new AbortController();

    try {
      const token = store.getState().session.accessToken;

      const body: Record<string, unknown> = {
        message,
        conversation_history: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
      };
      if (meetingIds && meetingIds.length > 0) {
        body.meeting_ids = meetingIds;
      } else if (meetingId) {
        body.meeting_id = meetingId;
      }

      const resp = await fetch(`${API_URL}/api/chat`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
          "Accept":        "text/event-stream",
        },
        body:   JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.detail?.message || "Chat request failed");
      }

      const reader  = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "token") {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role:    "assistant",
                  content: updated[updated.length - 1].content + parsed.content,
                };
                return updated;
              });
            } else if (parsed.type === "sources") {
              setSources(parsed.sources || []);
            } else if (parsed.type === "error") {
              setError(parsed.message || "An error occurred");
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Connection error");
        setMessages(prev => prev.filter((_, i) => i !== prev.length - 1 || prev[i].content));
      }
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setSources([]);
    setError(null);
  }, []);

  return { messages, isStreaming, sources, error, sendMessage, stopStream, clearMessages };
}
