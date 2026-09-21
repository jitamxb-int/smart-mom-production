import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./index";
import type { RecordingState } from "./slices/recordingSlice";
import type { AdminState } from "./slices/adminSlice";
import type { ChatState } from "./slices/chatSlice";
import type { NotificationsState } from "./slices/notificationsSlice";

// ─── Base hooks ─────────────────────────────────────────────────────────────────
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = <T>(selector: (state: RootState) => T): T =>
  useSelector(selector);

// ─── Session hooks ──────────────────────────────────────────────────────────────
export const useSession = () => {
  return useAppSelector((state) => state.session);
};

export const useUser = () => {
  return useAppSelector((state) => state.session.user);
};

export const useUserRole = () => {
  return useAppSelector((state) => state.session.role);
};

export const useAuthToken = () => {
  return useAppSelector((state) => state.session.accessToken);
};

export const useIsAdmin = () => {
  return useAppSelector((state) => state.session.role === "admin");
};

export const useIsSimpleUser = () => {
  return useAppSelector((state) => state.session.role === "user");
};

// ─── Meetings hooks ─────────────────────────────────────────────────────────────
export const useMeetingsState = () => {
  return useAppSelector((state) => state.meetings);
};

export const useMeeting = (meetingId: string) => {
  return useAppSelector((state) => state.meetings.byId[meetingId]);
};

export const useMeetingsList = (page: number) => {
  return useAppSelector((state) => ({
    meetings: state.meetings.pages[page] || [],
    meta:     state.meetings.meta,
    loading:  state.meetings.listLoading,
  }));
};

export const useStats = () => {
  return useAppSelector((state) => ({
    stats:   state.meetings.stats,
    loading: state.meetings.statsLoading,
  }));
};

// ─── UI hooks ───────────────────────────────────────────────────────────────────
export const useUIState = () => {
  return useAppSelector((state) => state.ui);
};

export const useNavigating = () => {
  return useAppSelector((state) => state.ui.navigating);
};

export const useVisitedRoutes = () => {
  return useAppSelector((state) => state.ui.visitedRoutes);
};

// ─── Admin hooks ────────────────────────────────────────────────────────────────
export const useAdminState = () => {
  return useAppSelector((state) => state.admin);
};

export const useAdminUsers = () => {
  return useAppSelector((state) => ({
    users:   state.admin.users,
    meta:    state.admin.usersMeta,
    loading: state.admin.usersLoading,
    error:   state.admin.usersError,
  }));
};

export const useAdminStats = () => {
  return useAppSelector((state) => ({
    stats:   state.admin.stats,
    loading: state.admin.statsLoading,
    error:   state.admin.statsError,
  }));
};

export const useAdminMeetings = () => {
  return useAppSelector((state) => ({
    meetings: state.admin.adminMeetings,
    meta:     state.admin.adminMeetingsMeta,
    loading:  state.admin.adminMeetingsLoading,
    error:    state.admin.adminMeetingsError,
  }));
};

export const useChunkedMeetings = () => {
  return useAppSelector((state) => ({
    meetings: state.admin.chunkedMeetings,
    loading:  state.admin.chunkedMeetingsLoading,
    error:    state.admin.chunkedMeetingsError,
  }));
};

export const useStorageConfig = () => {
  return useAppSelector((state) => ({
    config:  state.admin.storageConfig,
    loading: state.admin.storageLoading,
    error:   state.admin.storageError,
  }));
};

// ─── Chat hooks ─────────────────────────────────────────────────────────────────
export const useChatState = () => {
  return useAppSelector((state) => state.chat);
};

export const useChatMessages = () => {
  return useAppSelector((state) => ({
    messages:    state.chat.messages,
    isStreaming: state.chat.isStreaming,
    error:       state.chat.error,
  }));
};

export const useChatSources = () => {
  return useAppSelector((state) => state.chat.sources);
};

export const useChatAvailableMeetings = () => {
  return useAppSelector((state) => state.chat.availableMeetings);
};

export const useChatContext = () => {
  return useAppSelector((state) => ({
    activeMeetingId:  state.chat.activeMeetingId,
    activeMeetingIds: state.chat.activeMeetingIds,
  }));
};

export const useChatSessions = () => {
  return useAppSelector((state) => ({
    sessions: state.chat.sessions,
    loading:  state.chat.sessionsLoading,
    error:    state.chat.sessionsError,
  }));
};

