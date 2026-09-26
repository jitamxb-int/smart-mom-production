# State Management

Two layers, as the root README describes — but the Redux layer is considerably larger than documented there.

## React Query — server state

- Cache keys: `["meetings", page]`, `["meeting", id]`, `["stats"]`, `["diagram", id]`, plus admin-specific keys.
- Stale time: 5 minutes; GC time: 10 minutes.
- Nearly every query is gated on `enabled: !!token`, specifically to avoid firing unauthenticated requests that would otherwise surface as CORS-masked 401 errors rather than clear auth errors.
- Several queries self-poll: `useMeeting(id)` every 4s while `status === "transcript_ready" && !rag_indexed`; `useDiagramStatus` every 3s while `status === "pending"`; various admin hooks poll every 10–30s.

## Redux Toolkit — 7 slices (not 3)

`store/index.ts` combines: `session`, `meetings`, `ui`, `admin`, `chat`, `recording`, `notifications`.

| Slice | State | Notes |
|---|---|---|
| `sessionSlice` | `{accessToken, role, user_id, auth_provider, user}` | Populated by a `SessionSync` component (in `providers.tsx`) reading NextAuth's `useSession()`. This is what `lib/api.ts`'s Axios interceptor reads synchronously — no `/api/auth/session` round trip per request. |
| `meetingsSlice` | `{byId, pages (by page number), meta, stats, listLoading, statsLoading}` | `updateMeeting` patches both `byId` and any cached `pages` entries; `invalidatePages` forces a refetch |
| `uiSlice` | `{navigating, visitedRoutes}` | Drives the nav progress bar and prefetch tracking |
| `adminSlice` | Full CRUD/async-thunk slice for admin users/stats/meetings/chunked-meetings/storage-config | `createAsyncThunk` per operation, each with pending/fulfilled/rejected reducers |
| `chatSlice` | Message list, sources, streaming flag, available meetings, chat history sessions, active meeting id(s), per-meeting indexing status | Contains its own `sendMessage` thunk that **independently re-implements** the SSE-parsing logic also found in `useChatStream.ts` |
| `recordingSlice` | Full recording state machine (`idle`→`requesting`→`recording`→`paused`→`uploading`→`processing`→`completed`→`error`), upload progress/speed, chunk count, audio blob/URL | Paired with `useRecordingRedux.ts`. **Not used by the live `/dashboard/record` page** (`RecordClient.tsx` uses local state instead) — appears to be a parallel/earlier implementation. |
| `notificationsSlice` | Toast/notification queue, global error log, global loading overlay, confirmation-dialog state | Exposed via `useNotify()`; in practice most of the app calls `react-hot-toast` directly instead |

**Store middleware**: default RTK middleware, with `serializableCheck` explicitly ignoring the `recording/setAudioBlob` action and the `recording.audioBlob` state path (Blobs aren't serializable).

`store/hooks.ts` centralizes roughly 25 typed selector hooks on top of `useAppSelector`/`useAppDispatch` (`useSession`, `useIsAdmin`, `useMeeting`, `useChatState`, `useRecording`, `useNotify`, etc.).

## The "instant on back-navigation" pattern

Used throughout (`useMeetingsList`, `useMeeting`, `useStats`, and the admin hooks): React Query fetches fresh data, an effect syncs it into the matching Redux slice, and the hook **returns the Redux-cached value first**, falling back to the React Query result if Redux is empty. This is what makes meeting detail pages feel instant when navigating back to them.

## Duplicated logic to be aware of

- **SSE parsing appears three times**: `hooks/useChatStream.ts` (live), `store/slices/chatSlice.ts`'s `sendMessage` thunk, and `hooks/useChatRedux.ts` (paired with the unused `ChatInterfaceRedux.tsx`). All three independently POST to `/api/chat`, read the stream via `response.body.getReader()`, and switch on `parsed.type` (`token`/`sources`/`error`).
- **`useRecordingRedux.ts` has a Rules-of-Hooks violation** (`useAppSelector` called inside a `useCallback` body) — informational only, since this module appears to be dead code not imported by the live record page.
- `store/slices/chatSlice.ts` and `store/slices/adminSlice.ts` define their **own** local `ChatMessage`/`ChatSource`/`AdminUser` interfaces rather than importing from `types/index.ts` — mild type duplication.

See [Known Issues & Tech Debt](../operations/known-issues.md) for the consolidated list.
