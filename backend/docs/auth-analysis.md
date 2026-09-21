# Google Meet Bot Authentication Analysis

## The Question

Can we use the bot's OAuth access_token and refresh_token to programmatically sign
into Google in Playwright, so the bot can join a Google Meet meeting — without
using a password or manual noVNC login?

**Short answer:** No — not with the tokens alone, because OAuth tokens and browser
session cookies serve fundamentally different purposes in Google's architecture.

---

## 1. Why Tokens Cannot Sign You Into Google in a Browser

### 1.1 Two Separate Auth Systems

Google has two distinct authentication systems that talk to different backends:

| System | What it produces | Where it's used |
|--------|------------------|-----------------|
| **OAuth 2.0** | `access_token`, `id_token`, `refresh_token` | Google REST APIs (People API, Calendar, etc.) |
| **Google Sign-In / Web SSO** | Session cookies (`SAPISID`, `SID`, `__Secure-3PSID`) | Google web properties (Meet, Gmail, Drive, etc.) |

OAuth tokens are **API credentials** — they let a backend server prove "this app
has permission to act on behalf of this user." They contain no notion of a
"browser session." They cannot be used to fabricate or derive session cookies.

Session cookies are **browser credentials** — they prove "this specific browser
tab has an active Google session." They are cryptographically signed and contain
server-held secrets that no token can reproduce.

### 1.2 The GIS Bridge (and why it fails in automated browsers)

Google Identity Services (GIS) provides the only bridge between these two
systems: the `storeCredential()` + `prompt()` flow.

```
OAuth id_token ──→ storeCredential() ──→ browser IndexedDB
                                         prompt({auto_select: true})
                                              │
                                              ▼
                                    Google server verifies token
                                              │
                                              ▼
                                    Sets session cookies in browser
```

This flow is **designed for interactive web apps**, not automated browsers.
Google's servers apply additional security checks:

1. **One Tap consent required** — the user must have previously interacted with
   a One Tap prompt (`g_state` cookie / server-side consent record).
   Without it, `auto_select` silently skips.
2. **Automated browser detection** — Google's JS can detect Playwright/Puppeteer
   via `navigator.webdriver`, missing Chrome extensions, unusual timing, etc.
   When detected, One Tap dialogs are suppressed entirely.
3. **TrustedScriptURL CSP** — `accounts.google.com` has strict CSP policies that
   block `eval()` and script injection, preventing workarounds.

### 1.3 No Other Bridge Exists

There is **no Google endpoint** that:
- Accepts a Bearer `access_token` in an HTTP request
- AND returns `Set-Cookie` headers for session cookies

