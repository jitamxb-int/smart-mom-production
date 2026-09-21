import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { chatApi } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role:        "user" | "assistant" | "system";
  content:     string;
  timestamp?:  string;
}

export interface ChatSource {
  meeting_id:   string;
  meeting_title: string;
  relevance:    number;
  excerpt?:     string;
  chunk_index?:  number;
}

export interface ChatSession {
  session_id:   string;
  meeting_id?:  string;
  created_at:   string;
  message_count: number;
}

export interface ChatState {
  // Active conversation
  messages:          ChatMessage[];
  sources:           ChatSource[];
  isStreaming:       boolean;
  error:             string | null;

  // Available meetings for chat
  availableMeetings: Array<{ meeting_id: string; context: string }>;

  // Chat history sessions
  sessions:          ChatSession[];
  sessionsLoading:   boolean;
  sessionsError:     string | null;

  // Current context
  activeMeetingId:   string | null;
  activeMeetingIds:  string[]; // For multi-meeting chat

  // Indexing status
  indexingStatus:    Record<string, { indexed: boolean; status: string }>;
}

const initialState: ChatState = {
  messages:          [],
  sources:           [],
  isStreaming:       false,
  error:             null,

  availableMeetings: [],

  sessions:          [],
  sessionsLoading:   false,
  sessionsError:     null,

  activeMeetingId:   null,
  activeMeetingIds:  [],

  indexingStatus:    {},
};

// ─── Async Thunks ───────────────────────────────────────────────────────────────
export const fetchChatMeetings = createAsyncThunk(
  "chat/fetchMeetings",
  async () => {
    const response = await chatApi.meetings();
    return response.data.data || response.data;
  }
);

export const fetchChatMeetingsByUser = createAsyncThunk(
  "chat/fetchMeetingsByUser",
  async (userId: string) => {
    const response = await chatApi.meetingsByUser(userId);
    return response.data.data || response.data;
  }
);

export const fetchChatHistory = createAsyncThunk(
  "chat/fetchHistory",
  async (meetingId: string) => {
    const response = await chatApi.history(meetingId);
    return response.data.data || response.data;
  }
);

export const fetchChatStatus = createAsyncThunk(
  "chat/fetchStatus",
  async (meetingId: string) => {
    const response = await chatApi.status(meetingId);
    return { meetingId, data: response.data };
  }
);

export const deleteChatSession = createAsyncThunk(
  "chat/deleteSession",
  async (sessionId: string) => {
    await chatApi.deleteSession(sessionId);
    return sessionId;
  }
);

