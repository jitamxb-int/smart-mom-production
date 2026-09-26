# Deployment

## Production checklist

**Backend**

- [ ] `ENVIRONMENT=production`
- [ ] Strong random `JWT_SECRET` (≥64 chars)
- [ ] `CORS_ORIGINS` set to the real frontend domain(s)
- [ ] `ffmpeg -version` succeeds on the host/image (needed by the Meet Bot's recording step, not for chunk merging — see [Storage & Audio Pipeline](../backend/storage-audio.md))
- [ ] MongoDB Atlas with IP allowlist configured
- [ ] EC2 IAM instance role for S3 (no hardcoded credentials)
- [ ] Reverse proxy (nginx/Caddy) with HTTPS in front of both services
- [ ] `docker compose -f docker-compose-backend.yml up -d --build` after any code/Dockerfile change

**Frontend**

- [ ] `NEXTAUTH_URL` set to the real production URL, HTTPS
- [ ] Strong random `NEXTAUTH_SECRET`
- [ ] `NEXT_PUBLIC_API_URL` set to the backend's public URL
- [ ] `BACKEND_URL` set to the internal backend URL (container name in Docker Compose)
- [ ] `npm run build` before deploying

## Docker Compose services

**Backend** (`docker-compose-backend.yml`) — 4 services:

| Service | Container | Port | Notes |
|---|---|---|---|
| `api` | `smart-mom-api` | `3014` (+ noVNC) | `privileged`, `shm_size: 2gb`, `ipc: host` — required for the embedded Meet Bot's Chrome/Xvfb |
| `worker` | `smart-mom-worker` | — | Celery worker, all 5 queues |
| `beat` | — | — | Celery Beat scheduler — **not in the root README's compose table** |
| `redis` | `smart-mom-redis` | `6379` | Celery broker + JWT blacklist |

MongoDB Atlas and Qdrant Cloud are external managed services, configured via `.env`.

**Frontend** (`docker-compose-frontend.yml`) — single `frontend` service on port `3015`.

**meet-bot-integration** (`docker-compose.yaml`) — standalone service, API on `4001`, noVNC on `4002`. See [Meet Bot Integration Service](../services/meet-bot-integration.md) for why this is likely not part of the live production path.

**transcription_service** (`docker-compose.yml`) — the active service is `mock-transcription-service` on port `3001`; the real GPU service is fully commented out. See [Transcription Service](../services/transcription-service.md).

## Reverse proxy (nginx example)

```nginx
# Frontend
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3015;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}

# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://localhost:3014;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Required for SSE (chat streaming)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

## System dependencies

| Dependency | Required for | Install |
|---|---|---|
| Python 3.11+ | Backend runtime | `apt-get install python3.11` |
| Node.js 20+ | Frontend runtime | `apt-get install nodejs` |
| Redis 7 | Celery broker + JWT blacklist | `apt-get install redis-server` |
| ffmpeg | Meet Bot audio capture (not chunk merging) | `apt-get install ffmpeg` |
| MongoDB Atlas | Primary data store | Cloud service |
| Qdrant Cloud | Vector store for RAG | Cloud service |

## Serving this documentation site

The whole handbook — MkDocs source, config, and the MCP server — lives in `documentation/`, structured as its own self-contained, separately-hostable unit alongside `backend/`, `frontend/`, `meet-bot-integration/`, and `transcription_service/`.

**Local dev, with live-reload:**

```bash
cd documentation
python -m venv .venv
.venv\Scripts\activate        # Windows; source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
mkdocs serve                  # http://127.0.0.1:8000, live-reload
```

**Docker (static site + a remote-attachable MCP server):**

```bash
cd documentation
sh deploy_docs.sh
# — or —
docker compose up -d --build
```

`documentation/Dockerfile` builds two independent images from the same build context, selected by `target:` in `docker-compose.yml`:

| Service | Container | Port | Target | Notes |
|---|---|---|---|---|
| `docs` | `smart-mom-docs` | `3013` | `site` | `mkdocs build --strict` in a Python stage, served statically by `nginx:alpine` |
| `mcp` | `smart-mom-docs-mcp` | `8006` | `mcp` | `documentation/mcp-server/server.py` running in streamable-HTTP mode (`MCP_TRANSPORT=http`), so Claude Code/OpenCode can attach with just a URL — no local checkout needed. **Auth-free by default**; optionally set `MCP_AUTH_TOKEN` in `.env` (copy `.env.example`) to require a bearer token. Exposes an unauthenticated `GET /healthz` for uptime checks. See [MCP Docs Server](../mcp-server.md) for client-side setup on both tools. |

Both need HTTPS in front of them for a real deployment — extend the nginx example below with a `location /mcp` block (or a separate subdomain) proxying to `http://localhost:8006`, same SSE-friendly settings (`proxy_buffering off`) as the backend's `/api/chat` block.