The closest endpoints (`/o/oauth2/iframe`, `/o/oauth2/token`, `/gsi/...`) either:
- Check for existing cookies (don't create them)
- Return JSON tokens (not cookies)
- Require browser-redirect flows with user interaction

---

## 2. Approaches That Were Tried and Why They Failed

### 2.1 GIS `storeCredential` + `prompt({auto_select: true})`

**What we did:**
1. Loaded GIS on `www.gstatic.com`
2. Called `storeCredential(id_token)` — returned "stored"
3. Called `prompt({auto_select: true})`
4. Waited 15s for callback
5. Looked for One Tap dialog (`#credential_picker_container`)

**Why it failed:**
- One Tap container never appeared (dialog suppressed by automated browser
  detection)
- Callback was never called (silent auto-select requires prior One Tap consent,
  which the bot account never had)
- No session cookies were set

### 2.2 Bearer token fetch to `accounts.google.com`

**What we did:**
- Made `fetch('https://accounts.google.com/o/oauth2/iframe', {Authorization:
  'Bearer {access_token}', credentials: 'include'})` from the browser

**Why it failed:**
- The `/o/oauth2/iframe` endpoint checks for EXISTING session cookies
- It does not accept Bearer tokens as authentication
- No cookies were set

### 2.3 GIS on `accounts.google.com` directly

**What we tried:**
- Navigated to `accounts.google.com`
- Injected GIS and called `storeCredential` + `prompt`

**Why it failed:**
- `accounts.google.com` has CSP that blocks `TrustedScriptURL` — our injected
  script tag was blocked
- Even if injected, the same auto-select consent issue applies

### 2.4 OAuth implicit flow via `google.accounts.oauth2`

**What we considered:**
- Using `initTokenClient().requestAccessToken()` which redirects through
  Google's OAuth flow and might set cookies

**Why it would fail:**
- The OAuth redirect flow requires the user to be **already signed in** with
  session cookies. Without them, the OAuth page shows the sign-in form.
- `prompt: 'none'` would just return an error (no session to skip the prompt)

### 2.5 Direct cookie manipulation via CDP

**What we considered:**
- Using `context.add_cookies()` in Playwright to inject Google session cookies
  obtained server-side

**Why it would fail:**
- Session cookies are cryptographically signed by Google's servers
- There is no API endpoint that issues session cookies in exchange for an
  access_token
- We cannot forge valid cookies

---

## 3. Approaches That Could Work (and Their Trade-offs)

### 3.1 Password-based form login (current implemented approach)

**How it works:**
1. Navigate to `accounts.google.com`
2. Fill email field with bot email
3. Click "Next"
4. Fill password field with `BOT_GOOGLE_PASSWORD` env var
5. Click "Next"
6. Google's server sets all session cookies

**Why it works:**
- It's the same flow a human uses — Google's anti-automation checks are
  weaker on the actual sign-in form than on One Tap
- Playwright can reliably select `input[type="email"]` and
  `input[type="password"]`
- Session cookies are properly set by Google's server

**Downsides:**
- Requires storing the bot account password as an environment variable
- May trigger CAPTCHA or 2FA if Google detects unusual login patterns
- Password could expire or be changed

### 3.2 Two-Page GIS Silent Exchange (untested variant)

**Hypothesis:** `storeCredential` stores in IndexedDB, but `prompt()` only
reads stored credentials on a **subsequent page load**, not the same one.

**Flow:**
1. Page 1: Load GIS on arbitrary page, call `storeCredential(id_token)`, close
2. Page 2 (new tab): Load GIS on `accounts.google.com`, call
   `prompt({auto_select: true, cancel_on_tap_outside: false})`
3. Wait up to 30s for the silent exchange

**Why it might work (or fail):**
- If Google stores the credential server-side (not just IndexedDB), the second
  page might find it
- If auto-select is truly blocked by lack of One Tap consent, this still fails
- **Worth exactly one more try** with the two-page approach

### 3.3 Native WebRTC Client (no browser at all)

**How it works:**
- Implement the Google Meet signaling protocol directly in Python
- Use the `access_token` as a Bearer token for Meet's internal REST APIs
- Join the meeting's WebRTC conference and capture audio
- All authentication is server-to-server via OAuth

**Requirements:**
- Reverse-engineer `https://meet.google.com/` internal API calls:
  - Session creation (`/session`)
  - Signaling channel negotiation
  - WebRTC ICE/SCEP exchange
- This API is **undocumented and changes frequently**
- Tools like `aiortc` or `pion/webrtc` for WebRTC in Python

**Why it might work:**
- Google Meet's server-side API likely accepts Bearer tokens for
  authentication (since it's a Google API)
- No browser needed — no session cookie problem

**Risks:**
- Google could change the API at any time, breaking the integration
- Significant development effort (weeks, not hours)
- Audio routing and synchronisation are non-trivial

### 3.4 Manual One-Time Login via noVNC (current fallback)

**How it works:**
1. Admin opens `http://localhost:6080/vnc.html`
2. Signs in once with bot email + password
3. Chrome profile (`/tmp/bot-chrome-profile`) persists the cookies
4. All subsequent recordings use the existing cookies

**Why it works:**
- It's a real human login — no automation detection
- The persistent profile survives container restarts (if volume-mounted)
- Zero code changes needed

**Downsides:**
- Requires one manual step per profile reset
- Cookies have a limited lifetime (Google expires them after ~6-12 months)

---

## 4. Decision Matrix

| Approach | Uses tokens only? | Reliable? | Effort | Risk |
|----------|:-----------------:|:---------:|:------:|:----:|
| Password form login | No | High | 1 day | Low (CAPTCHA) |
| Two-page GIS exchange | Yes | Low | 1-2 days | High (likely fails) |
| Native WebRTC client | Yes | Medium | 2-4 weeks | Medium (API changes) |
| Manual noVNC login | No | High | 15 min | Very low |
| Bearer fetch hack | Yes | None | N/A | Impossible |

## 5. Conclusion

**OAuth tokens alone cannot create a Google browser session** because Google has
no endpoint that exchanges tokens for session cookies. The GIS library's
`storeCredential` + `prompt` flow is the only intended bridge, but it is blocked
in automated browsers by consent requirements and anti-automation detection.

The two most practical paths forward are:

1. **Password-based login** (implemented) — stores password in env var,
   automates the real sign-in form. Most reliable automated approach.

2. **Native WebRTC client** — bypasses the browser entirely, authenticates all
   API calls with the Bearer token. Most architecturally pure but highest
   development cost.
