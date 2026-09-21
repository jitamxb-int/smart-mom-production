"use client";

import { useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meetingsApi } from "@/lib/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createRecordingMeeting,
  getPresignedUploadUrl,
  uploadAudioChunk,
  mergeAudioChunks,
  uploadAudioDirect,
  recordingActions,
} from "@/store/slices/recordingSlice";
import type { RecordingStatus } from "@/store/slices/recordingSlice";

// ─── Recording State Hook ────────────────────────────────────────────────────────
export function useRecordingState() {
  const dispatch = useAppDispatch();

  const status = useAppSelector((s) => s.recording.status);
  const meetingId = useAppSelector((s) => s.recording.meetingId);
  const meetingTitle = useAppSelector((s) => s.recording.meetingTitle);
  const recordingDuration = useAppSelector((s) => s.recording.recordingDuration);
  const uploadProgress = useAppSelector((s) => s.recording.uploadProgress);
  const uploadSpeed = useAppSelector((s) => s.recording.uploadSpeed);
  const uploadTimeRemaining = useAppSelector((s) => s.recording.uploadTimeRemaining);
  const error = useAppSelector((s) => s.recording.error);
  const audioBlob = useAppSelector((s) => s.recording.audioBlob);
  const audioUrl = useAppSelector((s) => s.recording.audioUrl);

  const isRecording = status === "recording" || status === "paused";
  const isPaused = status === "paused";
  const isUploading = status === "uploading" || status === "processing";
  const isIdle = status === "idle";
  const hasError = status === "error";

  const setStatus = useCallback((newStatus: RecordingStatus) => {
    dispatch(recordingActions.setStatus(newStatus));
  }, [dispatch]);

  const setMeetingTitle = useCallback((title: string) => {
    dispatch(recordingActions.setMeetingTitle(title));
  }, [dispatch]);

  const setError = useCallback((err: string | null) => {
    dispatch(recordingActions.setError(err));
  }, [dispatch]);

  const reset = useCallback(() => {
    dispatch(recordingActions.resetRecording());
  }, [dispatch]);

  return {
    // State
    status,
    meetingId,
    meetingTitle,
    recordingDuration,
    uploadProgress,
    uploadSpeed,
    uploadTimeRemaining,
    error,
    audioBlob,
    audioUrl,

    // Computed
    isRecording,
    isPaused,
    isUploading,
    isIdle,
    hasError,

    // Actions
    setStatus,
    setMeetingTitle,
    setError,
    reset,
  };
}

// ─── Create Meeting Hook ─────────────────────────────────────────────────────────
export function useCreateMeeting() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ title, context }: { title: string; context?: string }) =>
      (await dispatch(createRecordingMeeting({ title, context })) as any).unwrap(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      return data;
    },
  });

  return {
    createMeeting: mutation.mutate,
    isCreating: mutation.isPending,
    error: mutation.error,
    createdMeetingId: mutation.data?.meeting_id,
  };
}

