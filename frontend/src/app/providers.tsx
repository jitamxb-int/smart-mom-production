"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Provider as ReduxProvider } from "react-redux";
import { Toaster } from "react-hot-toast";
import { useEffect, useState, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { store } from "@/store";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { sessionActions } from "@/store/slices/sessionSlice";
import { uiActions } from "@/store/slices/uiSlice";
import { registerTokenGetter } from "@/lib/api";

// ── Register Redux token getter once at module level ──────────────────────────
registerTokenGetter(() => store.getState().session.accessToken);

// ── SessionSync: reads next-auth session → Redux ──────────────────────────────
function SessionSync() {
  const { data: session, status } = useSession() as any;
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "authenticated" && session) {
      dispatch(sessionActions.setSession({
        accessToken:   session.accessToken   ?? "",
        role:          session.role          ?? "user",
        user_id:       session.user_id       ?? "",
        auth_provider: session.auth_provider ?? "email",
        user: {
          name:  session.user?.name  ?? "",
          email: session.user?.email ?? "",
          image: session.user?.image ?? "",
        },
      }));
    } else if (status === "unauthenticated") {
      dispatch(sessionActions.clearSession());
    }
  }, [session, status, dispatch]);

  return null;
}

// ── Navigation progress bar ───────────────────────────────────────────────────
function NavigationProgress() {
  const pathname      = usePathname();
  const searchParams  = useSearchParams();
  const dispatch      = useAppDispatch();
  const navigating    = useAppSelector(s => s.ui.navigating);
  const prevPath      = useRef(pathname);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const currentPath = pathname + searchParams.toString();
    if (prevPath.current !== currentPath) {
      prevPath.current = currentPath;
      dispatch(uiActions.setNavigating(false));
      dispatch(uiActions.markRouteVisited(pathname));
    }
  }, [pathname, searchParams, dispatch]);

  useEffect(() => {
    if (navigating) {
      timerRef.current = setTimeout(() => dispatch(uiActions.setNavigating(false)), 5000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [navigating, dispatch]);

  if (!navigating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5 bg-indigo-100">
      <div
        className="h-full bg-indigo-500 animate-pulse"
        style={{ animation: "navprogress 1.5s ease-in-out infinite" }}
      />
      <style>{`
        @keyframes navprogress {
          0%   { width: 10%; opacity: 1; }
          50%  { width: 75%; opacity: 0.9; }
          100% { width: 90%; opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:            5 * 60 * 1000,
        gcTime:               10 * 60 * 1000,
        retry:                1,
        refetchOnWindowFocus: false,
        refetchOnMount:       false,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ReduxProvider store={store}>
      <SessionProvider>
        <SessionSync />
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: { borderRadius: "12px", fontSize: "13px" },
            }}
          />
          {process.env.NODE_ENV === "development" && <ReactQueryDevtools />}
        </QueryClientProvider>
      </SessionProvider>
    </ReduxProvider>
  );
}
