# Meet Bot Integration Service (`meet-bot-integration/`)

A **standalone** FastAPI microservice that drives headless Chromium (via Playwright) to join a Google Meet, capture its audio through a virtual PulseAudio sink + ffmpeg, and store the result as a `.webm` file. Ships its own Docker Compose stack with Xvfb (virtual display) and noVNC (browser-based VNC) for interactively debugging the login/join flow.

!!! warning "This appears to be a duplicated implementation, not the live integration point"
    The logic here is **near-identical** to `backend/app/meet_bot/` (`record_meeting.py` / `setup_login.py`), which is invoked directly, in-process, by the main backend's `routes/bot_recording.py` and `routes/bot_setup.py` under `/api/v1/meetings/bot/*` — see [Meet Bot Module](../backend/meet-bot.md). There is no evidence in either codebase of the main backend making HTTP calls to this service (e.g. to `localhost:4001`). Treat this directory as either (a) an earlier or alternate deployable version of the same capability, or (b) a separately-run, out-of-process bot worker not currently wired into the main request flow. **Confirm with the team which of the two Meet Bot implementations is the one actually in production before making changes to either.**

## Stack & startup

Python 3.11-slim, FastAPI, Playwright (Chromium), Xvfb, x11vnc + websockify (noVNC), PulseAudio, ffmpeg (`pyproject.toml` / `Dockerfile`).

`start.sh` startup order: Xvfb (`:99`, 1280×720) → noVNC on 6080 → PulseAudio (`VirtualMic`/`VirtualSpeaker`/`VirtualMicSource` sinks) → a pre-seeded Chrome profile at `/tmp/chrome-profile` with mic permission already granted for `meet.google.com` → `uvicorn` on port 8000.

Docker Compose ports: host `4001→8000` (API), `4002→6080` (noVNC). Volume: `./recordings → /recordings`.

## API (`app/main.py`, `app/routes/recording.py`, `app/routes/setup_login.py`)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ok, profile_exists, recordings_dir}` |
| POST | `/setup/login` | Starts interactive Google login (watch via noVNC) |
| GET | `/setup/login/{task_id}` | Login task status |
| GET | `/setup/status` | Whether a logged-in Chrome profile exists |
| POST | `/join-and-record` | Body `{meetLink}` — spawns a recording subprocess, returns a `session_id` |
| POST | `/stop-recording/{session_id}` | Writes a stop-signal file, triggers graceful shutdown |
| GET | `/recording-status/{session_id}` | Recording status |
| GET | `/download-recording/{session_id}` | Downloads the `.webm` |

## Recording mechanics

- Per-session PulseAudio null-sink named `VSpk_{sid8}`.
- Chromium's audio stream is moved onto that sink via `pactl move-sink-input`.
- ffmpeg captures `VSpk_{sid8}.monitor` → `libopus`/48kHz/stereo/96kbps `.webm`.
- The Chrome profile is copy-on-write per session (`/tmp/chrome-profile-rec-{SESSION_ID}`), with lock files stripped, so concurrent recordings don't collide — identical strategy to the in-backend copy.

## Why manual login (shared rationale with the in-backend copy)

`backend/docs/auth-analysis.md` (documented once, applies to both implementations): Google session cookies and OAuth tokens are different systems with no exchange endpoint between them; Google Identity Services' automated-consent bridge is blocked by anti-automation detection. The only two viable approaches are password-based automated login (fragile) or manual one-time noVNC login (implemented here and in `backend/app/meet_bot/`). A from-scratch native WebRTC client was considered and rejected as weeks of effort.
