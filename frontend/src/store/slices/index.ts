// ─── Slice Reducers ───────────────────────────────────────────────────────────────
export { default as sessionReducer } from "./sessionSlice";
export { default as meetingsReducer } from "./meetingsSlice";
export { default as uiReducer } from "./uiSlice";
export { default as adminReducer } from "./adminSlice";
export { default as chatReducer } from "./chatSlice";
export { default as recordingReducer } from "./recordingSlice";
export { default as notificationsReducer } from "./notificationsSlice";

// ─── Session Slice ────────────────────────────────────────────────────────────────
export { sessionActions } from "./sessionSlice";

// ─── Meetings Slice ───────────────────────────────────────────────────────────────
export { meetingsActions } from "./meetingsSlice";

// ─── UI Slice ─────────────────────────────────────────────────────────────────────
export { uiActions } from "./uiSlice";

// ─── Admin Slice ─────────────────────────────────────────────────────────────────
export {
  adminActions,
  fetchAdminUsers,
  fetchAdminStats,
  fetchAdminMeetings,
  fetchChunkedMeetings,
  fetchStorageConfig,
  updateUserRole,
  deleteUser,
  switchStorageBackend,
  indexUnindexedMeetings,
} from "./adminSlice";
export type { AdminUser, AdminStats, StorageConfig, AdminMeeting } from "./adminSlice";
export type { AdminState } from "./adminSlice";

// ─── Chat Slice ───────────────────────────────────────────────────────────────────
export {
  chatActions,
  fetchChatMeetings,
  fetchChatMeetingsByUser,
  fetchChatHistory,
  fetchChatStatus,
  deleteChatSession,
  sendMessage,
} from "./chatSlice";
export type { ChatMessage, ChatSource, ChatSession, ChatState } from "./chatSlice";

// ─── Recording Slice ─────────────────────────────────────────────────────────────
export {
  recordingActions,
  createRecordingMeeting,
  getPresignedUploadUrl,
  uploadAudioChunk,
  mergeAudioChunks,
  uploadAudioDirect,
} from "./recordingSlice";
export type { RecordingStatus, RecordingState } from "./recordingSlice";

// ─── Notifications Slice ─────────────────────────────────────────────────────────
export {
  notificationsActions,
  withNotification,
} from "./notificationsSlice";
export type { Notification, NotificationType, GlobalError, NotificationsState } from "./notificationsSlice";

