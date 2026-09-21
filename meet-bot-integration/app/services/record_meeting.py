#!/usr/bin/env python3
import asyncio
import os
import shutil
import signal
import subprocess
import sys
import time

from dotenv import load_dotenv
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

from app.config import settings

load_dotenv()

os.environ["DISPLAY"] = settings.display
os.environ["PULSE_SERVER"] = settings.pulse_server

SESSION_ID      = os.getenv("SESSION_ID", "default")
MEETING_LINK    = os.getenv("MEETING_LINK", "").strip()
RECORDINGS_DIR  = os.getenv("RECORDINGS_DIR", settings.recordings_dir)
STAY_DURATION   = int(os.getenv("STAY_DURATION_SECONDS", str(settings.stay_duration_seconds)))

SID8    = SESSION_ID.replace("-", "")[:8]
SPK_SINK = f"VSpk_{SID8}"

os.environ["PULSE_SINK"]     = SPK_SINK
os.environ["PULSE_SPK_SINK"] = SPK_SINK

BASE_PROFILE    = os.getenv("CHROME_BASE_PROFILE", settings.chrome_base_profile)
BACKUP_PROFILE  = os.getenv("CHROME_BACKUP_PROFILE", settings.chrome_backup_profile)
SESSION_PROFILE = f"/tmp/chrome-profile-rec-{SESSION_ID}"
OUTPUT_FILE     = os.path.join(RECORDINGS_DIR, f"{SID8}.webm")

CHROME_LOCK_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket"]


