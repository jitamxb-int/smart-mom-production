# Frontend — Overview & Structure

Next.js 14.2 (App Router), TypeScript, Tailwind CSS v3. Dev server on port `3015`.

## Project structure

```text
frontend/src/
├── auth.ts                 NextAuth config (Google + Credentials providers)
├── middleware.ts           Route protection for /dashboard/** and /api/** (except /api/auth)
├── app/
│   ├── api/auth/[...nextauth]/route.ts   Re-exports NextAuth handlers
│   ├── auth/callback/, auth/error/       OAuth callback + friendly error pages
│   ├── login/page.tsx                    Login/Signup tabbed card
│   ├── dashboard/
│   │   ├── layout.tsx                    Server-side auth() gate + DashboardLayoutClient
│   │   ├── page.tsx                      Dashboard home (stats, quick actions)
│   │   ├── meetings/page.tsx             Meetings list
│   │   ├── meetings/[id]/page.tsx        Meeting detail (tabs, diagram, Meet Bot panel)
│   │   ├── record/page.tsx + RecordClient.tsx   Recording UI
│   │   ├── chat/page.tsx                 Global chat (renders ChatInterface.tsx)
│   │   └── admin/page.tsx                Admin panel (2393 lines, tab-based)
│   ├── globals.css                       Tailwind base + Mermaid overrides
│   ├── layout.tsx                        Root HTML layout
│   └── providers.tsx                     Redux + React Query + NextAuth + Toast providers
├── components/
│   ├── chat/ChatInterface.tsx            SSE chat (the one actually rendered)
│   ├── chat/ChatInterfaceRedux.tsx        Redux-backed duplicate — not rendered by any page
│   ├── diagram/MermaidRenderer.tsx         Dynamic Mermaid.js renderer
│   ├── layout/Sidebar.tsx                  Responsive nav (desktop + mobile drawer)
│   ├── layout/DashboardLayoutClient.tsx    Per-role/path sidebar decision
│   └── meeting/MOMViewer.tsx + MoMSections.tsx   Structured MoM document renderer
├── hooks/                                  7 files — see State Management
├── lib/
│   ├── api.ts                              Axios instance + every API endpoint wrapper
│   └── dateUtils.ts                         All dates formatted in Asia/Kolkata (IST) — hardcoded
├── store/                                   Redux Toolkit — 7 slices, not 3
└── types/index.ts                           Shared TypeScript interfaces
```

!!! note "The root README under-documents the frontend in three ways"
    1. **State management**: only 3 of the 7 actual Redux slices are documented (`session`, `meetings`, `ui` — missing `admin`, `chat`, `recording`, `notifications`).
    2. **Meet Bot UI**: a first-class, pervasive feature (record page, meeting detail page, dedicated admin setup panel, its own `lib/api.ts` namespace) is entirely absent from the README, mirroring the backend's undocumented Meet Bot routes.
    3. **Dead/parallel code**: `ChatInterfaceRedux.tsx` and `useRecordingRedux.ts` implement alternate versions of live features but aren't wired into any page — see [Known Issues](../operations/known-issues.md).

## Notable, undocumented technical decisions

- **All dates are IST, hardcoded.** `lib/dateUtils.ts::formatIST()`/`getCurrentISTISO()` format and generate every timestamp in `Asia/Kolkata`, regardless of browser locale or server timezone. This affects every displayed timestamp and every `date_time` sent to the backend on meeting creation — a deliberate business decision, not a bug, but one that materially affects behavior for any non-IST user or deployment.
- `next.config.js` allows Google avatar image domains, strips `console.log` in production builds, and opts several packages into `optimizePackageImports`.
- Notable dependencies beyond the README's list: `html2canvas` + `html2pdf.js` (diagram export to PNG/PDF), `date-fns`, `clsx`, `tailwind-merge`.

See [Pages & Routing](pages-routing.md), [State Management](state-management.md), [API Client Layer](api-client.md), and [Key Components](components.md) for the full breakdown.
