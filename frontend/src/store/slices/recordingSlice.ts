import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { meetingsApi } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type RecordingStatus = "idle" | "requesting" | "recording" | "paused" | "uploading" | "processing" | "completed" | "error";

export interface RecordingState {
  // Recording session state
  status:              RecordingStatus;
  meetingId:           string | null;
  meetingTitle:        string;

  // Upload progress
  uploadProgress:      number; // 0-100
  uploadSpeed:         number; // bytes per second
  uploadTimeRemaining: number; // seconds

  // Recording metrics
  recordingDuration:   number; // seconds
  audioBlob:           Blob | null;
  audioUrl:            string | null; // For preview

  // Chunk upload state
  chunkCount:          number;
  lastChunkTime:       number;

  // Error handling
  error:               string | null;

  // Presigned upload URL
  presignedUrl:        string | null;

  // Meeting creation pending state
  isCreatingMeeting:   boolean;
}

const initialState: RecordingState = {
  status:              "idle",
  meetingId:           null,
  meetingTitle:        "",

  uploadProgress:      0,
  uploadSpeed:         0,
  uploadTimeRemaining: 0,

  recordingDuration:   0,
  audioBlob:           null,
  audioUrl:            null,

  chunkCount:          0,
  lastChunkTime:       0,

  error:               null,

  presignedUrl:        null,

  isCreatingMeeting:   false,
};

// ─── Async Thunks ───────────────────────────────────────────────────────────────
export const createRecordingMeeting = createAsyncThunk(
  "recording/createMeeting",
  async ({ title, context }: { title: string; context?: string }) => {
    const response = await meetingsApi.create({
      context: context || title,
      title,
      status:  "recording",
    });
    return response.data.data;
  }
);

export const getPresignedUploadUrl = createAsyncThunk(
  "recording/getPresignedUrl",
  async (meetingId: string) => {
    const response = await meetingsApi.presignedUpload(meetingId);
    return response.data;
  }
);

export const uploadAudioChunk = createAsyncThunk(
  "recording/uploadChunk",
  async (
    {
      meetingId,
      blob,
      chunkId,
      isFinal,
      mimeType,
    }: {
      meetingId: string;
      blob: Blob;
      chunkId: number;
      isFinal: boolean;
      mimeType: string;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const response = await meetingsApi.uploadChunk(
        meetingId,
        blob,
        chunkId,
        isFinal,
        mimeType
      );
      return { chunkId, response: response.data };
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.detail?.message || error.message);
    }
  }
);

export const mergeAudioChunks = createAsyncThunk(
  "recording/mergeChunks",
  async (meetingId: string) => {
    const response = await meetingsApi.mergeChunks(meetingId);
    return response.data;
  }
);

export const uploadAudioDirect = createAsyncThunk(
  "recording/uploadDirect",
  async (
    {
      meetingId,
      formData,
      onProgress,
    }: {
      meetingId: string;
      formData: FormData;
      onProgress?: (progress: number) => void;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const response = await meetingsApi.uploadAudioDirectAxios(formData, onProgress);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.detail?.message || error.message);
    }
  }
);