def _pactl(*args) -> bool:
    try:
        result = subprocess.run(
            ["pactl"] + list(args), capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except Exception as e:
        print(f"[REC][{SID8}] pactl error: {e}", flush=True)
        return False


def log(msg: str):
    print(f"[REC][{SID8}] {msg}", flush=True)


def prepare_profile() -> str:
    log("Preparing Chrome profile...")
    source = None
    if os.path.exists(BASE_PROFILE) and os.path.isdir(BASE_PROFILE):
        source = BASE_PROFILE
    elif os.path.exists(BACKUP_PROFILE) and os.path.isdir(BACKUP_PROFILE):
        log("⚠️  Base missing — using backup.")
        source = BACKUP_PROFILE
    else:
        log("⚠️  No base profile found — using fresh profile (may require login).")
        return SESSION_PROFILE

    if os.path.exists(SESSION_PROFILE):
        shutil.rmtree(SESSION_PROFILE, ignore_errors=True)

    try:
        shutil.copytree(source, SESSION_PROFILE)
        log("✅ Profile copied.")
    except Exception as e:
        log(f"⚠️  Copy failed: {e}")
        return SESSION_PROFILE

    for lock_file in CHROME_LOCK_FILES:
        lock_path = os.path.join(SESSION_PROFILE, lock_file)
        if os.path.exists(lock_path) or os.path.islink(lock_path):
            try:
                os.remove(lock_path)
            except Exception:
                pass

    log("✅ Profile ready.")
    return SESSION_PROFILE


def _run(cmd: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.returncode, result.stdout.strip()
    except Exception as e:
        log(f"Command failed {cmd}: {e}")
        return 1, ""


def create_recording_sinks() -> bool:
    log("Creating PulseAudio sinks...")
    destroy_recording_sinks()

    rc, _ = _run([
        "pactl",
        "load-module",
        "module-null-sink",
        f"sink_name={SPK_SINK}",
        f"sink_properties=device.description={SPK_SINK}"
    ])

    if rc != 0:
        log("❌ Could not create speaker sink")
        return False

    log(f"✅ Sink created: {SPK_SINK}")

    rc, _ = _run([
        "pactl",
        "set-default-sink",
        SPK_SINK
    ])

    if rc == 0:
        log(f"✅ Default sink set → {SPK_SINK}")
    else:
        log("⚠️ Failed to set default sink")

    return True


def route_browser_audio() -> bool:
    log("Searching for Chromium audio stream...")

    for attempt in range(20):
        try:
            result = subprocess.run(
                ["pactl", "list", "sink-inputs"],
                capture_output=True,
                text=True,
                timeout=5
            )

            output = result.stdout

            if not output.strip():
                log(f"No sink-inputs yet (attempt {attempt+1}/20)")
                time.sleep(1)
                continue

            blocks = output.split("Sink Input #")

            for block in blocks:
                text = block.lower()

                is_chromium = any(
                    x in text
                    for x in [
                        "chromium",
                        "chrome",
                        "google chrome",
                        "playwright"
                    ]
                )

                if not is_chromium:
                    continue

                lines = block.strip().splitlines()

                if not lines:
                    continue

                sink_input_id = lines[0].strip().split()[0]

                log(f"Found Chromium stream {sink_input_id}")

                move = subprocess.run(
                    [
                        "pactl",
                        "move-sink-input",
                        sink_input_id,
                        SPK_SINK
                    ],
                    capture_output=True,
                    text=True,
                    timeout=5
                )

                if move.returncode == 0:
                    log(f"✅ Routed Chromium {sink_input_id} → {SPK_SINK}")

                    verify = subprocess.run(
                        ["pactl", "list", "sink-inputs", "short"],
                        capture_output=True,
                        text=True
                    )

                    log("Sink Inputs:")
                    log(verify.stdout)

                    return True
                else:
                    log(f"⚠️ Failed to move Chromium stream {sink_input_id}")

        except Exception as e:
            log(f"Routing error: {e}")

        time.sleep(1)

    log("⚠️ Could not find Chromium audio stream")
    return False


def destroy_recording_sinks():
    log("Cleaning PulseAudio sinks...")

    try:
        result = subprocess.run(
            ["pactl", "list", "modules", "short"],
            capture_output=True,
            text=True,
            timeout=5
        )

        for line in result.stdout.splitlines():
            if SPK_SINK in line:
                module_id = line.split()[0]
                subprocess.run([
                    "pactl",
                    "unload-module",
                    module_id
                ])
                log(f"Unloaded module {module_id}")

    except Exception as e:
        log(f"Cleanup warning: {e}")


_ffmpeg_proc: subprocess.Popen | None = None


def start_ffmpeg() -> bool:
    global _ffmpeg_proc
    os.makedirs(RECORDINGS_DIR, exist_ok=True)

    log(f"🎙️ Recording from {SPK_SINK}.monitor")

    try:
        _ffmpeg_proc = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-f", "pulse",
                "-thread_queue_size", "4096",
                "-i", f"{SPK_SINK}.monitor",
                "-vn",
                "-c:a", "libopus",
                "-ar", "48000",
                "-ac", "2",
                "-b:a", "96k",
                OUTPUT_FILE,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        log(f"✅ FFmpeg started (PID {_ffmpeg_proc.pid})")
        return True

    except Exception as e:
        log(f"❌ FFmpeg failed: {e}")
        return False


def stop_ffmpeg():
    global _ffmpeg_proc
    if _ffmpeg_proc is not None and _ffmpeg_proc.poll() is None:
        log("Stopping FFmpeg...")
        try:
            _ffmpeg_proc.send_signal(signal.SIGTERM)
            _ffmpeg_proc.wait(timeout=10)
            log("✅ FFmpeg finalized.")
        except subprocess.TimeoutExpired:
            _ffmpeg_proc.kill()
            _ffmpeg_proc.wait()
            log("⚠️  FFmpeg killed (timeout).")
        except Exception as e:
            log(f"⚠️  FFmpeg stop error: {e}")
        stderr_out = _ffmpeg_proc.stderr.read().decode(errors="replace") if _ffmpeg_proc.stderr else ""
        _ffmpeg_proc = None
        if stderr_out.strip():
            for line in stderr_out.strip().splitlines():
                log(f"  [ffmpeg] {line}")
        if os.path.exists(OUTPUT_FILE):
            size = os.path.getsize(OUTPUT_FILE)
            log(f"📁 Output: {OUTPUT_FILE} ({size / 1024:.1f} KB)")


async def _click_use_microphone(page) -> bool:
    try:
        result = await page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const btn of buttons) {
                    const txt = (btn.textContent || '').trim().toLowerCase();
                    if (txt.includes('microphone') &&
                        !txt.includes('camera') &&
                        !txt.includes('without')) {
                        btn.click();
                        return btn.textContent.trim();
                    }
                }
                return null;
            }
        """)
        if result:
            log(f"✅ Mic popup clicked: '{result}'")
            return True
    except Exception as e:
        log(f"⚠️  Mic popup error: {e}")
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
            log(f"✅ Join clicked: '{result}'")
            return True
    except Exception as e:
        log(f"⚠️  Join error: {e}")
    return False


async def _click_switch_here(page) -> bool:
    try:
        result = await page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const btn of buttons) {
                    const txt = (btn.textContent || '').trim().toLowerCase();
                    if (txt.includes('switch here') || txt.includes('switch the call here')) {
                        btn.click();
                        return btn.textContent.trim();
                    }
                }
                return null;
            }
        """)
        if result:
            log(f"🔁 Switch clicked: '{result}'")
            return True
    except Exception as e:
        log(f"⚠️  Switch error: {e}")
    return False