// ─── Slice ─────────────────────────────────────────────────────────────────────
const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    // Message management
    addMessage: (state, action: PayloadAction<ChatMessage>) => {
      state.messages.push(action.payload);
    },
    appendToLastMessage: (state, action: PayloadAction<string>) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        lastMessage.content += action.payload;
      }
    },
    setMessages: (state, action: PayloadAction<ChatMessage[]>) => {
      state.messages = action.payload;
    },
    clearMessages: (state) => {
      state.messages = [];
      state.sources = [];
      state.error = null;
    },

    // Streaming state
    setStreaming: (state, action: PayloadAction<boolean>) => {
      state.isStreaming = action.payload;
    },

    // Sources
    setSources: (state, action: PayloadAction<ChatSource[]>) => {
      state.sources = action.payload;
    },

    // Error handling
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

    // Active meeting context
    setActiveMeetingId: (state, action: PayloadAction<string | null>) => {
      state.activeMeetingId = action.payload;
      state.activeMeetingIds = action.payload ? [action.payload] : [];
    },
    setActiveMeetingIds: (state, action: PayloadAction<string[]>) => {
      state.activeMeetingIds = action.payload;
      state.activeMeetingId = action.payload.length === 1 ? action.payload[0] : null;
    },

    // Indexing status
    setIndexingStatus: (state, action: PayloadAction<{ meetingId: string; indexed: boolean; status: string }>) => {
      state.indexingStatus[action.payload.meetingId] = {
        indexed: action.payload.indexed,
        status: action.payload.status,
      };
    },
    updateIndexingStatus: (state, action: PayloadAction<{ meetingId: string; indexed: boolean }>) => {
      if (state.indexingStatus[action.payload.meetingId]) {
        state.indexingStatus[action.payload.meetingId].indexed = action.payload.indexed;
      }
    },

    // Sessions
    setSessions: (state, action: PayloadAction<ChatSession[]>) => {
      state.sessions = action.payload;
    },
    removeSession: (state, action: PayloadAction<string>) => {
      state.sessions = state.sessions.filter(s => s.session_id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    // ── Fetch Chat Meetings ─────────────────────────────────────────────────────
    builder
      .addCase(fetchChatMeetings.pending, (state) => {
        state.error = null;
      })
      .addCase(fetchChatMeetings.fulfilled, (state, action) => {
        state.availableMeetings = action.payload;
      })
      .addCase(fetchChatMeetings.rejected, (state, action) => {
        state.error = action.error.message || "Failed to fetch available meetings";
      });

    // ── Fetch Chat Meetings By User ────────────────────────────────────────────
    builder
      .addCase(fetchChatMeetingsByUser.pending, (state) => {
        state.error = null;
      })
      .addCase(fetchChatMeetingsByUser.fulfilled, (state, action) => {
        state.availableMeetings = action.payload;
      })
      .addCase(fetchChatMeetingsByUser.rejected, (state, action) => {
        state.error = action.error.message || "Failed to fetch available meetings";
      });

    // ── Fetch Chat History ─────────────────────────────────────────────────────
    builder
      .addCase(fetchChatHistory.pending, (state) => {
        state.sessionsLoading = true;
        state.sessionsError = null;
      })
      .addCase(fetchChatHistory.fulfilled, (state, action) => {
        state.sessionsLoading = false;
        state.sessions = action.payload;
      })
      .addCase(fetchChatHistory.rejected, (state, action) => {
        state.sessionsLoading = false;
        state.sessionsError = action.error.message || "Failed to fetch chat history";
      });

    // ── Fetch Chat Status ───────────────────────────────────────────────────────
    builder
      .addCase(fetchChatStatus.fulfilled, (state, action) => {
        state.indexingStatus[action.payload.meetingId] = {
          indexed: action.payload.data.indexed || false,
          status: action.payload.data.status || "unknown",
        };
      });

    // ── Delete Chat Session ─────────────────────────────────────────────────────
    builder
      .addCase(deleteChatSession.fulfilled, (state, action) => {
        state.sessions = state.sessions.filter(s => s.session_id !== action.payload);
      });
  },
});

export const chatActions = chatSlice.actions;

// ─── Async Action for Streaming Chat ─────────────────────────────────────────────
// This is a thunk that handles the streaming chat logic
export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async (
    { message, meetingId, meetingIds }: { message: string; meetingId?: string; meetingIds?: string[] },
    { dispatch, getState }
  ) => {
    dispatch(chatActions.setError(null));
    dispatch(chatActions.setSources([]));

    // Add user message
    const userMessage: ChatMessage = { role: "user", content: message };
    dispatch(chatActions.addMessage(userMessage));

    // Add empty assistant message for streaming
    dispatch(chatActions.addMessage({ role: "assistant", content: "" }));
    dispatch(chatActions.setStreaming(true));

    const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
    const token = (getState as any)().session.accessToken;

    try {
      const body: Record<string, unknown> = {
        message,
        // Get conversation history (last 10 messages for context)
        conversation_history: (getState as any)().chat.messages.slice(-10).map((m: ChatMessage) => ({
          role: m.role,
          content: m.content,
        })),
      };

      if (meetingIds && meetingIds.length > 0) {
        body.meeting_ids = meetingIds;
      } else if (meetingId) {
        body.meeting_id = meetingId;
      }

      const response = await fetch(`${API_URL}/api/chat`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
          "Accept":        "text/event-stream",
        },
        body:   JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.detail?.message || "Chat request failed");
      }

      const reader  = response.body!.getReader();
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
              dispatch(chatActions.appendToLastMessage(parsed.content));
            } else if (parsed.type === "sources") {
              dispatch(chatActions.setSources(parsed.sources || []));
            } else if (parsed.type === "error") {
              dispatch(chatActions.setError(parsed.message || "An error occurred"));
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        dispatch(chatActions.setError(err.message || "Connection error"));
        // Remove the empty assistant message on error
        const messages = (getState as any)().chat.messages;
        dispatch(chatActions.setMessages(
          messages.filter((_: ChatMessage, i: number) => i !== messages.length - 1)
        ));
      }
    } finally {
      dispatch(chatActions.setStreaming(false));
    }
  }
);

export default chatSlice.reducer;