// ─── Slice ─────────────────────────────────────────────────────────────────────
const recordingSlice = createSlice({
  name: "recording",
  initialState,
  reducers: {
    // Recording lifecycle
    setStatus: (state, action: PayloadAction<RecordingStatus>) => {
      state.status = action.payload;
    },
    startRecording: (state, action: PayloadAction<{ meetingId: string; title?: string }>) => {
      state.status = "recording";
      state.meetingId = action.payload.meetingId;
      state.meetingTitle = action.payload.title || "";
      state.recordingDuration = 0;
      state.chunkCount = 0;
      state.error = null;
    },
    pauseRecording: (state) => {
      state.status = "paused";
    },
    resumeRecording: (state) => {
      state.status = "recording";
    },
    stopRecording: (state) => {
      state.status = "uploading";
    },

    // Meeting title
    setMeetingTitle: (state, action: PayloadAction<string>) => {
      state.meetingTitle = action.payload;
    },

    // Upload progress
    setUploadProgress: (state, action: PayloadAction<number>) => {
      state.uploadProgress = Math.max(0, Math.min(100, action.payload));
    },
    setUploadSpeed: (state, action: PayloadAction<number>) => {
      state.uploadSpeed = action.payload;
    },
    setUploadTimeRemaining: (state, action: PayloadAction<number>) => {
      state.uploadTimeRemaining = action.payload;
    },
    incrementUploadProgress: (state, action: PayloadAction<number>) => {
      state.uploadProgress = Math.min(100, state.uploadProgress + action.payload);
    },

    // Recording metrics
    setRecordingDuration: (state, action: PayloadAction<number>) => {
      state.recordingDuration = action.payload;
    },
    incrementRecordingDuration: (state) => {
      state.recordingDuration += 1;
    },

    // Audio blob and URL
    setAudioBlob: (state, action: PayloadAction<Blob | null>) => {
      state.audioBlob = action.payload;
      // Revoke old URL if exists
      if (state.audioUrl && typeof URL !== "undefined") {
        URL.revokeObjectURL(state.audioUrl);
      }
      // Create new URL
      if (action.payload) {
        state.audioUrl = URL.createObjectURL(action.payload);
      } else {
        state.audioUrl = null;
      }
    },

    // Chunk management
    incrementChunkCount: (state) => {
      state.chunkCount += 1;
      state.lastChunkTime = Date.now();
    },
    setChunkCount: (state, action: PayloadAction<number>) => {
      state.chunkCount = action.payload;
    },

    // Error handling
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      if (action.payload) {
        state.status = "error";
      }
    },

    // Reset state
    resetRecording: (state) => {
      // Revoke URL if exists
      if (state.audioUrl && typeof URL !== "undefined") {
        URL.revokeObjectURL(state.audioUrl);
      }
      return { ...initialState };
    },

    // Partial reset for new recording
    resetForNewRecording: (state) => {
      state.status = "idle";
      state.meetingId = null;
      state.meetingTitle = "";
      state.uploadProgress = 0;
      state.uploadSpeed = 0;
      state.uploadTimeRemaining = 0;
      state.recordingDuration = 0;
      state.chunkCount = 0;
      state.error = null;
      if (state.audioUrl && typeof URL !== "undefined") {
        URL.revokeObjectURL(state.audioUrl);
      }
      state.audioBlob = null;
      state.audioUrl = null;
    },
  },
  extraReducers: (builder) => {
    // ── Create Meeting ─────────────────────────────────────────────────────────
    builder
      .addCase(createRecordingMeeting.pending, (state) => {
        state.status = "requesting";
        state.isCreatingMeeting = true;
        state.error = null;
      })
      .addCase(createRecordingMeeting.fulfilled, (state, action) => {
        state.status = "recording";
        state.isCreatingMeeting = false;
        state.meetingId = action.payload.meeting_id;
        state.meetingTitle = action.payload.context || "";
      })
      .addCase(createRecordingMeeting.rejected, (state, action) => {
        state.status = "error";
        state.isCreatingMeeting = false;
        state.error = action.error.message || "Failed to create meeting";
      });

    // ── Get Presigned URL ───────────────────────────────────────────────────────
    builder
      .addCase(getPresignedUploadUrl.fulfilled, (state, action) => {
        state.presignedUrl = action.payload.upload_url || action.payload.url || null;
      })
      .addCase(getPresignedUploadUrl.rejected, (state, action) => {
        state.error = action.error.message || "Failed to get upload URL";
      });

    // ── Upload Chunk ────────────────────────────────────────────────────────────
    builder
      .addCase(uploadAudioChunk.pending, (state, action) => {
        // Update progress based on chunk ID (rough estimate)
        state.status = "uploading";
      })
      .addCase(uploadAudioChunk.fulfilled, (state, action) => {
        state.chunkCount += 1;
        state.lastChunkTime = Date.now();
      })
      .addCase(uploadAudioChunk.rejected, (state, action) => {
        state.error = action.payload as string || "Failed to upload chunk";
        state.status = "error";
      });

    // ── Merge Chunks ────────────────────────────────────────────────────────────
    builder
      .addCase(mergeAudioChunks.pending, (state) => {
        state.status = "processing";
      })
      .addCase(mergeAudioChunks.fulfilled, (state) => {
        state.status = "completed";
        state.uploadProgress = 100;
      })
      .addCase(mergeAudioChunks.rejected, (state, action) => {
        state.error = action.error.message || "Failed to merge audio chunks";
        state.status = "error";
      });

    // ── Upload Direct ───────────────────────────────────────────────────────────
    builder
      .addCase(uploadAudioDirect.pending, (state) => {
        state.status = "uploading";
        state.uploadProgress = 0;
        state.error = null;
      })
      .addCase(uploadAudioDirect.fulfilled, (state) => {
        state.status = "processing";
        state.uploadProgress = 100;
      })
      .addCase(uploadAudioDirect.rejected, (state, action) => {
        state.error = action.payload as string || "Failed to upload audio";
        state.status = "error";
      });
  },
});

export const recordingActions = recordingSlice.actions;

// ─── Selectors ──────────────────────────────────────────────────────────────────
export const selectRecordingState = (state: { recording: RecordingState }) => state.recording;
export const selectIsRecording = (state: { recording: RecordingState }) =>
  state.recording.status === "recording";
export const selectIsUploading = (state: { recording: RecordingState }) =>
  state.recording.status === "uploading" || state.recording.status === "processing";

export default recordingSlice.reducer;
