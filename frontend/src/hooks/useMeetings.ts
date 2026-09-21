"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { meetingsApi } from "@/lib/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { meetingsActions } from "@/store/slices/meetingsSlice";
import type { Meeting } from "@/types";

// ── useMeetingsList ────────────────────────────────────────────────────────────
// Gate: only fire once the Redux token exists so the request always carries
// an Authorization header and never triggers a CORS-masked 401.
export function useMeetingsList(page = 1, limit = 20) {
  const dispatch = useAppDispatch();

  const token       = useAppSelector(s => s.session.accessToken);
  const cachedPage  = useAppSelector(s => s.meetings.pages[page]);
  const meta        = useAppSelector(s => s.meetings.meta);
  const listLoading = useAppSelector(s => s.meetings.listLoading);

  const query = useQuery({
    queryKey: ["meetings", page, limit],
    queryFn:  async () => {
      const res = await meetingsApi.list(page, limit);
      return res.data as { data: Meeting[]; meta: { total: number; page: number; limit: number } };
    },
    // Only run when we have a token — avoids unauthenticated preflight 401s
    enabled: !!token,
  });

  useEffect(() => {
    if (query.data) {
      dispatch(meetingsActions.setMeetingsPage({
        page,
        meetings: query.data.data,
        meta:     query.data.meta,
      }));
    }
  }, [query.data, page, dispatch]);

  useEffect(() => {
    dispatch(meetingsActions.setListLoading(query.isLoading || query.isFetching));
  }, [query.isLoading, query.isFetching, dispatch]);

  return {
    meetings:  cachedPage ?? query.data?.data ?? [],
    meta:      meta       ?? query.data?.meta ?? null,
    isLoading: !cachedPage && (query.isLoading || listLoading),
    isError:   query.isError,
    refetch:   query.refetch,
  };
}

// ── useMeeting ─────────────────────────────────────────────────────────────────
export function useMeeting(id: string) {
  const dispatch = useAppDispatch();
  const token    = useAppSelector(s => s.session.accessToken);
  const cached   = useAppSelector(s => s.meetings.byId[id]);

  const query = useQuery({
    queryKey: ["meeting", id],
    queryFn:  async () => {
      const res = await meetingsApi.get(id);
      return res.data as { success: boolean; data: Meeting };
    },
    // Both id AND token must be present before firing
    enabled:  !!id && !!token,
    refetchInterval: (q) => {
      const m = q.state.data?.data;
      if (!m) return false;
      if (m.status === "transcript_ready" && !m.rag_indexed) return 4000;
      return false;
    },
  });

  useEffect(() => {
    if (query.data?.data) {
      dispatch(meetingsActions.setMeeting(query.data.data));
    }
  }, [query.data, dispatch]);

  return {
    meeting:   cached ?? query.data?.data ?? null,
    isLoading: !cached && query.isLoading,
    isError:   query.isError,
    refetch:   query.refetch,
  };
}

// ── useStats ───────────────────────────────────────────────────────────────────
export function useStats() {
  const dispatch     = useAppDispatch();
  const token        = useAppSelector(s => s.session.accessToken);
  const cached       = useAppSelector(s => s.meetings.stats);
  const statsLoading = useAppSelector(s => s.meetings.statsLoading);

  const query = useQuery({
    queryKey: ["stats"],
    queryFn:  async () => {
      const { apiClient } = await import("@/lib/api");
      const res = await apiClient.get("/api/v1/stats");
      return res.data.data as {
        total: number; transcribed: number; indexed: number; with_diagram: number;
      };
    },
    // Only run once the session token is in Redux — prevents unauthenticated
    // requests that get a 401 with no CORS header (appearing as CORS errors)
    enabled: !!token,
  });

  useEffect(() => {
    if (query.data) {
      dispatch(meetingsActions.setStats(query.data));
    }
  }, [query.data, dispatch]);

  useEffect(() => {
    dispatch(meetingsActions.setStatsLoading(query.isLoading));
  }, [query.isLoading, dispatch]);

  return {
    stats:     cached ?? query.data ?? null,
    isLoading: !cached && (query.isLoading || statsLoading),
  };
}
