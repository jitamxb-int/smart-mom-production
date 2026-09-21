"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminUsers,
  fetchAdminStats,
  fetchAdminMeetings,
  fetchChunkedMeetings,
  fetchStorageConfig,
  updateUserRole,
  deleteUser,
  switchStorageBackend,
  indexUnindexedMeetings,
} from "@/store/slices/adminSlice";
import type { AdminUser, StorageConfig } from "@/store/slices/adminSlice";

// ─── Admin Users Hook ───────────────────────────────────────────────────────────
export function useAdminUsers(page = 1, limit = 50) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const query = useQuery({
    queryKey: ["admin-users", page, limit],
    queryFn: async () => (await dispatch(fetchAdminUsers({ page, limit })) as any).unwrap(),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  // Get data from Redux state (populated by the thunk)
  const users = useAppSelector((s) => s.admin.users);
  const meta = useAppSelector((s) => s.admin.usersMeta);
  const loading = useAppSelector((s) => s.admin.usersLoading);
  const error = useAppSelector((s) => s.admin.usersError);

  return {
    users,
    meta,
    isLoading: loading || query.isLoading,
    isError: !!error || query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── Admin Stats Hook ───────────────────────────────────────────────────────────
export function useAdminStatsData() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const query = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await dispatch(fetchAdminStats()) as any).unwrap(),
    enabled: !!token,
    refetchInterval: 30000, // Refresh every 30 seconds
    refetchOnWindowFocus: true,
  });

  const stats = useAppSelector((s) => s.admin.stats);
  const loading = useAppSelector((s) => s.admin.statsLoading);
  const error = useAppSelector((s) => s.admin.statsError);

  return {
    stats,
    isLoading: loading || query.isLoading,
    isError: !!error || query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── Admin Meetings Hook ────────────────────────────────────────────────────────
export function useAdminMeetingsData(page = 1, limit = 50, userId?: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const query = useQuery({
    queryKey: ["admin-meetings", page, limit, userId],
    queryFn: async () => (await dispatch(fetchAdminMeetings({ page, limit, userId })) as any).unwrap(),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const meetings = useAppSelector((s) => s.admin.adminMeetings);
  const meta = useAppSelector((s) => s.admin.adminMeetingsMeta);
  const loading = useAppSelector((s) => s.admin.adminMeetingsLoading);
  const error = useAppSelector((s) => s.admin.adminMeetingsError);

  return {
    meetings,
    meta,
    isLoading: loading || query.isLoading,
    isError: !!error || query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── Chunked Meetings Hook ───────────────────────────────────────────────────────
export function useChunkedMeetingsData(page = 1, limit = 50) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const query = useQuery({
    queryKey: ["admin-chunked-meetings", page, limit],
    queryFn: async () => (await dispatch(fetchChunkedMeetings({ page, limit })) as any).unwrap(),
    enabled: !!token,
    refetchInterval: 10000, // Refresh every 10 seconds
    refetchOnWindowFocus: true,
  });

  const meetings = useAppSelector((s) => s.admin.chunkedMeetings);
  const loading = useAppSelector((s) => s.admin.chunkedMeetingsLoading);
  const error = useAppSelector((s) => s.admin.chunkedMeetingsError);

  return {
    meetings,
    isLoading: loading || query.isLoading,
    isError: !!error || query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── Storage Config Hook ────────────────────────────────────────────────────────
export function useStorageConfigData() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);

  const query = useQuery({
    queryKey: ["admin-storage-config"],
    queryFn: async () => (await dispatch(fetchStorageConfig()) as any).unwrap(),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const config = useAppSelector((s) => s.admin.storageConfig);
  const loading = useAppSelector((s) => s.admin.storageLoading);
  const error = useAppSelector((s) => s.admin.storageError);

  return {
    config,
    isLoading: loading || query.isLoading,
    isError: !!error || query.isError,
    error,
    refetch: query.refetch,
  };
}

// ─── User Role Mutation Hook ────────────────────────────────────────────────────
export function useUpdateUserRole() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      (dispatch(updateUserRole({ userId, role })) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

// ─── Delete User Mutation Hook ───────────────────────────────────────────────────
export function useDeleteUserMutation() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => (dispatch(deleteUser(userId)) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
}

// ─── Switch Storage Backend Hook ─────────────────────────────────────────────────
export function useSwitchStorageBackend() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (backend: "s3" | "local") =>
      (dispatch(switchStorageBackend(backend)) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-storage-config"] });
    },
  });
}

// ─── Index Unindexed Meetings Hook ───────────────────────────────────────────────
export function useIndexUnindexed() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => (dispatch(indexUnindexedMeetings()) as any).unwrap(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin-meetings"] });
    },
  });
}

// ─── Combined Admin Hook ─────────────────────────────────────────────────────────
export function useAdminData() {
  const token = useAppSelector((s) => s.session.accessToken);

  const stats = useAdminStatsData();
  const users = useAdminUsers(1, 50);

  return {
    stats: stats.stats,
    users: users.users,
    usersMeta: users.meta,
    isLoadingStats: stats.isLoading,
    isLoadingUsers: users.isLoading,
    isError: stats.isError || users.isError,
    refetchStats: stats.refetch,
    refetchUsers: users.refetch,
    isReady: !!token,
  };
}
