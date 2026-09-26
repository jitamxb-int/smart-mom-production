# Data Flow & Sequence Diagrams

## 1. Authentication

### Email + password

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend (NextAuth)
    participant BE as Backend

    U->>FE: submit email + password
    FE->>BE: POST /auth/login
    BE->>BE: Argon2 verify password_hash
    BE-->>FE: {token, user_id, email, name, role}
    FE->>FE: NextAuth authorize() returns user w/ internal_token
    FE->>FE: jwt callback decodes token payload (role, user_id)
    FE-->>U: session cookie set, accessToken in Redux (sessionSlice)
```

### Google OAuth (via NextAuth)

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend (NextAuth)
    participant Google
    participant BE as Backend

    U->>FE: signIn("google")
    FE->>Google: OAuth consent flow
    Google-->>FE: id_token
    FE->>BE: POST /auth/google/token {id_token}
    BE->>Google: validate via tokeninfo endpoint (checks aud == GOOGLE_CLIENT_ID)
    BE->>BE: upsert user (link by google_id or by email)
    BE-->>FE: {token}
    FE->>FE: stash token in in-memory googleTokenCache keyed by providerAccountId
    FE->>FE: jwt callback reads cache, decodes payload, deletes entry
```

JWT payload: `{user_id, email, role, auth_provider, google_id, iat, exp}`, HS256, default 7-day expiry. Logout blacklists the token in Redis for its remaining TTL (`auth/jwt.py::get_current_user` checks `blacklist:{token}` on every request).

## 2. Recording → transcript → RAG → generation

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Backend
    participant Storage as S3 / local disk
    participant Mongo
    participant Ext as External transcript source
    participant Qdrant
    participant OpenAI

    C->>API: POST /api/v1/meetings/ 
    API->>Mongo: insert meeting doc
    loop chunk upload (every ~30s)
        C->>API: POST /{id}/chunks (chunk_id, timestamp, audio)
        API->>Mongo: upsert audio_chunks, meeting.status=recording, audio_state=chunked
    end
    C->>API: POST /{id}/merge-chunks
    API->>API: naive bytearray concatenation of all chunks (no format detection)
    API->>Storage: write merged audio object
    API->>Mongo: push processing_queue entry
    Ext->>API: PATCH /{id} {transcript, X-Backend1-Signature?}
    API->>API: verify HMAC if BACKEND1_HMAC_SECRET set
    API->>Mongo: store transcript; null out mom/summary/key_points/diagram/rag_indexed
    API->>API: _index_transcript_inline() runs in a thread executor
    API->>Qdrant: delete old points for meeting_id, then upsert new embeddings (batches of 100)
    API->>Mongo: rag_indexed=true, rag_indexed_at
    API->>API: enqueue send_transcription_ready_email (Celery, only on first transcript_ready transition)
    C->>API: POST /{id}/generate/mom (or summary/key_points/diagram)
    API->>OpenAI: inline completion (gpt-4o-family, per-type prompt)
    API->>Mongo: store result
    API-->>C: 200 with generated content
```

!!! warning "Merge is always naive concatenation"
    The root README describes format detection (WebM vs MP4) with an ffmpeg re-mux path for mobile chunks. The actual code in `routes/meetings.py::merge_audio_chunks` does **not** do this — it always does a plain `bytearray` concatenation, for every client. `ffmpeg` in this codebase is used only inside the Meet Bot to *record* from PulseAudio, never to *merge* chunks. See [Known Issues](../operations/known-issues.md).

## 3. Chat (RAG) — SSE streaming

```mermaid
sequenceDiagram
    participant U as User
    participant FE as ChatInterface.tsx
    participant API as POST /api/chat
    participant Qdrant
    participant OpenAI

    U->>FE: type message, press Enter
    FE->>API: fetch POST, Accept: text/event-stream, {message, meeting_id(s), conversation_history[-10]}
    API->>OpenAI: embed the query
    API->>Qdrant: vector search filtered by user_id + meeting_id(s)
    API->>OpenAI: streamed gpt-4o-mini completion with retrieved context
    loop token stream
        OpenAI-->>API: token
        API-->>FE: data: {"type":"token", ...}
        FE->>FE: append to last assistant message (blinking cursor while streaming)
    end
    API-->>FE: data: {"type":"sources", ...}
    API-->>FE: data: {"type":"done"}
    API->>API: persist to chat_sessions (Mongo) after stream completes
