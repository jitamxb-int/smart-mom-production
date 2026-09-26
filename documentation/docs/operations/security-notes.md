# Security Notes

These were surfaced during the codebase review that produced this handbook. None of them were fixed as part of writing the docs — they're flagged here for the team to triage.

## Action needed now

!!! danger "Possible live credential in `transcription_service/.env`"
    `transcription_service/.env` contains what looks like a **live** Hugging Face (`HF_TOKEN`) value rather than a placeholder. **Treat it as compromised and rotate it**, and check whether it (or the file) was ever committed to git history:
    ```bash
    git log --all --full-history -- transcription_service/.env
    ```
    If it appears in history, rotate the token immediately and consider it exposed regardless of whether the file is tracked now — history persists even after a file is later gitignored. This handbook does not reproduce the value; do not paste secret values into documentation, chat, or commit messages.

## Endpoints with weaker or no authentication

| Endpoint | Current protection | Concern |
|---|---|---|
| `POST /api/v1/processing/callback` | **None** — no auth dependency declared at all | Any network-reachable caller can report a `processing_queue` item as completed/failed and supply arbitrary `output`. If this port is internet-facing rather than internal-only, consider adding a shared-secret or HMAC check, mirroring the transcript-PATCH pattern. |
| `POST /api/v1/meetings/bot/setup/login`, `GET /api/v1/meetings/bot/setup/login/{task_id}` | **None** | Anyone who can reach the backend can trigger the interactive Google-login flow for the Meet Bot's shared Chrome profile, or poll its status. Only `/status` and `DELETE /profile` on this router require admin. |
| `PATCH /api/v1/meetings/{id}` transcript ingestion | Optional HMAC (`X-Backend1-Signature`), **only enforced if `BACKEND1_HMAC_SECRET` is set** | If that env var is left unset in an environment, transcript ingestion has no integrity check beyond the caller holding a valid user JWT. Confirm it's always set in every deployed environment. |
| `GET /api/v1/meetings/{id}/download-audio` | Short-lived (1h) HMAC-signed query token, not a Bearer header | This is a deliberate, reasonable design (so a plain `<a href>` link works) — noted here only so it isn't mistaken for an oversight. |

## Design notes worth being aware of (not necessarily bugs)

- **AWS credentials**: the backend is designed to use an IAM instance role, with no static access keys in code or `.env` in production. Confirm this is actually how it's deployed (vs. developers pasting keys into `.env` "just for now").
- **JWT payload is decoded without signature verification in two places by design**: the frontend's NextAuth `jwt` callback base64-decodes the backend's JWT payload directly (it already trusts it, having just received it from the backend over a direct call) and `error_logger.py` decodes tokens with `verify_exp=False` purely to backfill a `user_id`/`user_email` for logging. Neither of these performs authorization — just be aware they exist so they aren't mistaken for a verification step.
- **`error_logs` traceback storage**: full tracebacks (up to 20,000 chars) are stored in MongoDB and exposed via `GET /api/v1/admin/error-logs/{id}` to any admin. Tracebacks can incidentally contain sensitive values (e.g. request bodies echoed into an exception message) — worth a periodic audit of what ends up in there if `error_logs` is ever exported or shared outside the team.

## Recommended next steps

1. Rotate the Hugging Face token (see above) regardless of git-history findings.
2. Decide whether `POST /api/v1/processing/callback` and the bot-setup login endpoints are meant to be internal-network-only; if they're internet-reachable, add authentication.
3. Confirm `BACKEND1_HMAC_SECRET` is set in every real deployment, not just documented as optional.
