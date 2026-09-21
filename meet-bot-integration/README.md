# Smart Mom — Google Meet Bot Integration

An automated Google Meet recording bot that uses **Playwright** (Chromium) to join meetings and **FFmpeg** + **PulseAudio** to capture high-quality audio. Runs inside Docker with a virtual display (`Xvfb`) and a `noVNC` web interface for interactive debugging.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Docker Container                               │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │  FastAPI     │    │  noVNC (:6080)│   │  Xvfb Virtual Display│  │
│  │  (:8000)     │────│  (VNC in     │   │  (:99, 1280×720)     │  │
│  │              │    │   browser)   │   │                       │  │
│  └──────┬───────┘    └──────────────┘   └───────────────────────┘  │
│         │                                                           │
│         │  Launches subprocess                                      │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────┐                   │
│  │         app/services/record_meeting.py        │                   │
│  │                                              │                   │
│  │  1. Copy Chrome profile (pre-logged-in)      │                   │
│   │  2. Create PulseAudio recording sinks       │                   │
│  │  3. Launch Chromium via Playwright           │                   │
│  │  4. Navigate → Accept mic → Join meeting     │                   │
│  │  5. Route Chromium audio to recording sink   │                   │
│  │  6. Start FFmpeg (captures sink.monitor)     │                   │
│  │  7. Wait for stop signal / duration           │                   │
│  │  8. Cleanup: FFmpeg, sinks, profile          │                   │
│  └──────────────────────────────────────────────┘                   │
│                           │                                          │
│                           ▼                                          │
│  ┌──────────────────────────────────────────────┐                   │
│  │         PulseAudio Virtual Sinks              │                   │
│  │                                              │                   │
│  │  VSpk_{session} (null-sink)                  │                   │
│  │     └─ monitor → FFmpeg → .webm file         │                   │
│  └──────────────────────────────────────────────┘                   │
│                           │                                          │
│                           ▼                                          │
│  ┌──────────────────────────────────────────────┐                   │
│  │  /recordings/{session_id}.webm                │                   │
│  │  (persistent Docker volume)                   │                   │
│  └──────────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Container Startup Flow (`start.sh`)

On container start, `start.sh` runs these steps in order:

### 1. Xvfb (Virtual Display)
Creates a headless X11 framebuffer at `:99` with resolution `1280×720` so Chromium has a display to render to.

### 2. noVNC
Starts `x11vnc` on the virtual display and `websockify` to expose a VNC-over-WebSocket interface on **port 6080**. Open `http://localhost:4002/vnc.html` to watch the browser live.

### 3. PulseAudio
Launches a system-wide PulseAudio server with:
- A Unix socket at `/var/run/pulse/native`
- `module-always-sink` — ensures a default sink is always available
- Real-time virtual cable creation:
  - `VirtualMic` — a null-sink for microphone simulation
  - `VirtualSpeaker` — the default system output sink (set as default)
  - `VirtualMicSource` — a virtual source tied to the mic monitor

### 4. Chrome Profile with Mic Permissions
Pre-creates a Chrome profile at `/tmp/chrome-profile` with a `Preferences` JSON that grants microphone permission for `https://meet.google.com` (the `media_stream_mic` exception). This ensures the mic is pre-granted without a popup when Playwright opens Meet.

### 5. FastAPI
Starts the API server on **port 8000** via `uvicorn`.

---

## Chrome Profile Setup

Google Meet requires an authenticated Google account. The profile is created in two ways:

### Initial Setup (`POST /setup/login`)

1. Playwright launches Chromium with a **persistent context** using `user_data_dir=/tmp/chrome-profile`
2. Opens `https://accounts.google.com` — the user watches via noVNC and logs in manually
3. The system polls every 5s for login detection (checks for `myaccount.google.com` URL or presence of "sign out" text)
4. Once logged in, it verifies Google Meet access by navigating to `https://meet.google.com`
5. The profile is saved to `/tmp/chrome-profile` and a **backup** is made to `/tmp/chrome-profile-backup`

