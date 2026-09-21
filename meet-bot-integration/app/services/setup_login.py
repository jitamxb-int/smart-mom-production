import asyncio
import os
import shutil
import sys

from playwright.async_api import async_playwright

from app.config import settings

LOGIN_TIMEOUT = settings.login_timeout


async def run_login(base_profile: str | None = None) -> dict:
    if base_profile is None:
        base_profile = settings.chrome_base_profile

    backup_profile = settings.chrome_backup_profile
    _set_env()

    print("=" * 60, flush=True)
    print("  🔐 Smart Mom — Google Login Setup", flush=True)
    print("=" * 60, flush=True)
    print(f"\n[SETUP] Base profile path : {base_profile}", flush=True)
    print(f"[SETUP] Login timeout     : {LOGIN_TIMEOUT}s", flush=True)

    existing = os.path.exists(base_profile)
    if existing:
        print(f"\n[SETUP] ⚠️  Existing profile found at {base_profile}", flush=True)

    async with async_playwright() as p:
        print("\n[SETUP] 🌐 Opening Chrome in noVNC display...", flush=True)
        print(f"[SETUP] 👉 Open http://localhost:{settings.novnc_port}/vnc.html to see the browser.\n", flush=True)

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

        print("[SETUP] 🔗 Navigating to Google sign-in...", flush=True)
        await page.goto("https://accounts.google.com", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        already_logged_in = await _check_logged_in(page)
        if already_logged_in:
            email = await _get_logged_in_email(page)
            print(f"\n[SETUP] ✅ Already logged in as: {email}", flush=True)
            print("[SETUP] ✅ Base profile is ready.\n", flush=True)
            await _verify_meet_access(page)
            await context.close()
            _save_backup(base_profile, backup_profile)
            print("\n[SETUP] 🎉 Setup complete!", flush=True)
            return {"status": "already_logged_in", "email": email}

        print("[SETUP] ⚠️  Not logged in. Please log in via noVNC now.", flush=True)
        print(f"[SETUP] ⏳ Waiting up to {LOGIN_TIMEOUT}s for login...\n", flush=True)

        elapsed = 0
        while elapsed < LOGIN_TIMEOUT:
            await asyncio.sleep(5)
            elapsed += 5

            logged_in = await _check_logged_in(page)
            if logged_in:
                email = await _get_logged_in_email(page)
                print(f"\n[SETUP] ✅ Login detected! Logged in as: {email}", flush=True)
                break

            remaining = LOGIN_TIMEOUT - elapsed
            if elapsed % 30 == 0:
                print(f"[SETUP] ⏳ Still waiting... {remaining}s remaining.", flush=True)
        else:
            print("\n[SETUP] ❌ Login timeout.", flush=True)
            await context.close()
            return {"status": "timeout", "error": "Login timeout"}

        await asyncio.sleep(3)
        await _verify_meet_access(page)

        print("\n[SETUP] 💾 Saving browser session...", flush=True)
        await context.close()
        await asyncio.sleep(2)

        _save_backup(base_profile, backup_profile)

        print("\n[SETUP] ✅ Base profile saved successfully!", flush=True)
        print(f"[SETUP]    Location: {base_profile}", flush=True)
        print(f"[SETUP]    Backup  : {backup_profile}", flush=True)
        print("\n[SETUP] 🎉 Setup complete!", flush=True)

    return {"status": "logged_in", "profile": base_profile}


def profile_exists(base_profile: str | None = None) -> bool:
    if base_profile is None:
        base_profile = settings.chrome_base_profile
    return os.path.isdir(base_profile)


def _set_env():
    os.environ.setdefault("DISPLAY", settings.display)
    os.environ.setdefault("PULSE_SERVER", settings.pulse_server)


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
        print("[SETUP] 🔍 Verifying Google Meet access...", flush=True)
        await page.goto("https://meet.google.com", wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(3000)
        body = (await page.locator("body").inner_text(timeout=3000)).lower()
        if "new meeting" in body or "start a meeting" in body or "join" in body:
            print("[SETUP] ✅ Google Meet access confirmed.", flush=True)
        else:
            print("[SETUP] ⚠️  Could not confirm Meet access.", flush=True)
    except Exception as e:
        print(f"[SETUP] ⚠️  Meet verification warning: {e}", flush=True)


def _save_backup(base_profile: str, backup_profile: str):
    try:
        if os.path.exists(backup_profile):
            shutil.rmtree(backup_profile, ignore_errors=True)
        shutil.copytree(base_profile, backup_profile)
        print(f"[SETUP] 💾 Backup saved at {backup_profile}", flush=True)
    except Exception as e:
        print(f"[SETUP] ⚠️  Backup warning: {e}", flush=True)