```

!!! note "This SSE parser is implemented three times independently"
    `hooks/useChatStream.ts`, `store/slices/chatSlice.ts`'s `sendMessage` thunk, and `ChatInterfaceRedux.tsx` (via `useChatRedux`) each contain their own copy of this fetch-and-parse loop. Only `useChatStream.ts` is on the live path (`ChatInterfaceRedux.tsx` isn't rendered by any page). See [Known Issues](../operations/known-issues.md).

## 4. Error logging pipeline

```mermaid
flowchart TD
    A["Unhandled exception<br/>(any route)"] --> D["main.py global_exception_handler<br/>source=http_exception_handler"]
    B["Swallowed except Exception block<br/>(routes/*.py best-effort cleanup)"] --> E["log_error(e, db, source='manual:&lt;tag&gt;')"]
    Cx["Celery task failure<br/>(worker/tasks/*.py)"] --> F["log_error(exc, sync_db, source='manual:&lt;task&gt;')"]
    D --> G["core/error_logger.py :: log_error()"]
    E --> G
    F --> G
    G --> G1["walk exc.__traceback__ → deepest frame under backend/app/"]
    G1 --> G2["derive module / function / file_path / line_number automatically"]
    G2 --> G3["capture exception_type, message, full traceback,<br/>request method/path, user_id/email, status_code, context"]
    G3 --> H{"async Motor db\nor sync pymongo db?"}
    H -->|async| H1["asyncio.create_task(insert) — fire-and-forget"]
    H -->|sync| H2["direct insert_one()"]
    H1 --> I[("MongoDB db.error_logs<br/>TTL index on timestamp<br/>(module, timestamp desc) index")]
    H2 --> I
    I --> J["GET /api/v1/admin/error-logs* (require_admin)"]
    J --> K["Frontend: /dashboard/admin → Error Logs tab"]
```

`log_error()` never raises and never blocks the caller — see [Error Logging System](../backend/error-logging.md) for the exact function contract.

## 5. Meet Bot recording (in-process module)

```mermaid
sequenceDiagram
    participant Admin as Admin (Frontend)
    participant API as Backend (bot_recording.py)
    participant Bot as record_meeting.py (subprocess)
    participant Meet as Google Meet (Chromium)
    participant Pulse as PulseAudio
    participant Storage
    participant Mongo

    Admin->>API: POST /api/v1/meetings/bot/{meeting_id}/start {meetLink}
    API->>Bot: spawn `python -m app.meet_bot.record_meeting` with env vars (IDs, sink names, Mongo URI, storage config)
    API->>API: track PID in in-process active_sessions dict
    API-->>Admin: session info + noVNC watch URL
    Bot->>Bot: copy Chrome profile (per-session, lock files stripped)
    Bot->>Pulse: create per-session null-sink
    Bot->>Meet: launch persistent-context Chromium, join meeting (manual login via noVNC if needed)
    Bot->>Pulse: move Chromium's sink-input onto the recording sink
    Bot->>Bot: ffmpeg -f pulse -i {sink}.monitor -c:a libopus → local .webm
    loop every CHUNK_INTERVAL (~30s)
        Bot->>Storage: upload new bytes directly (bypasses HTTP API)
        Bot->>Mongo: upsert audio_chunks / meetings directly (raw PyMongo)
    end
    Admin->>API: POST /{meeting_id}/stop
    API->>Bot: write stop-signal file
    Bot->>Bot: stop ffmpeg, merge chunks itself (same naive concat), leave meeting, cleanup
```

See [Meet Bot Module](../backend/meet-bot.md) for why login is manual (not token-based), and [Meet Bot Integration Service](../services/meet-bot-integration.md) for the separate standalone copy of this same logic.
