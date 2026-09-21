import { configureStore } from "@reduxjs/toolkit";
import sessionReducer from "./slices/sessionSlice";
import meetingsReducer from "./slices/meetingsSlice";
import uiReducer from "./slices/uiSlice";
import adminReducer from "./slices/adminSlice";
import chatReducer from "./slices/chatSlice";
import recordingReducer from "./slices/recordingSlice";
import notificationsReducer from "./slices/notificationsSlice";

export const store = configureStore({
  reducer: {
    session:       sessionReducer,
    meetings:      meetingsReducer,
    ui:            uiReducer,
    admin:         adminReducer,
    chat:          chatReducer,
    recording:     recordingReducer,
    notifications: notificationsReducer,
  },
  // Middleware is automatically added, including redux-thunk
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for serialization checks (needed for non-serializable data like Blobs, Dates)
        ignoredActions: [
          "recording/setAudioBlob",
        ],
        // Ignore these paths in the state for serialization checks
        ignoredPaths: [
          "recording.audioBlob",
        ],
      },
    }),
});

// ─── Type exports ───────────────────────────────────────────────────────────────
export type RootState   = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
