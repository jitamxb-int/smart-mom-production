"use client";

import { useQuery } from "@tanstack/react-query";
import { diagramsApi } from "@/lib/api";
import { useAppSelector } from "@/store/hooks";
import { DiagramData } from "@/types";

interface DiagramStatus {
  success:     boolean;
  meeting_id:  string;
  diagram:     DiagramData | null;
  rag_indexed: boolean;
}

export function useDiagramStatus(meetingId: string) {
  const token = useAppSelector(s => s.session.accessToken);

  return useQuery<DiagramStatus>({
    queryKey: ["diagram", meetingId],
    queryFn:  async () => {
      const res = await diagramsApi.get(meetingId);
      return res.data;
    },
    // Wait for both a meeting ID and a valid token
    enabled: !!meetingId && !!token,
    refetchInterval: (query) => {
      const status = query.state.data?.diagram?.status;
      if (status === "pending") return 3000;
      return false;
    },
  });
}
