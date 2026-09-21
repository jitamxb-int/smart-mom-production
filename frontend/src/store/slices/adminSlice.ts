import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit";
import { adminApi, statsApi } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface AdminUser {
  user_id:       string;
  email:         string;
  name:          string;
  role:          "user" | "admin";
  created_at:    string;
  last_login_at: string;
  avatar_url?:   string;
  auth_provider?: string;
}

export interface AdminStats {
  users:           number;
  meetings:        number;
  chat_sessions:   number;
  meetings_by_status: Record<string, number>;
}

export interface StorageConfig {
  active_backend:   "s3" | "local";
  s3_bucket:        string;
  s3_region:        string;
  local_path:       string;
  changed_at:       string | null;
  changed_by_email: string | null;
}

export interface AdminMeeting {
  meeting_id:   string;
  context:      string;
  date_time:    string;
  status:       string;
  user_id:      string;
  user_email:   string;
  user_name:    string;
  audio_state?: string;
  created_at:   string;
}

interface UsersMeta {
  total: number;
  page:  number;
  limit: number;
}

interface AdminMeetingsMeta {
  total: number;
  page:  number;
  limit: number;
}

// ─── State ─────────────────────────────────────────────────────────────────────
export interface AdminState {
  // Users management
  users:              AdminUser[];
  usersMeta:          UsersMeta | null;
  usersLoading:       boolean;
  usersError:         string | null;

  // Admin stats
  stats:              AdminStats | null;
  statsLoading:       boolean;
  statsError:         string | null;

  // Admin meetings
  adminMeetings:      AdminMeeting[];
  adminMeetingsMeta:  AdminMeetingsMeta | null;
  adminMeetingsLoading: boolean;
  adminMeetingsError: string | null;

  // Chunked meetings (special state for stuck chunks)
  chunkedMeetings:    AdminMeeting[];
  chunkedMeetingsLoading: boolean;
  chunkedMeetingsError: string | null;

  // Storage config
  storageConfig:      StorageConfig | null;
  storageLoading:     boolean;
  storageError:       string | null;

  // Operation states
  roleUpdateLoading:  boolean;
  deleteUserLoading:  boolean;
  indexUnindexedLoading: boolean;
}

const initialState: AdminState = {
  users:                [],
  usersMeta:            null,
  usersLoading:         false,
  usersError:           null,

  stats:                null,
  statsLoading:         false,
  statsError:           null,

  adminMeetings:        [],
  adminMeetingsMeta:    null,
  adminMeetingsLoading: false,
  adminMeetingsError:   null,

  chunkedMeetings:      [],
  chunkedMeetingsLoading: false,
  chunkedMeetingsError: null,

  storageConfig:        null,
  storageLoading:       false,
  storageError:         null,

  roleUpdateLoading:    false,
  deleteUserLoading:    false,
  indexUnindexedLoading: false,
};

// ─── Async Thunks ───────────────────────────────────────────────────────────────
export const fetchAdminUsers = createAsyncThunk(
  "admin/fetchUsers",
  async ({ page = 1, limit = 50 }: { page?: number; limit?: number } = {}) => {
    const response = await adminApi.users(page, limit);
    return response.data.data;
  }
);

export const fetchAdminStats = createAsyncThunk(
  "admin/fetchStats",
  async () => {
    const response = await statsApi.admin();
    return response.data.data;
  }
);

export const fetchAdminMeetings = createAsyncThunk(
  "admin/fetchMeetings",
  async ({ page = 1, limit = 50, userId }: { page?: number; limit?: number; userId?: string } = {}) => {
    const response = await adminApi.meetings(page, limit, userId);
    return response.data.data;
  }
);

export const fetchChunkedMeetings = createAsyncThunk(
  "admin/fetchChunkedMeetings",
  async ({ page = 1, limit = 50 }: { page?: number; limit?: number } = {}) => {
    const response = await adminApi.chunkedMeetings(page, limit);
    return response.data.data;
  }
);

export const fetchStorageConfig = createAsyncThunk(
  "admin/fetchStorageConfig",
  async () => {
    const response = await adminApi.storageConfig();
    return response.data.data;
  }
);

export const updateUserRole = createAsyncThunk(
  "admin/updateRole",
  async ({ userId, role }: { userId: string; role: string }) => {
    const response = await adminApi.setRole(userId, role);
    return { userId, role, data: response.data };
  }
);

export const deleteUser = createAsyncThunk(
  "admin/deleteUser",
  async (userId: string) => {
    await adminApi.deleteUser(userId);
    return userId;
  }
);

export const switchStorageBackend = createAsyncThunk(
  "admin/switchStorage",
  async (backend: "s3" | "local") => {
    const response = await adminApi.setStorageBackend(backend);
    return { backend, data: response.data };
  }
);

export const indexUnindexedMeetings = createAsyncThunk(
  "admin/indexUnindexed",
  async () => {
    const response = await adminApi.indexUnindexed();
    return response.data;
  }
);

