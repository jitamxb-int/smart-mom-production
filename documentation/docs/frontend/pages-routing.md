# Pages & Routing

## Route table

| Route | File | Protected? | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | Server-side `auth()` check | No UI; redirects — unauthenticated → `/login` (via middleware); `role==="user"` → `/dashboard/record`; else → `/dashboard` |
| `/login` | `app/login/page.tsx` | Public | Tabbed Login/Signup. Login via `signIn("credentials")` or `signIn("google")`. Signup POSTs directly to the backend's `/auth/register`, then signs in. Client-side password rules mirror the backend's. |
| `/auth/callback` | `app/auth/callback/page.tsx` | Public | Stashes a `?token=` query param into `sessionStorage` (`meetmind_pending_token`), redirects to `/login`. Appears to be a **legacy/unused path** — nothing currently reads that sessionStorage key. |
| `/auth/error` | `app/auth/error/page.tsx` | Public | Maps NextAuth/custom error codes (`GOOGLE_ACCOUNT`, `SERVICE_UNAVAILABLE`, `INVALID_CREDENTIALS`, …) to friendly messages |
| `/api/auth/[...nextauth]` | route.ts | N/A | Re-exports `handlers` from `auth.ts` |
| `/dashboard` | `dashboard/page.tsx` | Yes | Overview: greeting, 4 stat cards (`useStats`), quick-action links, "getting started" CTA when the user has 0 meetings |
| `/dashboard/meetings` | `dashboard/meetings/page.tsx` | Yes | Paginated (20/page) list via `useMeetingsList`, client-side search filter (title/id/attendees), delete mutation, status badges (MoM-ready / chat-ready / diagram-ready) |
| `/dashboard/meetings/[id]` | `dashboard/meetings/[id]/page.tsx` | Yes | Detail view: tabs for Minutes/Summary/Key Points/Transcript; diagram accordion (Mermaid + PNG export via html2canvas); audio download; delete-with-confirm; speaker-name remapping UI with a confirm-before-generating-MoM modal if speakers still look like default `SPEAKER_00` labels; **a Meet Bot recording panel** (paste a Meet link, start/stop, poll status every 5s, noVNC watch link) — not documented in the root README |
| `/dashboard/record` | `dashboard/record/page.tsx` + `RecordClient.tsx` | Yes | Chunk-upload recording UI — see below |
| `/dashboard/chat` | `dashboard/chat/page.tsx` | Yes | Renders `<ChatInterface />` (the live, non-Redux implementation) |
| `/dashboard/admin` | `dashboard/admin/page.tsx` | Yes, admin-only (middleware role redirect) | Tab-based single file (2393 lines): Stats, Storage Config, **Meet Bot Setup** (`BotSetupCard`, undocumented in README), Users, RAG Indexing, Transcripts (with edit modals), Stuck-Chunked meetings, Error Logs |

## Middleware protection (`middleware.ts`)

```text
matcher: ["/dashboard/:path*", "/api/((?!auth).)*"]
```

- Unauthenticated requests are handled by NextAuth's own `signIn` redirect (`pages.signIn = "/login"`).
- **Role-based restriction on top of auth**: if `role === "user"` and the path starts with `/dashboard`, only `/dashboard`, `/dashboard/record(/*)`, `/dashboard/meetings(/*)`, and `/dashboard/chat` are allowed. Anything else (notably `/dashboard/admin`) redirects to `/dashboard/record`. Admins are unrestricted by this check — the `admin` role bypasses it entirely.

## Recording flow (`/dashboard/record`)

- Audio captured via the `MediaRecorder` API.
- Flushed to the backend every ~30 seconds via `POST /api/v1/meetings/{id}/chunks`.
- Each chunk upload promise is tracked in a `Set`; merge only fires after **all** uploads settle — this eliminates the race condition where merge could run before a slow chunk finishes uploading.
- Offline chunks are cached to **IndexedDB** and retried automatically on reconnect.
- Per-chunk visual status indicators: pending / uploading / done / cached / failed.
- Uses **local component state + refs**, not the `recordingSlice`/`useRecordingRedux.ts` Redux machinery that also exists in the codebase — that parallel implementation is not wired into this page. See [Known Issues](../operations/known-issues.md).

## Layout decisions

`DashboardLayoutClient.tsx` decides the shell per role/path: admins always get the sidebar; normal users get **no sidebar** specifically on `/dashboard/record*` (a full-bleed recording UI), and the sidebar everywhere else. `Sidebar.tsx` renders different nav sets by role — `userNav` (Dashboard/Meetings/Chat, deliberately no Record link since users land directly on the record page) vs `baseNav + adminNav` (adds Record + Admin Panel) for admins — and prefetches all nav routes on mount via `router.prefetch`.