// ─── Recording Controls Hook ─────────────────────────────────────────────────────
export function useRecordingControls() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  const createMeetingMutation = useMutation({
    mutationFn: async ({ title, context }: { title: string; context?: string }) =>
      (await dispatch(createRecordingMeeting({ title, context })) as any).unwrap(),
  });

  const uploadChunkMutation = useMutation({
    mutationFn: async ({
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
    }) =>
      (await dispatch(uploadAudioChunk({ meetingId, blob, chunkId, isFinal, mimeType })) as any).unwrap(),
  });

  const mergeChunksMutation = useMutation({
    mutationFn: async (meetingId: string) =>
      (await dispatch(mergeAudioChunks(meetingId)) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const uploadDirectMutation = useMutation({
    mutationFn: async ({
      meetingId,
      formData,
      onProgress,
    }: {
      meetingId: string;
      formData: FormData;
      onProgress?: (progress: number) => void;
    }) =>
      (await dispatch(uploadAudioDirect({ meetingId, formData, onProgress })) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const startRecording = useCallback(async (title: string, context?: string) => {
    try {
      const result = await createMeetingMutation.mutateAsync({ title, context });
      dispatch(recordingActions.startRecording({
        meetingId: result.meeting_id,
        title: result.context || title,
      }));
      return result.meeting_id;
    } catch (error) {
      dispatch(recordingActions.setError(error instanceof Error ? error.message : "Failed to start recording"));
      throw error;
    }
  }, [createMeetingMutation, dispatch]);

  const pauseRecording = useCallback(() => {
    dispatch(recordingActions.pauseRecording());
  }, [dispatch]);

  const resumeRecording = useCallback(() => {
    dispatch(recordingActions.resumeRecording());
  }, [dispatch]);

  const stopRecording = useCallback(() => {
    dispatch(recordingActions.stopRecording());
  }, [dispatch]);

  const cancelRecording = useCallback(() => {
    dispatch(recordingActions.resetRecording());
  }, [dispatch]);

  const uploadChunk = useCallback((
    blob: Blob,
    chunkId: number,
    isFinal: boolean,
    mimeType: string
  ) => {
    const meetingId = useAppSelector((s) => s.recording.meetingId);
    if (!meetingId) {
      throw new Error("No active meeting");
    }
    return uploadChunkMutation.mutateAsync({
      meetingId,
      blob,
      chunkId,
      isFinal,
      mimeType,
    });
  }, [uploadChunkMutation]);

  const finishRecording = useCallback(async () => {
    const meetingId = useAppSelector((s) => s.recording.meetingId);
    if (!meetingId) {
      throw new Error("No active meeting");
    }
    dispatch(recordingActions.stopRecording());
    return await mergeChunksMutation.mutateAsync(meetingId);
  }, [mergeChunksMutation, dispatch]);

  const uploadDirect = useCallback((
    formData: FormData,
    onProgress?: (progress: number) => void
  ) => {
    const meetingId = useAppSelector((s) => s.recording.meetingId);
    if (!meetingId) {
      throw new Error("No active meeting");
    }
    return uploadDirectMutation.mutateAsync({
      meetingId,
      formData,
      onProgress,
    });
  }, [uploadDirectMutation]);

  return {
    // State
    isCreating: createMeetingMutation.isPending,
    isUploading: uploadChunkMutation.isPending || mergeChunksMutation.isPending,
    error: createMeetingMutation.error || uploadChunkMutation.error || mergeChunksMutation.error,

    // Actions
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    uploadChunk,
    finishRecording,
    uploadDirect,
  };
}

// ─── Recording Duration Hook ─────────────────────────────────────────────────────
export function useRecordingDuration() {
  const dispatch = useAppDispatch();
  const duration = useAppSelector((s) => s.recording.recordingDuration);
  const isRecording = useAppSelector((s) =>
    s.recording.status === "recording" || s.recording.status === "paused"
  );

  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      dispatch(recordingActions.incrementRecordingDuration());
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, dispatch]);

  const resetDuration = useCallback(() => {
    dispatch(recordingActions.setRecordingDuration(0));
  }, [dispatch]);

  return {
    duration,
    resetDuration,
  };
}

// ─── Upload Progress Hook ────────────────────────────────────────────────────────
export function useUploadProgress() {
  const dispatch = useAppDispatch();

  const progress = useAppSelector((s) => s.recording.uploadProgress);
  const speed = useAppSelector((s) => s.recording.uploadSpeed);
  const timeRemaining = useAppSelector((s) => s.recording.uploadTimeRemaining);

  const setProgress = useCallback((value: number) => {
    dispatch(recordingActions.setUploadProgress(value));
  }, [dispatch]);

  const setSpeed = useCallback((bytesPerSecond: number) => {
    dispatch(recordingActions.setUploadSpeed(bytesPerSecond));
  }, [dispatch]);

  const setTimeRemaining = useCallback((seconds: number) => {
    dispatch(recordingActions.setUploadTimeRemaining(seconds));
  }, [dispatch]);

  const resetProgress = useCallback(() => {
    dispatch(recordingActions.setUploadProgress(0));
    dispatch(recordingActions.setUploadSpeed(0));
    dispatch(recordingActions.setUploadTimeRemaining(0));
  }, [dispatch]);

  return {
    progress,
    speed,
    timeRemaining,
    setProgress,
    setSpeed,
    setTimeRemaining,
    resetProgress,
  };
}

// ─── Combined Recording Hook ─────────────────────────────────────────────────────
export function useRecording() {
  const state = useRecordingState();
  const controls = useRecordingControls();
  const duration = useRecordingDuration();
  const uploadProgress = useUploadProgress();

  return {
    ...state,
    ...controls,
    duration: duration.duration,
    resetDuration: duration.resetDuration,
    uploadProgress: uploadProgress.progress,
    uploadSpeed: uploadProgress.speed,
    uploadTimeRemaining: uploadProgress.timeRemaining,
    setUploadProgress: uploadProgress.setProgress,
    resetUploadProgress: uploadProgress.resetProgress,
  };
}