async def _dismiss_popups(page):
    try:
        await page.evaluate("""
            () => {
                for (const sel of [
                    '[aria-label="Close dialog"]',
                    '[aria-label="Close"]',
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
            log("✅ Login complete.")
            return
        await asyncio.sleep(5)
        elapsed += 5
        print(f"[REC][{SID8}]   Login wait: {max(timeout_seconds - elapsed, 0)}s remaining...", flush=True)
    log("⚠️  Login timeout — continuing anyway.")


_STOP_FILE_PREFIX = "/tmp/recording-stop-"


def _stop_file_path(sid8: str = "") -> str:
    sid = sid8 or SID8
    return f"{_STOP_FILE_PREFIX}{sid}"


def signal_stop(sid8: str = ""):
    path = _stop_file_path(sid8)
    with open(path, "w") as f:
        f.write("stop")
    print(f"[REC][{sid8 or SID8}] 🛑 Stop signal sent via {path}", flush=True)


def check_stop_signal() -> bool:
    return os.path.exists(_stop_file_path())


def clear_stop_signal():
    path = _stop_file_path()
    if os.path.exists(path):
        os.remove(path)


async def main():
    if not MEETING_LINK:
        print(f"[REC][{SID8}] ❌ MEETING_LINK not set", file=sys.stderr)
        sys.exit(1)

    print("=" * 60, flush=True)
    print(f"   🎙️  Smart Mom Meet Recorder [{SID8}]", flush=True)
    print("=" * 60, flush=True)
    log(f"Meeting : {MEETING_LINK}")
    log(f"Profile : {SESSION_PROFILE}")
    log(f"Output  : {OUTPUT_FILE}")
    log(f"Sinks   : {SPK_SINK}.monitor → FFmpeg")
    log(f"Duration: {'Unlimited' if STAY_DURATION == 0 else f'{STAY_DURATION}s'}")
    print("", flush=True)

    prepare_profile()

    if not create_recording_sinks():
        log("❌ Failed to create recording sink")
        sys.exit(1)

    async with async_playwright() as p:
        context = None
        page = None
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
            log("✅ Microphone pre-granted")

            page = await context.new_page()

            log("Opening Meet...")
            try:
                await page.goto(MEETING_LINK, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(4000)
                log(f"Meet loaded: {page.url}")
            except PlaywrightTimeout:
                log("⚠️  Meet load timeout — continuing")
            except Exception as e:
                log(f"❌ Failed to open Meet: {e}")
                sys.exit(1)

            if await _google_login_required(page):
                await _wait_for_manual_login(page)
                try:
                    await page.goto(MEETING_LINK, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(4000)
                except Exception as e:
                    log(f"❌ Failed to reopen Meet: {e}")
                    sys.exit(1)

            log("Joining meeting...")
            for attempt in range(4):
                await page.wait_for_timeout(1500)
                if await _click_switch_here(page):
                    await page.wait_for_timeout(3000)
                    break

            for attempt in range(6):
                await page.wait_for_timeout(1500)
                if await _click_use_microphone(page):
                    await page.wait_for_timeout(2000)
                    break

            joined = False
            for attempt in range(10):
                await page.wait_for_timeout(2000)
                if await _click_join_button(page):
                    joined = True
                    await page.wait_for_timeout(3000)
                    break
                print(f"[REC][{SID8}] Join button not found (attempt {attempt+1}/10)", flush=True)

            if not joined:
                log("⚠️  Could not click join — may already be inside")

            for attempt in range(5):
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

            log(f"✅ Bot joined meeting. Ready to record.")

            await page.wait_for_timeout(5000)

            routed = route_browser_audio()

            if not routed:
                log("❌ Could not route Chromium audio")
                sys.exit(1)

            subprocess.run(
                ["pactl", "list", "sink-inputs", "short"]
            )

            subprocess.run(
                ["pactl", "list", "sinks", "short"]
            )

            log("Checking audio activity...")

            probe = subprocess.run(
                [
                    "bash",
                    "-c",
                    f"timeout 3 parec -d {SPK_SINK}.monitor | wc -c"
                ],
                capture_output=True,
                text=True
            )

            log(f"Audio bytes captured: {probe.stdout.strip()}")

            if not start_ffmpeg():
                log("❌ Failed to start FFmpeg — exiting")
                sys.exit(1)

            result = subprocess.run(
                ["pactl", "list", "sink-inputs", "short"],
                capture_output=True,
                text=True
            )

            log("Sink Inputs:")
            log(result.stdout)

            clear_stop_signal()
            log("🎙️  Recording started. Waiting for stop signal...")

            elapsed = 0
            while True:
                try:
                    await asyncio.sleep(2)
                    elapsed += 2

                    if check_stop_signal():
                        log("🛑 Stop signal received.")
                        break

                    if STAY_DURATION > 0 and elapsed >= STAY_DURATION:
                        log(f"⏰ Duration reached ({STAY_DURATION}s).")
                        break

                    if page.is_closed():
                        log("⚠️  Page closed unexpectedly.")
                        break

                except asyncio.CancelledError:
                    log("🛑 Cancelled.")
                    raise

        except asyncio.CancelledError:
            log("🛑 Recording cancelled.")
            raise

        except Exception as e:
            log(f"❌ Error: {e}")
            raise

        finally:
            log("Starting cleanup...")
            stop_ffmpeg()
            destroy_recording_sinks()
            clear_stop_signal()

            if page and not page.is_closed():
                log("👋 Leaving meeting...")
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
                    log("✅ Browser closed.")
                except Exception as e:
                    log(f"⚠️  Could not close browser: {e}")

            if os.path.exists(SESSION_PROFILE):
                try:
                    shutil.rmtree(SESSION_PROFILE, ignore_errors=True)
                    log("✅ Session profile cleaned up.")
                except Exception:
                    pass

    log("🎉 Recording session ended.")
    print(f"[REC][{SID8}] 📁 Recording saved: {OUTPUT_FILE}", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n[REC][{SID8}] 👋 Ctrl+C received.", flush=True)