### Profile Reuse for Recording

When a recording starts, `record_meeting.py`:
1. Checks `/tmp/chrome-profile` (base) → fallback to `/tmp/chrome-profile-backup` (backup)
2. Copies the entire profile directory to a **session-specific temp dir**: `/tmp/chrome-profile-rec-{SESSION_ID}`
3. Removes Chrome lock files (`SingletonLock`, `SingletonCookie`, `SingletonSocket`) from the copy
4. Playwright opens this isolated copy — the original profile stays untouched and reusable

> This copy-on-write approach allows concurrent recordings by isolating each session's profile.

---

## Meeting Recording Flow

### 1. API Trigger

```
POST /join-and-record
Body: { "meetLink": "https://meet.google.com/xxx-xxxx-xxx" }
```

The route handler generates a UUID-based `session_id`, creates an 8-char short ID (`sid8`), sets environment variables, and spawns `app/services/record_meeting.py` as a **subprocess**.

### 2. Profile Preparation

The session profile is cloned from the base/backup profile, lock files are cleaned, and the isolated directory is returned.

### 3. PulseAudio Recording Sinks

Per-session null-sinks are created:

```
VSpk_{sid8} — a module-null-sink that acts as the recording target
```

This sink's `.monitor` source will be captured by FFmpeg.

### 4. Chromium Launch & Meeting Join

Playwright launches a **persistent Chromium context** with:
```
user_data_dir    → /tmp/chrome-profile-rec-{SESSION_ID}
headless         → false (renders on :99 for noVNC)
microphone pre-granted via grant_permissions API
```

The bot then:
1. Navigates to the Meet link
2. Detects if a Google login challenge appears — if so, waits up to 300s for manual login via noVNC (with console countdown)
3. Clicks **"Switch here"** if the "Join from this device" dialog appears
4. Clicks **"Use your microphone"** button (the mic permission dialog)
5. Clicks **"Join now"** or **"Ask to join"**
6. Re-checks mic state; if OFF, toggles with `Ctrl+D`
7. Dismisses any remaining popups

### 5. Audio Routing

After joining, the system polls `pactl list sink-inputs` for a Chromium/Chrome audio stream (up to 20 attempts, 1s apart). When found, it moves the stream to `VSpk_{sid8}` via:

```
pactl move-sink-input {id} VSpk_{sid8}
```

This routes the browser's audio exclusively to the per-session recording sink.

### 6. FFmpeg Recording

FFmpeg starts capturing the sink's monitor:

```
ffmpeg -f pulse -i VSpk_{sid8}.monitor -c:a libopus -ar 48000 -ac 2 -b:a 96k /recordings/{sid8}.webm
```

- Codec: **libopus** (Opus in WebM container)
- Sample rate: 48 kHz
- Channels: Stereo
- Bitrate: 96 kbps

### 7. Recording Loop

The bot stays in the meeting, polling every 2s for either:
- A **stop signal file** at `/tmp/recording-stop-{sid8}` (created by `POST /stop-recording/{session_id}`)
- A configured **stay duration** (`STAY_DURATION_SECONDS`) being exceeded
- The page closing unexpectedly

### 8. Cleanup

