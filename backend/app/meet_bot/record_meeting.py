#!/usr/bin/env python3
"""Meet Bot Recording Service — runs as a subprocess inside the backend."""

import asyncio
import os
import shutil
import signal
import subprocess
import sys
import time
import threading
from datetime import datetime, timezone

from dotenv import load_dotenv
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

load_dotenv()

# ── Config from env ───────────────────────────────────────────────────────
DISPLAY = os.getenv("DISPLAY", ":99")
PULSE_SERVER = os.getenv("PULSE_SERVER", "unix:/var/run/pulse/native")
SESSION_ID = os.getenv("SESSION_ID", "default")
MEETING_LINK = os.getenv("MEETING_LINK", "").strip()
MEETING_ID = os.getenv("MEETING_ID", "")
RECORDINGS_DIR = os.getenv("RECORDINGS_DIR", "/recordings")
STAY_DURATION = int(os.getenv("STAY_DURATION_SECONDS", "0"))
CHUNK_INTERVAL = int(os.getenv("CHUNK_INTERVAL_SECONDS", "30"))

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "meetmind")
AWS_REGION = os.getenv("AWS_REGION", "")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "")
STORAGE_BACKEND = os.getenv("AUDIO_STORAGE_BACKEND", "local")
AUDIO_LOCAL_PATH = os.getenv("AUDIO_LOCAL_PATH", "./audio_files")

BASE_PROFILE = os.getenv("CHROME_BASE_PROFILE", "/tmp/chrome-profile")
BACKUP_PROFILE = os.getenv("CHROME_BACKUP_PROFILE", "/tmp/chrome-profile-backup")

SID8 = SESSION_ID.replace("-", "")[:8]
SPK_SINK = f"VSpk_{SID8}"
SESSION_PROFILE = f"/tmp/chrome-profile-rec-{SESSION_ID}"
OUTPUT_FILE = os.path.join(RECORDINGS_DIR, f"{SID8}.webm")
CHROME_LOCK_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket"]

_STOP_FILE_PREFIX = "/tmp/recording-stop-"
_chunk_id_counter = 0
_chunk_id_lock = threading.Lock()


def log(msg: str):
    print(f"[REC][{SID8}] {msg}", flush=True)


# ── Helpers ────────────────────────────────────────────────────────────────

