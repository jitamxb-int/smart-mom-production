# Key Components

## `components/chat/ChatInterface.tsx` (the live one)

Uses `hooks/useChatStream.ts`. Renders a `MeetingSelector` (multi-select dropdown with search, "All meetings" default) and, for admins, an `AdminUserSelector` to scope chat to one user's meetings. Enter-to-send, Shift+Enter for a newline. Streams assistant text with a blinking cursor (`animate-pulse` span) while `isStreaming`; shows `sources` (meeting title + chunk index) once the response completes.

**SSE parsing** (also duplicated in `chatSlice.ts` and `ChatInterfaceRedux.tsx`/`useChatRedux.ts` — see [State Management](state-management.md)): POST to `{API_URL}/api/chat` with `Accept: text/event-stream` and a Bearer token, body `{message, conversation_history: <last 10 messages>, meeting_id | meeting_ids}`; read `response.body.getReader()`, decode chunks, split on `\n`, parse `data:` lines as JSON, and switch on `parsed.type` (`token` → append to the last assistant message, `sources` → set the sources array, `error` → set an error string).

## `components/chat/ChatInterfaceRedux.tsx`

Near-identical UI/logic, sourced from Redux (`useChatState`, `useSendMessage`, `useChatMeetings`) instead of local state + the standalone hook. **Not referenced by any page** — only `ChatInterface` is imported by `/dashboard/chat`. Likely an in-progress migration left half-finished.

## `components/diagram/MermaidRenderer.tsx`

Dynamically `import("mermaid")` to avoid SSR bundling issues. Calls `mermaid.initialize({startOnLoad: false, theme: "default", securityLevel: "loose"})`, sets `innerHTML` to the raw `mermaid_syntax` string, removes the `data-processed` attribute (required so Mermaid re-renders when the syntax changes), then calls `mermaid.run({nodes: [ref.current]})`. Handles four diagram states: `not_applicable` (renders nothing), `pending` (spinner), `failed` (amber warning box with an optional "Try again" regenerate button), `ready` (renders the diagram with a `type` badge).

## `components/layout/Sidebar.tsx`

Desktop: fixed `w-60` column (`hidden lg:flex`). Mobile: a slide-in drawer (`translate-x` transition) triggered by a hamburger button; closes on outside-click, `Escape`, or nav click; locks `document.body.style.overflow` while open. Nav items differ by role (see [Pages & Routing](pages-routing.md)). Prefetches all nav routes on mount; renders the session avatar + sign-out button pinned to the bottom.

## `components/layout/DashboardLayoutClient.tsx`

Decides the dashboard shell per role/path: admins always get the sidebar; normal users get no sidebar specifically on `/dashboard/record*`.

## `components/meeting/MOMViewer.tsx` + `MoMSections.tsx`

A structured Minutes-of-Meeting renderer (832 + 555 lines) — the backend's `mom` field is structured/parsed content, not a plain markdown blob. Dedicated sub-sections: `MoMHeader`, `MetadataGrid`, `AgendaSection`, `DiscussionSection`, `DecisionsSection` (parses decision text into title/description), `ActionItemsTable`, `OpenIssuesTable`, `NextStepsSection`, `MoodOfClientSection`, `OutOfScopeSection`, `ClosingSection`. This is materially more sophisticated than the root README's "tabbed AI outputs" description suggests.

## Admin page internals (`app/dashboard/admin/page.tsx`)

A single 2393-line file with tab state (`useState<AdminTab>("stats")`) composing: `ConfirmDialog`, `AdminStatsPanel`, `StorageConfigPanel`, `BotSetupCard` (Meet Bot login/profile setup — undocumented in the root README), `UsersTable`, `RagIndexingPanel`, `TranscriptEditModal`, `MeetingEditModal`, `MeetingRow`, `StuckChunkedSection`, `TranscriptsPanel`, `ErrorLogDetailModal`, `ErrorLogsPanel`.

## `types/index.ts`

Defines `TranscriptSegment`, `TranscriptData`, `DiagramData` (`status: pending|not_applicable|ready|failed`), `Meeting` (including `meet_link`/`bot_session_id` — the Meet Bot fields, absent from the README's data model docs), `ChatMessage`, `ChatSource`, `Session`. Note that `chatSlice.ts` and `adminSlice.ts` each define their own slightly different local versions of `ChatMessage`/`ChatSource`/`AdminUser` rather than importing from here.