export const useIndexingStatus = (meetingId: string) => {
  return useAppSelector((state) => state.chat.indexingStatus[meetingId]);
};

// ─── Recording hooks ────────────────────────────────────────────────────────────
export const useRecordingState = () => {
  return useAppSelector((state) => state.recording);
};

export const useRecording = () => {
  return useAppSelector((state) => ({
    status:            state.recording.status,
    meetingId:         state.recording.meetingId,
    meetingTitle:      state.recording.meetingTitle,
    recordingDuration: state.recording.recordingDuration,
  }));
};

export const useUploadProgress = () => {
  return useAppSelector((state) => ({
    progress:     state.recording.uploadProgress,
    speed:        state.recording.uploadSpeed,
    timeRemaining: state.recording.uploadTimeRemaining,
  }));
};

export const useIsRecording = () => {
  return useAppSelector((state) =>
    state.recording.status === "recording" || state.recording.status === "paused"
  );
};

export const useIsUploading = () => {
  return useAppSelector((state) =>
    state.recording.status === "uploading" || state.recording.status === "processing"
  );
};

export const useRecordingError = () => {
  return useAppSelector((state) => state.recording.error);
};

// ─── Notifications hooks ────────────────────────────────────────────────────────
export const useNotifications = () => {
  return useAppSelector((state) => state.notifications);
};

export const useNotificationsList = () => {
  return useAppSelector((state) => state.notifications.notifications);
};

export const useErrors = () => {
  return useAppSelector((state) => state.notifications.errors);
};

export const useGlobalLoading = () => {
  return useAppSelector((state) => ({
    isLoading: state.notifications.isLoading,
    message:   state.notifications.loadingMessage,
  }));
};

export const useConfirmation = () => {
  return useAppSelector((state) => state.notifications.confirmation);
};

// ─── Action hooks (for dispatching common actions) ─────────────────────────────
import { notificationsActions } from "./slices/notificationsSlice";
import { chatActions } from "./slices/chatSlice";
import { recordingActions } from "./slices/recordingSlice";

export const useNotify = () => {
  const dispatch = useAppDispatch();

  return {
    success: (message: string, title?: string) =>
      dispatch(notificationsActions.showSuccess({ message, title })),
    error: (message: string, title?: string) =>
      dispatch(notificationsActions.showError({ message, title })),
    info: (message: string, title?: string) =>
      dispatch(notificationsActions.showInfo({ message, title })),
    warning: (message: string, title?: string) =>
      dispatch(notificationsActions.showWarning({ message, title })),
    loading: (message: string, id?: string) =>
      dispatch(notificationsActions.showLoading({ message, id })),
    remove: (id: string) =>
      dispatch(notificationsActions.removeNotification(id)),
    clear: () =>
      dispatch(notificationsActions.clearNotifications()),
    showGlobalLoading: (message?: string) =>
      dispatch(notificationsActions.showGlobalLoading(message)),
    hideLoading: () =>
      dispatch(notificationsActions.hideLoading()),
  };
};

export const useChatActions = () => {
  const dispatch = useAppDispatch();

  return {
    setActiveMeeting: (meetingId: string | null) =>
      dispatch(chatActions.setActiveMeetingId(meetingId)),
    setActiveMeetings: (meetingIds: string[]) =>
      dispatch(chatActions.setActiveMeetingIds(meetingIds)),
    clearMessages: () =>
      dispatch(chatActions.clearMessages()),
    setError: (error: string | null) =>
      dispatch(chatActions.setError(error)),
  };
};

export const useRecordingActions = () => {
  const dispatch = useAppDispatch();

  return {
    startRecording: (meetingId: string, title?: string) =>
      dispatch(recordingActions.startRecording({ meetingId, title })),
    pauseRecording: () =>
      dispatch(recordingActions.pauseRecording()),
    resumeRecording: () =>
      dispatch(recordingActions.resumeRecording()),
    stopRecording: () =>
      dispatch(recordingActions.stopRecording()),
    setTitle: (title: string) =>
      dispatch(recordingActions.setMeetingTitle(title)),
    setError: (error: string | null) =>
      dispatch(recordingActions.setError(error)),
    reset: () =>
      dispatch(recordingActions.resetRecording()),
  };
};