def _pactl(*args) -> bool:
    try:
        result = subprocess.run(["pactl"] + list(args), capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except Exception as e:
        log(f"pactl error: {e}")
        return False


def _run(cmd: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.returncode, result.stdout.strip()
    except Exception as e:
        log(f"Command failed {cmd}: {e}")
        return 1, ""


# ── Storage helpers (direct, no HTTP) ─────────────────────────────────────

def _get_storage():
    """Lazy-init and return storage module-level helpers."""
    if STORAGE_BACKEND == "s3" and S3_BUCKET:
        import boto3
        s3 = boto3.client("s3", region_name=AWS_REGION) if AWS_REGION else boto3.client("s3")

        def upload(self, key, data):
            s3.put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType="audio/webm")
            return key

        def download(self, key):
            resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
            return resp["Body"].read()

        def delete_obj(self, key):
            try:
                s3.delete_object(Bucket=S3_BUCKET, Key=key)
            except Exception:
                pass

        return type("S3Storage", (), {
            "upload": upload, "download": download, "delete": delete_obj,
            "backend": "s3",
        })()
    else:
        base = os.path.abspath(AUDIO_LOCAL_PATH)

        def _resolve(key):
            path = os.path.join(base, key.lstrip("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            return path

        def upload(self, key, data):
            path = _resolve(key)
            with open(path, "wb") as f:
                f.write(data)
            return key

        def download(self, key):
            with open(_resolve(key), "rb") as f:
                return f.read()

        def delete_obj(self, key):
            try:
                os.remove(_resolve(key))
            except Exception:
                pass

        return type("LocalStorage", (), {
            "upload": upload, "download": download, "delete": delete_obj,
            "backend": "local",
        })()


def _get_db():
    from pymongo import MongoClient
    client = MongoClient(MONGO_URI)
    return client[MONGO_DB_NAME]


# ── Chunk upload logic (runs in background thread) ────────────────────────

def upload_chunk(storage, db, meeting_id, user_id, chunk_data, chunk_id):
    """Upload a single chunk to storage and record metadata in MongoDB."""
    s3_key = f"audio/{user_id}/{meeting_id}/chunks/chunk_{chunk_id:05d}.webm"
    try:
        storage.upload(s3_key, chunk_data)
    except Exception as e:
        log(f"Chunk {chunk_id} upload failed: {e}")
        return False

    now = datetime.now(timezone.utc)
    try:
        db.audio_chunks.update_one(
            {"meeting_id": meeting_id, "chunk_id": chunk_id},
            {"$set": {
                "meeting_id": meeting_id,
                "user_id": user_id,
                "chunk_id": chunk_id,
                "s3_key": s3_key,
                "size_bytes": len(chunk_data),
                "timestamp": now,
                "uploaded_at": now,
                "storage_backend": storage.backend,
            }},
            upsert=True,
        )
        db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {"status": "recording", "audio_state": "chunked", "updated_at": now},
             "$max": {"last_chunk_id": chunk_id}},
        )
    except Exception as e:
        log(f"Chunk {chunk_id} metadata save failed: {e}")
        return False

    log(f"Chunk {chunk_id} uploaded ({len(chunk_data)} bytes)")
    return True


def merge_chunks(storage, db, meeting_id, user_id):
    """Merge all chunks for a meeting into a single audio file."""
    chunks = list(db.audio_chunks.find({"meeting_id": meeting_id}).sort("chunk_id", 1))
    if not chunks:
        log("No chunks to merge")
        return False

    merged = bytearray()
    for chunk in chunks:
        try:
            data = storage.download(chunk["s3_key"])
            merged.extend(data)
        except Exception as e:
            log(f"Failed to read chunk {chunk['chunk_id']}: {e}")
            return False

    merged_key = f"audio/{user_id}/{meeting_id}/{meeting_id}.webm"
    try:
        storage.upload(merged_key, bytes(merged))
    except Exception as e:
        log(f"Merge upload failed: {e}")
        return False

    now = datetime.now(timezone.utc)
    db.meetings.update_one(
        {"meeting_id": meeting_id},
        {"$set": {
            "audio_s3_key": merged_key,
            "storage_backend": storage.backend,
            "status": "audio_uploaded",
            "audio_state": "merged",
            "updated_at": now,
        }},
    )

    # Clean up chunk files
    for chunk in chunks:
        storage.delete(chunk["s3_key"])
    db.audio_chunks.delete_many({"meeting_id": meeting_id})

    log(f"Merged {len(chunks)} chunks ({len(merged)} bytes)")
    return True


# ── PulseAudio setup ──────────────────────────────────────────────────────

def _ensure_pulseaudio() -> bool:
    """Check if PulseAudio is running; if not, try to restart it."""
    rc, _ = _run(["pactl", "info"])
    if rc == 0:
        return True
    log("PulseAudio not running — attempting restart...")
    _run(["pulseaudio", "--kill"])
    import time
    time.sleep(1)
    for f in ["/run/pulse/pid", "/var/run/pulse/pid"]:
        if os.path.exists(f):
            try:
                os.remove(f)
            except Exception:
                pass
    subprocess.Popen(
        ["pulseaudio", "--system", "--daemonize=no", "-n",
         "--load=module-native-protocol-unix socket=/var/run/pulse/native auth-anonymous=1",
         "--load=module-always-sink",
         "--exit-idle-time=-1", "--log-level=error"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for i in range(10):
        time.sleep(1)
        rc, _ = _run(["pactl", "info"])
        if rc == 0:
            log(f"PulseAudio restarted after {i+1}s")
            return True
    log("Failed to restart PulseAudio")
    return False


def create_recording_sinks() -> bool:
    log("Creating PulseAudio sinks...")
    if not _ensure_pulseaudio():
        return False
    destroy_recording_sinks()

    rc, _ = _run([
        "pactl", "load-module", "module-null-sink",
        f"sink_name={SPK_SINK}",
        f"sink_properties=device.description={SPK_SINK}",
    ])
    if rc != 0:
        log("Could not create speaker sink")
        return False
    log(f"Sink created: {SPK_SINK}")

    _run(["pactl", "set-default-sink", SPK_SINK])
    return True


def destroy_recording_sinks():
    try:
        result = subprocess.run(
            ["pactl", "list", "modules", "short"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            if SPK_SINK in line:
                module_id = line.split()[0]
                subprocess.run(["pactl", "unload-module", module_id])
    except Exception as e:
        log(f"Cleanup warning: {e}")


def route_browser_audio() -> bool:
    log("Searching for Chromium audio stream...")
    for attempt in range(20):
        try:
            result = subprocess.run(
                ["pactl", "list", "sink-inputs"],
                capture_output=True, text=True, timeout=5,
            )
            output = result.stdout
            if not output.strip():
                log(f"No sink-inputs yet (attempt {attempt+1}/20)")
                time.sleep(1)
                continue

            for block in output.split("Sink Input #"):
                text = block.lower()
                if not any(x in text for x in ["chromium", "chrome", "google chrome", "playwright"]):
                    continue
                lines = block.strip().splitlines()
                if not lines:
                    continue
                sink_input_id = lines[0].strip().split()[0]
                log(f"Found Chromium stream {sink_input_id}")

                move = subprocess.run(
                    ["pactl", "move-sink-input", sink_input_id, SPK_SINK],
                    capture_output=True, text=True, timeout=5,
                )
                if move.returncode == 0:
                    log(f"Routed Chromium {sink_input_id} -> {SPK_SINK}")
                    return True
        except Exception as e:
            log(f"Routing error: {e}")
        time.sleep(1)
    log("Could not find Chromium audio stream")
    return False


# ── FFmpeg ────────────────────────────────────────────────────────────────

_ffmpeg_proc: subprocess.Popen | None = None


def start_ffmpeg() -> bool:
    global _ffmpeg_proc
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    log(f"Recording from {SPK_SINK}.monitor")
    try:
        _ffmpeg_proc = subprocess.Popen(
            [
                "ffmpeg", "-y",
                "-f", "pulse", "-thread_queue_size", "4096",
                "-i", f"{SPK_SINK}.monitor",
                "-vn",
                "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "96k",
                OUTPUT_FILE,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        log(f"FFmpeg started (PID {_ffmpeg_proc.pid})")
        return True
    except Exception as e:
        log(f"FFmpeg failed: {e}")
        return False


def stop_ffmpeg():
    global _ffmpeg_proc
    if _ffmpeg_proc is not None and _ffmpeg_proc.poll() is None:
        log("Stopping FFmpeg...")
        try:
            _ffmpeg_proc.send_signal(signal.SIGTERM)
            _ffmpeg_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _ffmpeg_proc.kill()
            _ffmpeg_proc.wait()
        except Exception as e:
            log(f"FFmpeg stop error: {e}")
        _ffmpeg_proc = None


# ── File chunk reader (background thread) ─────────────────────────────────

def chunk_uploader_thread(meeting_id, user_id):
    """Background thread that reads the output file and uploads chunks."""
    log("Chunk uploader thread started")
    storage = _get_storage()
    db = _get_db()
    last_pos = 0
    global _chunk_id_counter

    interval = min(5, CHUNK_INTERVAL)
    while True:
        time.sleep(interval)
        interval = CHUNK_INTERVAL
        if not os.path.exists(OUTPUT_FILE):
            continue
        try:
            with open(OUTPUT_FILE, "rb") as f:
                f.seek(last_pos)
                new_data = f.read()
                if new_data:
                    with _chunk_id_lock:
                        cid = _chunk_id_counter
                        _chunk_id_counter += 1
                    upload_chunk(storage, db, meeting_id, user_id, new_data, cid)
                    last_pos = f.tell()
        except Exception as e:
            log(f"Chunk upload error: {e}")
        if check_stop_signal():
            break

    # Upload remaining data after stop signal
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "rb") as f:
                f.seek(last_pos)
                remaining = f.read()
                if remaining:
                    with _chunk_id_lock:
                        cid = _chunk_id_counter
                        _chunk_id_counter += 1
                    upload_chunk(storage, db, meeting_id, user_id, remaining, cid)
        except Exception as e:
            log(f"Final chunk upload error: {e}")

    log("Chunk uploader finished")


# ── Stop signal ───────────────────────────────────────────────────────────

def _stop_file_path(sid8: str = "") -> str:
    sid = sid8 or SID8
    return f"{_STOP_FILE_PREFIX}{sid}"


def signal_stop(sid8: str = ""):
    path = _stop_file_path(sid8)
    with open(path, "w") as f:
        f.write("stop")
    log(f"Stop signal sent via {path}")


def check_stop_signal() -> bool:
    return os.path.exists(_stop_file_path())


def clear_stop_signal():
    path = _stop_file_path()
    if os.path.exists(path):
        os.remove(path)


# ── Chrome profile ────────────────────────────────────────────────────────

def prepare_profile() -> str:
    log("Preparing Chrome profile...")
    source = None
    if os.path.exists(BASE_PROFILE) and os.path.isdir(BASE_PROFILE):
        source = BASE_PROFILE
    elif os.path.exists(BACKUP_PROFILE) and os.path.isdir(BACKUP_PROFILE):
        log("Base missing — using backup.")
        source = BACKUP_PROFILE
    else:
        log("No base profile found — using fresh profile.")
        return SESSION_PROFILE

    if os.path.exists(SESSION_PROFILE):
        shutil.rmtree(SESSION_PROFILE, ignore_errors=True)
    try:
        shutil.copytree(source, SESSION_PROFILE)
        log("Profile copied.")
    except Exception as e:
        log(f"Copy failed: {e}")
        return SESSION_PROFILE

    for lock_file in CHROME_LOCK_FILES:
        lock_path = os.path.join(SESSION_PROFILE, lock_file)
        if os.path.exists(lock_path) or os.path.islink(lock_path):
            try:
                os.remove(lock_path)
            except Exception:
                pass
    log("Profile ready.")
    return SESSION_PROFILE


# ── Meeting interaction helpers ───────────────────────────────────────────

async def _click_use_microphone(page) -> bool:
    try:
        result = await page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const btn of buttons) {
                    const txt = (btn.textContent || '').trim().toLowerCase();
                    if (txt.includes('microphone') && !txt.includes('camera') && !txt.includes('without')) {
                        btn.click(); return btn.textContent.trim();
                    }
                }
                return null;
            }
        """)
        if result:
            log(f"Mic popup clicked: '{result}'")
            return True
    except Exception as e:
        log(f"Mic popup error: {e}")
    return False


async def _click_join_button(page) -> bool:
    try:
        result = await page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const btn of buttons) {
                    const txt = (btn.textContent || '').trim().toLowerCase();
                    if (txt.includes('without')) continue;
                    if (txt.includes('leave call') || txt.includes('call_end')) continue;
                    if (txt === 'ask to join') { btn.click(); return 'Ask to join'; }
                    if (txt === 'join now')    { btn.click(); return 'Join now'; }
                }
                return null;
            }
        """)
        if result:
            log(f"Join clicked: '{result}'")
            return True
    except Exception as e:
        log(f"Join error: {e}")
    return False


async def _click_switch_here(page) -> bool:
    try:
        result = await page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const btn of buttons) {
                    const txt = (btn.textContent || '').trim().toLowerCase();
                    if (txt.includes('switch here') || txt.includes('switch the call here')) {
                        btn.click(); return btn.textContent.trim();
                    }
                }
                return null;
            }
        """)
        if result:
            log(f"Switch clicked: '{result}'")
            return True
    except Exception as e:
        log(f"Switch error: {e}")
    return False


async def _dismiss_popups(page):
    try:
        await page.evaluate("""
            () => {
                for (const sel of [
                    '[aria-label="Close dialog"]', '[aria-label="Close"]',
                    'button[aria-label="Dismiss"]'
                ]) {
                    const btn = document.querySelector(sel);
                    if (btn) btn.click();
                }
            }
        """)
    except Exception:
        pass


async def _get_mic_state(page) -> str:
    try:
        return await page.evaluate("""
            () => {
                if (document.querySelector('[aria-label*="Turn off microphone"]')) return 'MIC_ON';
                if (document.querySelector('[aria-label*="Turn on microphone"]'))  return 'MIC_OFF';
                if (document.querySelector('[aria-label*="Microphone problem"]'))  return 'MIC_PROBLEM';
                return 'UNKNOWN';
            }
        """)
    except Exception:
        return "UNKNOWN"


async def _google_login_required(page) -> bool:
    try:
        url = (page.url or "").lower()
        if "accounts.google.com" in url or "servicelogin" in url or "challenge" in url:
            return True
        if await page.locator('input[type="email"]').count() > 0:
            return True
        if await page.locator('input[type="password"]').count() > 0:
            return True
        body_text = ""
        try:
            body_text = (await page.locator("body").inner_text(timeout=3000)).lower()
        except Exception:
            pass
        hints = ["sign in", "verify", "challenge", "2-step", "two-step", "use your phone", "tap yes"]
        return any(h in body_text for h in hints)
    except Exception:
        return False


async def _wait_for_manual_login(page, timeout_seconds: int = 300):
    if timeout_seconds <= 0:
        return
    log("Google sign-in detected — waiting for manual login via noVNC")
    elapsed = 0
    while elapsed < timeout_seconds:
        if not await _google_login_required(page):
            log("Login complete.")
            return
        await asyncio.sleep(5)
        elapsed += 5
        log(f"  Login wait: {max(timeout_seconds - elapsed, 0)}s remaining...")
    log("Login timeout — continuing anyway.")


# ── Main ──────────────────────────────────────────────────────────────────

async def main():
    if not MEETING_LINK:
        log("MEETING_LINK not set")
        sys.exit(1)

    log("=" * 60)
    log(f"  Smart Mom Meet Recorder [{SID8}]")
    log("=" * 60)
    log(f"Meeting : {MEETING_LINK} ({MEETING_ID})")
    log(f"Profile : {SESSION_PROFILE}")
    log(f"Output  : {OUTPUT_FILE}")
    log(f"Sinks   : {SPK_SINK}.monitor -> FFmpeg")
    log(f"Chunks  : every {CHUNK_INTERVAL}s")

    prepare_profile()

    if not create_recording_sinks():
        log("Failed to create recording sink")
        sys.exit(1)

    async with async_playwright() as p:
        context = None
        page = None
        uploader = None
        storage = None
        db = None
        user_id = "unknown"
        try:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=SESSION_PROFILE,
                headless=False,
                viewport={"width": 1280, "height": 720},
                args=[
                    "--use-fake-ui-for-media-stream",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--alsa-input-device=pulse",
                    "--alsa-output-device=pulse",
                    "--no-first-run",
                    "--disable-default-apps",
                    "--window-size=1280,720",
                ],
            )

            await context.grant_permissions(
                ["microphone"], origin="https://meet.google.com"
            )
            log("Microphone pre-granted")

            page = await context.new_page()

            log("Opening Meet...")
            try:
                await page.goto(MEETING_LINK, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(4000)
                log(f"Meet loaded: {page.url}")
            except PlaywrightTimeout:
                log("Meet load timeout — continuing")
            except Exception as e:
                log(f"Failed to open Meet: {e}")
                sys.exit(1)

            if await _google_login_required(page):
                await _wait_for_manual_login(page)
                try:
                    await page.goto(MEETING_LINK, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(4000)
                except Exception as e:
                    log(f"Failed to reopen Meet: {e}")
                    sys.exit(1)

            log("Joining meeting...")
            for _ in range(4):
                await page.wait_for_timeout(1500)
                if await _click_switch_here(page):
                    await page.wait_for_timeout(3000)
                    break

            for _ in range(6):
                await page.wait_for_timeout(1500)
                if await _click_use_microphone(page):
                    await page.wait_for_timeout(2000)
                    break

            joined = False
            for _ in range(10):
                await page.wait_for_timeout(2000)
                if await _click_join_button(page):
                    joined = True
                    await page.wait_for_timeout(3000)
                    break
                log(f"Join button not found (attempt)")
            if not joined:
                log("Could not click join — may already be inside")

            for _ in range(5):
                await page.wait_for_timeout(1500)
                if await _click_use_microphone(page):
                    await page.wait_for_timeout(2000)
                    break

            await page.wait_for_timeout(1000)
            await _dismiss_popups(page)

            state = await _get_mic_state(page)
            log(f"Mic state: {state}")
            if state == "MIC_OFF":
                try:
                    await page.keyboard.press("Control+d")
                    await page.wait_for_timeout(1000)
                    log("Toggled mic ON with Ctrl+D")
                except Exception as e:
                    log(f"Ctrl+D failed: {e}")

            log("Bot joined meeting. Ready to record.")
            await page.wait_for_timeout(5000)

            if not route_browser_audio():
                log("Could not route Chromium audio")
                sys.exit(1)

            if not start_ffmpeg():
                log("Failed to start FFmpeg")
                sys.exit(1)

            clear_stop_signal()

            # Get user_id for this meeting from database
            db = _get_db()
            meeting_doc = db.meetings.find_one({"meeting_id": MEETING_ID})
            user_id = meeting_doc["user_id"] if meeting_doc else "unknown"

            # Start chunk uploader in background thread
            uploader = threading.Thread(
                target=chunk_uploader_thread,
                args=(MEETING_ID, user_id),
                daemon=True,
            )
            uploader.start()

            log("Recording started. Waiting for stop signal...")

            elapsed = 0
            while True:
                try:
                    await asyncio.sleep(2)
                    elapsed += 2

                    if check_stop_signal():
                        log("Stop signal received.")
                        break

                    if STAY_DURATION > 0 and elapsed >= STAY_DURATION:
                        log(f"Duration reached ({STAY_DURATION}s).")
                        break

                    if page.is_closed():
                        log("Page closed unexpectedly.")
                        break

                except asyncio.CancelledError:
                    log("Cancelled.")
                    raise

        except asyncio.CancelledError:
            log("Recording cancelled.")
            raise
        except Exception as e:
            log(f"Error: {e}")
            raise
        finally:
            log("Starting cleanup...")
            stop_ffmpeg()

            # Wait for chunk uploader to finish
            if uploader is not None and uploader.is_alive():
                uploader.join(timeout=30)

            destroy_recording_sinks()
            clear_stop_signal()

            # Merge chunks (only if db was initialized and uploader started)
            if db is not None:
                log("Merging chunks...")
                storage = _get_storage()
                merge_chunks(storage, db, MEETING_ID, user_id)

            if page and not page.is_closed():
                log("Leaving meeting...")
                try:
                    await page.evaluate("""
                        () => {
                            const btns = Array.from(document.querySelectorAll('button'));
                            for (const btn of btns) {
                                const txt = (btn.textContent || '').trim().toLowerCase();
                                const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                                if (txt.includes('leave') || label.includes('leave')) {
                                    btn.click(); return;
                                }
                            }
                        }
                    """)
                    await page.wait_for_timeout(1500)
                except Exception:
                    pass

            if context:
                try:
                    await context.close()
                    log("Browser closed.")
                except Exception as e:
                    log(f"Could not close browser: {e}")

            if os.path.exists(SESSION_PROFILE):
                try:
                    shutil.rmtree(SESSION_PROFILE, ignore_errors=True)
                    log("Session profile cleaned up.")
                except Exception:
                    pass

    log("Recording session ended.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("Ctrl+C received.")
