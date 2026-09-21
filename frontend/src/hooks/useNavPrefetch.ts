"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { uiActions } from "@/store/slices/uiSlice";

/**
 * useNavPrefetch — wraps router.push with a navigation progress indicator.
 * Use this instead of router.push for programmatic navigation.
 */
export function useNavPrefetch() {
  const router   = useRouter();
  const dispatch = useAppDispatch();

  const navigate = useCallback((href: string) => {
    dispatch(uiActions.setNavigating(true));
    dispatch(uiActions.markRouteVisited(href));
    router.push(href);
  }, [router, dispatch]);

  return { navigate };
}
