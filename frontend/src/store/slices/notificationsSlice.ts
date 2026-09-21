import { createSlice, PayloadAction } from "@reduxjs/toolkit";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type NotificationType = "success" | "error" | "info" | "warning" | "loading";

export interface Notification {
  id:         string;
  type:       NotificationType;
  title?:     string;
  message:    string;
  duration?:  number; // ms, null for persistent
  actions?:   Array<{
    label:   string;
    onClick: () => void;
    primary?: boolean;
  }>;
  createdAt: number;
}

export interface GlobalError {
  id:        string;
  message:   string;
  code?:     string;
  context?:  string; // Where the error occurred
  timestamp: number;
  resolved?: boolean;
}

export interface NotificationsState {
  // Toast notifications
  notifications: Notification[];
  maxNotifications: number;

  // Global errors
  errors:        GlobalError[];
  maxErrors:     number;

  // Loading states (global overlays)
  isLoading:     boolean;
  loadingMessage?: string;

  // Confirmation dialogs
  confirmation:  {
    id:          string | null;
    title:       string;
    message:     string;
    onConfirm:   () => void;
    onCancel:    () => void;
    danger?:     boolean;
  } | null;
}

const initialState: NotificationsState = {
  notifications:      [],
  maxNotifications:   5,

  errors:             [],
  maxErrors:          10,

  isLoading:          false,
  loadingMessage:     undefined,

  confirmation:       null,
};

// ─── Slice ─────────────────────────────────────────────────────────────────────
const notificationsSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    // Add notification
    addNotification: (state, action: PayloadAction<Omit<Notification, "id" | "createdAt">>) => {
      const notification: Notification = {
        ...action.payload,
        id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: Date.now(),
      };

      state.notifications.push(notification);

      // Keep only the most recent notifications
      if (state.notifications.length > state.maxNotifications) {
        state.notifications = state.notifications.slice(-state.maxNotifications);
      }

      // Auto-remove notification after duration (if specified)
      if (notification.duration && notification.duration > 0) {
        // Note: This would typically be handled by the component with setTimeout
        // But we could implement auto-dismissal logic here if needed
      }
    },

    // Remove specific notification
    removeNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(n => n.id !== action.payload);
    },

    // Clear all notifications
    clearNotifications: (state) => {
      state.notifications = [];
    },

    // Quick notification helpers
    showSuccess: (state, action: PayloadAction<{ message: string; title?: string; duration?: number }>) => {
      const notification: Notification = {
        id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "success",
        message: action.payload.message,
        title: action.payload.title,
        duration: action.payload.duration ?? 3000,
        createdAt: Date.now(),
      };
      state.notifications.push(notification);
    },

    showError: (state, action: PayloadAction<{ message: string; title?: string; duration?: number }>) => {
      const notification: Notification = {
        id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "error",
        message: action.payload.message,
        title: action.payload.title,
        duration: action.payload.duration ?? 5000,
        createdAt: Date.now(),
      };
      state.notifications.push(notification);
    },

    showInfo: (state, action: PayloadAction<{ message: string; title?: string; duration?: number }>) => {
      const notification: Notification = {
        id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "info",
        message: action.payload.message,
        title: action.payload.title,
        duration: action.payload.duration ?? 3000,
        createdAt: Date.now(),
      };
      state.notifications.push(notification);
    },

    showWarning: (state, action: PayloadAction<{ message: string; title?: string; duration?: number }>) => {
      const notification: Notification = {
        id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "warning",
        message: action.payload.message,
        title: action.payload.title,
        duration: action.payload.duration ?? 4000,
        createdAt: Date.now(),
      };
      state.notifications.push(notification);
    },

    showLoading: (state, action: PayloadAction<{ message: string; id?: string }>) => {
      const notification: Notification = {
        id: action.payload.id || `loading-${Date.now()}`,
        type: "loading",
        message: action.payload.message,
        duration: 0, // Persistent until explicitly removed
        createdAt: Date.now(),
      };
      // Remove existing loading notifications with same ID
      state.notifications = state.notifications.filter(
        n => !(n.type === "loading" && n.id === notification.id)
      );
      state.notifications.push(notification);
    },

    // Error management
    addError: (state, action: PayloadAction<Omit<GlobalError, "id" | "timestamp">>) => {
      const error: GlobalError = {
        ...action.payload,
        id: `error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
      };

      state.errors.unshift(error);

      // Keep only the most recent errors
      if (state.errors.length > state.maxErrors) {
        state.errors = state.errors.slice(0, state.maxErrors);
      }
    },

    resolveError: (state, action: PayloadAction<string>) => {
      const error = state.errors.find(e => e.id === action.payload);
      if (error) {
        error.resolved = true;
      }
    },

    removeError: (state, action: PayloadAction<string>) => {
      state.errors = state.errors.filter(e => e.id !== action.payload);
    },

    clearErrors: (state) => {
      state.errors = [];
    },

    // Global loading state
    setLoading: (state, action: PayloadAction<{ isLoading: boolean; message?: string }>) => {
      state.isLoading = action.payload.isLoading;
      state.loadingMessage = action.payload.message;
    },

    showGlobalLoading: (state, action: PayloadAction<string | undefined>) => {
      state.isLoading = true;
      state.loadingMessage = action.payload;
    },

    hideLoading: (state) => {
      state.isLoading = false;
      state.loadingMessage = undefined;
    },

    // Confirmation dialog
    showConfirmation: (state, action: PayloadAction<{
      title:     string;
      message:   string;
      onConfirm: () => void;
      onCancel:  () => void;
      danger?:   boolean;
    }>) => {
      state.confirmation = {
        id:       `confirm-${Date.now()}`,
        ...action.payload,
      };
    },

    hideConfirmation: (state) => {
      state.confirmation = null;
    },

    // Prune old notifications (call this periodically)
    pruneOldNotifications: (state, action: PayloadAction<{ maxAge: number }>) => {
      const cutoff = Date.now() - action.payload.maxAge;
      state.notifications = state.notifications.filter(n => n.createdAt > cutoff);
    },
  },
});

export const notificationsActions = notificationsSlice.actions;

// ─── Async action creators for common patterns ──────────────────────────────────
// These can be used to wrap API calls with automatic error/success notifications

// Helper to create an async notification wrapper
export const withNotification = <T extends any[], R>(
  asyncFn: (...args: T) => Promise<R>,
  options: {
    successMessage?: string | ((result: R) => string);
    errorMessage?: string | ((error: any) => string);
    loadingMessage?: string;
  }
) => {
  return async (...args: T): Promise<R> => {
    try {
      const result = await asyncFn(...args);
      if (options.successMessage) {
        const message = typeof options.successMessage === "function"
          ? options.successMessage(result)
          : options.successMessage;
        // This would be dispatched in a thunk
      }
      return result;
    } catch (error: any) {
      const message = typeof options.errorMessage === "function"
        ? options.errorMessage(error)
        : options.errorMessage || error.message || "An error occurred";
      // This would be dispatched in a thunk
      throw error;
    }
  };
};

export default notificationsSlice.reducer;