When stopped:
1. FFmpeg receives `SIGTERM` → waits up to 10s → `SIGKILL` if unresponsive
2. PulseAudio recording sinks are unloaded
3. Chromium context is closed
4. The session profile (`/tmp/chrome-profile-rec-{SESSION_ID}`) is deleted
5. The stop signal file is removed

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check; returns `ok`, `profile_exists`, `recordings_dir` |
| `POST` | `/setup/login` | Starts interactive Google login (view via noVNC) |
| `GET` | `/setup/login/{task_id}` | Get login task status |
| `GET` | `/setup/status` | Check if profile exists |
| `POST` | `/join-and-record` | Join a Meet and start recording |
| `POST` | `/stop-recording/{session_id}` | Stop a recording |
| `GET` | `/recording-status/{session_id}` | Get recording status |
| `GET` | `/download-recording/{session_id}` | Download the recorded .webm file |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:99` | Xvfb display target |
| `PULSE_SERVER` | `unix:/var/run/pulse/native` | PulseAudio socket |
| `RECORDINGS_DIR` | `/recordings` | Output directory for .webm files |
| `CHROME_BASE_PROFILE` | `/tmp/chrome-profile` | Primary logged-in Chrome profile |
| `CHROME_BACKUP_PROFILE` | `/tmp/chrome-profile-backup` | Backup profile location |
| `LOGIN_TIMEOUT` | `300` | Seconds to wait for manual login (via noVNC) |
| `STAY_DURATION_SECONDS` | `0` | Max recording duration (0 = unlimited) |
| `NOVNC_PORT` | `6080` | Internal noVNC port |
| `HOST` | `0.0.0.0` | API bind address |
| `PORT` | `8000` | API port |

---

## Setup & Deployment

### Prerequisites

- Docker & Docker Compose

### Quick Start

```bash
# 1. Build and start the container
docker compose up -d

# 2. Check the logs
docker compose logs -f

# 3. Open noVNC in your browser
#    http://localhost:4002/vnc.html

# 4. Trigger Google login
curl -X POST http://localhost:4001/setup/login

# 5. Log in to Google via noVNC (the browser window will show accounts.google.com)
#    Check status:
curl http://localhost:4001/setup/status

# 6. Once profile_exists: true, join a meeting
curl -X POST http://localhost:4001/join-and-record \
  -H "Content-Type: application/json" \
  -d '{"meetLink": "https://meet.google.com/xxx-xxxx-xxx"}'

# 7. Stop recording
curl -X POST http://localhost:4001/stop-recording/{session_id}

# 8. Download
curl -O http://localhost:4001/download-recording/{session_id}
```

### Ports

| Port (Host) | Container Port | Service |
|-------------|----------------|---------|
| `4001` | `8000` | FastAPI |
| `4002` | `6080` | noVNC |

### Volumes

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./recordings` | `/recordings` | Output .webm files |

---

## Key Design Decisions

- **Subprocess per recording**: Each `POST /join-and-record` spawns an independent Python subprocess. The API tracks PIDs and stop-signal files, not in-process threads — ensuring isolation and clean cleanup.

- **Copy-on-write profiles**: The base Chrome profile (with Google login) is never modified by recordings. Each session gets its own disposable copy, preventing conflicts.

- **PulseAudio null-sinks per session**: Each recording creates a uniquely named sink (`VSpk_{sid8}`). This isolates audio routing per session and makes cleanup deterministic.

- **Stop signal via file**: Instead of killing the subprocess directly, the API writes a sentinel file (`/tmp/recording-stop-{sid8}`). The recording subprocess polls for this file, allowing a graceful shutdown (FFmpeg finalization → sink cleanup → profile deletion).

- **noVNC for headful debugging**: The Xvfb + noVNC stack lets you watch exactly what the bot sees — invaluable for debugging login flows, Meet UI changes, or permission dialogs.

---

## File Structure

```
meet-bot-integration/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, CORS, route registration
│   ├── config.py             # Settings from environment variables
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── recording.py      # /join-and-record, /stop-recording, status, download
│   │   └── setup_login.py    # /setup/login endpoints
│   └── services/
│       ├── __init__.py
│       ├── setup_login.py    # Playwright-based Google login flow
│       └── record_meeting.py # Meeting join, audio routing, FFmpeg capture
├── recordings/               # Mounted volume — .webm files land here
├── docker-compose.yaml       # Service definition, ports, volumes, env vars
├── Dockerfile                # Python 3.11-slim + Xvfb + PulseAudio + Chromium + Playwright
├── pyproject.toml            # Python dependencies
├── start.sh                  # Entrypoint: Xvfb → noVNC → PulseAudio → Chrome profile → FastAPI
└── README.md
```
