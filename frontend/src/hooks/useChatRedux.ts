"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatApi } from "@/lib/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchChatMeetings,
  fetchChatMeetingsByUser,
  fetchChatHistory,
  fetchChatStatus,
  deleteChatSession,
  chatActions,
  sendMessage,
} from "@/store/slices/chatSlice";
import type { ChatMessage, ChatSource, ChatSession } from "@/store/slices/chatSlice";

// ─── Chat Meetings Hook ───────────────────────────────────────────────────────────
export function useChatMeetings(userId?: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const queryKey = userId ? ["chat-meetings", userId] : ["chat-meetings"];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (userId) {
        return await (dispatch(fetchChatMeetingsByUser(userId)) as any).unwrap();
      }
      return await (dispatch(fetchChatMeetings()) as any).unwrap();
    },
    enabled: !!token,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: true,
  });

  const availableMeetings = useAppSelector((s) => s.chat.availableMeetings);
  const error = useAppSelector((s) => s.chat.error);

  return {
    meetings: availableMeetings,
    isLoading: query.isLoading && !availableMeetings.length,
    isError: query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── Chat History Hook ───────────────────────────────────────────────────────────
export function useChatHistory(meetingId: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const sessions = useAppSelector((s) => s.chat.sessions);
  const loading = useAppSelector((s) => s.chat.sessionsLoading);
  const error = useAppSelector((s) => s.chat.sessionsError);

  const query = useQuery({
    queryKey: ["chat-history", meetingId],
    queryFn: async () => (await dispatch(fetchChatHistory(meetingId)) as any).unwrap(),
    enabled: !!token && !!meetingId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  return {
    sessions,
    isLoading: loading || query.isLoading,
    isError: !!error || query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── Chat Status Hook ────────────────────────────────────────────────────────────
export function useChatStatus(meetingId: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);
  const indexingStatus = useAppSelector((s) => s.chat.indexingStatus[meetingId]);

  const query = useQuery({
    queryKey: ["chat-status", meetingId],
    queryFn: async () => (await dispatch(fetchChatStatus(meetingId)) as any).unwrap(),
    enabled: !!token && !!meetingId,
    refetchInterval: (q) => {
      const status = q.state.data?.data?.indexed;
      // Poll every 3 seconds if not indexed yet
      return status === false ? 3000 : false;
    },
    refetchOnWindowFocus: false,
  });

  return {
    indexed: indexingStatus?.indexed ?? false,
    status: indexingStatus?.status ?? "unknown",
    isLoading: query.isLoading && !indexingStatus,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Send Message Hook ───────────────────────────────────────────────────────────
export function useSendMessage() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      message,
      meetingId,
      meetingIds,
    }: {
      message: string;
      meetingId?: string;
      meetingIds?: string[];
    }) => {
      await dispatch(sendMessage({ message, meetingId, meetingIds }));
      // Wait for streaming to complete (handled by thunk)
    },
    onSuccess: () => {
      // Invalidate related queries if needed
      queryClient.invalidateQueries({ queryKey: ["chat-status"] });
    },
  });

  const isStreaming = useAppSelector((s) => s.chat.isStreaming);
  const error = useAppSelector((s) => s.chat.error);

  return {
    sendMessage: mutation.mutate,
    isStreaming,
    error,
  };
}

// ─── Delete Session Hook ─────────────────────────────────────────────────────────
export function useDeleteChatSession() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      (dispatch(deleteChatSession(sessionId)) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-history"] });
    },
  });
}

// ─── Chat State Hook ─────────────────────────────────────────────────────────────
export function useChatState() {
  const dispatch = useAppDispatch();

  const messages = useAppSelector((s) => s.chat.messages);
  const sources = useAppSelector((s) => s.chat.sources);
  const isStreaming = useAppSelector((s) => s.chat.isStreaming);
  const error = useAppSelector((s) => s.chat.error);
  const activeMeetingId = useAppSelector((s) => s.chat.activeMeetingId);
  const activeMeetingIds = useAppSelector((s) => s.chat.activeMeetingIds);

  const setActiveMeeting = useCallback((meetingId: string | null) => {
    dispatch(chatActions.setActiveMeetingId(meetingId));
  }, [dispatch]);

  const setActiveMeetings = useCallback((meetingIds: string[]) => {
    dispatch(chatActions.setActiveMeetingIds(meetingIds));
  }, [dispatch]);

  const clearMessages = useCallback(() => {
    dispatch(chatActions.clearMessages());
  }, [dispatch]);

  const clearError = useCallback(() => {
    dispatch(chatActions.setError(null));
  }, [dispatch]);

  return {
    messages,
    sources,
    isStreaming,
    error,
    activeMeetingId,
    activeMeetingIds,
    setActiveMeeting,
    setActiveMeetings,
    clearMessages,
    clearError,
  };
}

// ─── Combined Chat Hook ──────────────────────────────────────────────────────────
export function useChat(userId?: string) {
  const meetingsQuery = useChatMeetings(userId);
  const chatState = useChatState();
  const { sendMessage, isStreaming } = useSendMessage();

  return {
    // Available meetings
    availableMeetings: meetingsQuery.meetings,
    isLoadingMeetings: meetingsQuery.isLoading,
    refetchMeetings: meetingsQuery.refetch,

    // Chat state
    ...chatState,

    // Actions
    sendMessage,
    isStreaming,
  };
}
