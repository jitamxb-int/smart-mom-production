import asyncio
import os
import shutil
import sys

from playwright.async_api import async_playwright

DISPLAY = os.getenv("DISPLAY", ":99")
PULSE_SERVER = os.getenv("PULSE_SERVER", "unix:/var/run/pulse/native")
BASE_PROFILE = os.getenv("CHROME_BASE_PROFILE", "/tmp/chrome-profile")
BACKUP_PROFILE = os.getenv("CHROME_BACKUP_PROFILE", "/tmp/chrome-profile-backup")
LOGIN_TIMEOUT = int(os.getenv("LOGIN_TIMEOUT", "300"))
NOVNC_PORT = int(os.getenv("NOVNC_PORT", "6080"))


def log(msg: str):
    print(f"[SETUP] {msg}", flush=True)


async def run_login(base_profile: str | None = None) -> dict:
    if base_profile is None:
        base_profile = BASE_PROFILE

    _set_env()

    log("=" * 60)
    log("  \U0001f510 Smart Mom \u2014 Google Login Setup")
    log("=" * 60)
    log(f"Base profile path : {base_profile}")
    log(f"Login timeout     : {LOGIN_TIMEOUT}s")

    existing = os.path.exists(base_profile)
    if existing:
        log(f"\u26a0\ufe0f  Existing profile found at {base_profile}")

    async with async_playwright() as p:
        log("\n\U0001f310 Opening Chrome in noVNC display...")
        log(f"\U0001f449 Open http://localhost:{NOVNC_PORT}/vnc.html to see the browser.\n")

        context = await p.chromium.launch_persistent_context(
            user_data_dir=base_profile,
            headless=False,
            viewport={"width": 1280, "height": 720},
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--disable-default-apps",
                "--window-size=1280,720",
            ],
        )

        page = await context.new_page()

        log("\U0001f517 Navigating to Google sign-in...")
        await page.goto("https://accounts.google.com", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        already_logged_in = await _check_logged_in(page)
        if already_logged_in:
            email = await _get_logged_in_email(page)
            log(f"\n\u2705 Already logged in as: {email}")
            log("\u2705 Base profile is ready.\n")
            await _verify_meet_access(page)
            await context.close()
            _save_backup(base_profile)
            log("\n\U0001f389 Setup complete!")
            return {"status": "already_logged_in", "email": email}

        log("\u26a0\ufe0f  Not logged in. Please log in via noVNC now.")
        log(f"\u23f3 Waiting up to {LOGIN_TIMEOUT}s for login...\n")

        elapsed = 0
        while elapsed < LOGIN_TIMEOUT:
            await asyncio.sleep(5)
            elapsed += 5

            logged_in = await _check_logged_in(page)
            if logged_in:
                email = await _get_logged_in_email(page)
                log(f"\n\u2705 Login detected! Logged in as: {email}")
                break

            remaining = LOGIN_TIMEOUT - elapsed
            if elapsed % 30 == 0:
                log(f"\u23f3 Still waiting... {remaining}s remaining.")
        else:
            log("\n\u274c Login timeout.")
            await context.close()
            return {"status": "timeout", "error": "Login timeout"}

        await asyncio.sleep(3)
        await _verify_meet_access(page)

        log("\n\U0001f4be Saving browser session...")
        await context.close()
        await asyncio.sleep(2)

        _save_backup(base_profile)

        log(f"\n\u2705 Base profile saved successfully!")
        log(f"   Location: {base_profile}")
        log(f"   Backup  : {BACKUP_PROFILE}")
        log("\n\U0001f389 Setup complete!")

    return {"status": "logged_in", "profile": base_profile}


def profile_exists(base_profile: str | None = None) -> bool:
    if base_profile is None:
        base_profile = BASE_PROFILE
    return os.path.isdir(base_profile)


def _set_env():
    os.environ.setdefault("DISPLAY", DISPLAY)
    os.environ.setdefault("PULSE_SERVER", PULSE_SERVER)


async def _check_logged_in(page) -> bool:
    try:
        current_url = page.url
        if "myaccount.google.com" in current_url:
            return True
        if "accounts.google.com" in current_url and "signin" not in current_url and "v3" not in current_url:
            body = (await page.locator("body").inner_text(timeout=3000)).lower()
            if any(hint in body for hint in ["manage your google account", "sign out", "google account"]):
                return True
        body = (await page.locator("body").inner_text(timeout=3000)).lower()
        if "sign in" in body and "create account" in body:
            return False
        return False
    except Exception:
        return False


async def _get_logged_in_email(page) -> str:
    try:
        await page.goto("https://myaccount.google.com", wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)
        body = await page.locator("body").inner_text(timeout=3000)
        for line in body.splitlines():
            line = line.strip()
            if "@" in line and "." in line and len(line) < 60:
                return line
        return "(email not detected)"
    except Exception:
        return "(email not detected)"


async def _verify_meet_access(page):
    try:
        log("\U0001f50d Verifying Google Meet access...")
        await page.goto("https://meet.google.com", wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(3000)
        body = (await page.locator("body").inner_text(timeout=3000)).lower()
        if "new meeting" in body or "start a meeting" in body or "join" in body:
            log("\u2705 Google Meet access confirmed.")
        else:
            log("\u26a0\ufe0f  Could not confirm Meet access.")
    except Exception as e:
        log(f"\u26a0\ufe0f  Meet verification warning: {e}")


def _save_backup(base_profile: str):
    try:
        if os.path.exists(BACKUP_PROFILE):
            shutil.rmtree(BACKUP_PROFILE, ignore_errors=True)
        shutil.copytree(base_profile, BACKUP_PROFILE)
        log(f"\U0001f4be Backup saved at {BACKUP_PROFILE}")
    except Exception as e:
        log(f"\u26a0\ufe0f  Backup warning: {e}")


if __name__ == "__main__":
    result = asyncio.run(run_login())
    print(f"RESULT:{result}", flush=True)