// ─── Slice ─────────────────────────────────────────────────────────────────────
const adminSlice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    clearUsers(state) {
      state.users = [];
      state.usersMeta = null;
      state.usersError = null;
    },
    clearAdminMeetings(state) {
      state.adminMeetings = [];
      state.adminMeetingsMeta = null;
      state.adminMeetingsError = null;
    },
    clearChunkedMeetings(state) {
      state.chunkedMeetings = [];
      state.chunkedMeetingsError = null;
    },
    clearErrors(state) {
      state.usersError = null;
      state.statsError = null;
      state.adminMeetingsError = null;
      state.chunkedMeetingsError = null;
      state.storageError = null;
    },
    updateUserOptimistically: (state, action: PayloadAction<{ userId: string; role: string }>) => {
      const user = state.users.find(u => u.user_id === action.payload.userId);
      if (user) {
        user.role = action.payload.role as "user" | "admin";
      }
    },
    removeUserOptimistically: (state, action: PayloadAction<string>) => {
      state.users = state.users.filter(u => u.user_id !== action.payload);
      if (state.usersMeta) {
        state.usersMeta.total -= 1;
      }
    },
  },
  extraReducers: (builder) => {
    // ── Users ────────────────────────────────────────────────────────────────
    builder
      .addCase(fetchAdminUsers.pending, (state) => {
        state.usersLoading = true;
        state.usersError = null;
      })
      .addCase(fetchAdminUsers.fulfilled, (state, action) => {
        state.usersLoading = false;
        state.users = action.payload.users || action.payload; // Handle both formats
        state.usersMeta = action.payload.meta || {
          total: action.payload.length || 0,
          page: action.payload.page || 1,
          limit: action.payload.limit || 50,
        };
      })
      .addCase(fetchAdminUsers.rejected, (state, action) => {
        state.usersLoading = false;
        state.usersError = action.error.message || "Failed to fetch users";
      });

    // ── Stats ─────────────────────────────────────────────────────────────────
    builder
      .addCase(fetchAdminStats.pending, (state) => {
        state.statsLoading = true;
        state.statsError = null;
      })
      .addCase(fetchAdminStats.fulfilled, (state, action) => {
        state.statsLoading = false;
        state.stats = action.payload;
      })
      .addCase(fetchAdminStats.rejected, (state, action) => {
        state.statsLoading = false;
        state.statsError = action.error.message || "Failed to fetch stats";
      });

    // ── Admin Meetings ────────────────────────────────────────────────────────
    builder
      .addCase(fetchAdminMeetings.pending, (state) => {
        state.adminMeetingsLoading = true;
        state.adminMeetingsError = null;
      })
      .addCase(fetchAdminMeetings.fulfilled, (state, action) => {
        state.adminMeetingsLoading = false;
        state.adminMeetings = action.payload.meetings || action.payload;
        state.adminMeetingsMeta = action.payload.meta || {
          total: action.payload.length || 0,
          page: action.payload.page || 1,
          limit: action.payload.limit || 50,
        };
      })
      .addCase(fetchAdminMeetings.rejected, (state, action) => {
        state.adminMeetingsLoading = false;
        state.adminMeetingsError = action.error.message || "Failed to fetch meetings";
      });

    // ── Chunked Meetings ───────────────────────────────────────────────────────
    builder
      .addCase(fetchChunkedMeetings.pending, (state) => {
        state.chunkedMeetingsLoading = true;
        state.chunkedMeetingsError = null;
      })
      .addCase(fetchChunkedMeetings.fulfilled, (state, action) => {
        state.chunkedMeetingsLoading = false;
        state.chunkedMeetings = action.payload.meetings || action.payload;
      })
      .addCase(fetchChunkedMeetings.rejected, (state, action) => {
        state.chunkedMeetingsLoading = false;
        state.chunkedMeetingsError = action.error.message || "Failed to fetch chunked meetings";
      });

    // ── Storage Config ─────────────────────────────────────────────────────────
    builder
      .addCase(fetchStorageConfig.pending, (state) => {
        state.storageLoading = true;
        state.storageError = null;
      })
      .addCase(fetchStorageConfig.fulfilled, (state, action) => {
        state.storageLoading = false;
        state.storageConfig = action.payload;
      })
      .addCase(fetchStorageConfig.rejected, (state, action) => {
        state.storageLoading = false;
        state.storageError = action.error.message || "Failed to fetch storage config";
      })
      .addCase(switchStorageBackend.pending, (state) => {
        state.storageLoading = true;
      })
      .addCase(switchStorageBackend.fulfilled, (state, action) => {
        state.storageLoading = false;
        if (state.storageConfig) {
          state.storageConfig.active_backend = action.payload.backend;
        }
      })
      .addCase(switchStorageBackend.rejected, (state, action) => {
        state.storageLoading = false;
        state.storageError = action.error.message || "Failed to switch storage backend";
      });

    // ── User Role Update ───────────────────────────────────────────────────────
    builder
      .addCase(updateUserRole.pending, (state) => {
        state.roleUpdateLoading = true;
      })
      .addCase(updateUserRole.fulfilled, (state, action) => {
        state.roleUpdateLoading = false;
        const user = state.users.find(u => u.user_id === action.payload.userId);
        if (user) {
          user.role = action.payload.role as "user" | "admin";
        }
      })
      .addCase(updateUserRole.rejected, (state) => {
        state.roleUpdateLoading = false;
      });

    // ── Delete User ────────────────────────────────────────────────────────────
    builder
      .addCase(deleteUser.pending, (state) => {
        state.deleteUserLoading = true;
      })
      .addCase(deleteUser.fulfilled, (state, action) => {
        state.deleteUserLoading = false;
        state.users = state.users.filter(u => u.user_id !== action.payload);
        if (state.usersMeta) {
          state.usersMeta.total -= 1;
        }
      })
      .addCase(deleteUser.rejected, (state) => {
        state.deleteUserLoading = false;
      });

    // ── Index Unindexed ────────────────────────────────────────────────────────
    builder
      .addCase(indexUnindexedMeetings.pending, (state) => {
        state.indexUnindexedLoading = true;
      })
      .addCase(indexUnindexedMeetings.fulfilled, (state) => {
        state.indexUnindexedLoading = false;
      })
      .addCase(indexUnindexedMeetings.rejected, (state) => {
        state.indexUnindexedLoading = false;
      });
  },
});

export const adminActions = adminSlice.actions;
export default adminSlice.reducer;
