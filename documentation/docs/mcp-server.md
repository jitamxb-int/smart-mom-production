# MCP Docs Server

This repo ships a tiny **MCP (Model Context Protocol)** server, at `documentation/mcp-server/server.py`, that exposes this entire handbook to AI coding agents — Claude Code, OpenCode, or any other MCP-capable client — so they can search and read it directly from the terminal/editor instead of you copy-pasting pages into chat.

It runs two ways, chosen with the `MCP_TRANSPORT` env var:

| Mode | `MCP_TRANSPORT` | Who it's for |
|---|---|---|
| **Local (stdio)** | unset, or `stdio` (default) | Anyone with this repo checked out — the client launches `server.py` itself as a subprocess. This is what the committed `.mcp.json`/`opencode.json` use today. |
| **Remote (streamable-HTTP)** | `http` | Anyone who only has a URL — once `documentation/` is hosted on a server (see below), a client attaches to it over the network with **no local checkout, no Python, no code to configure** — just a URL. Auth-free by default; a bearer token is opt-in. |

Built and verified against `mcp` **2.2.0** (the current stable major version — note that v2 renamed the old `FastMCP` class to `MCPServer`; if you see older tutorials importing `from mcp.server.fastmcp import FastMCP`, that's the v1 API and requires pinning `mcp<2`).

## What it exposes (same in both modes)

| Kind | Name | Description |
|---|---|---|
| Tool | `list_pages()` | Lists every page path under `docs/`, e.g. `backend/api-reference.md` |
| Tool | `get_page(path)` | Returns one page's full markdown |
| Tool | `search_docs(query, max_results=15)` | Case-insensitive full-text search across every page, returning file/line/context |
| Resource | `docs://{path}` | Each page, addressable as an MCP resource |

Source: `documentation/mcp-server/server.py`. It reads directly from `documentation/docs/` on disk — regenerate nothing, restart nothing; edits to the markdown are picked up on the next call.

---

## Mode 1 — Local (stdio), for a repo checkout

### Setup

```bash
cd documentation/mcp-server
python -m venv .venv
# .venv\Scripts\activate      (Windows)
# source .venv/bin/activate   (macOS/Linux)
pip install -r requirements.txt
```

Sanity check it runs (it will block, waiting on stdio — `Ctrl+C` to exit):

```bash
python server.py
```

### Claude Code

Registered via `.mcp.json` at the repo root (project-scoped — Claude Code auto-detects this file and, since it's committed, every teammate gets the server automatically):

```json
{
  "mcpServers": {
    "smart-mom-docs": {
      "type": "stdio",
      "command": "python",
      "args": ["documentation/mcp-server/server.py"],
      "env": {}
    }
  }
}
```

Inside a Claude Code session, run `/mcp` to confirm `smart-mom-docs` is connected. If `python` doesn't resolve to the right interpreter (e.g. the one with `mcp` installed in `documentation/mcp-server/.venv`), point `command` at that venv's interpreter directly — an **absolute path** is safest, since Claude Code launches the server from its own working directory, not necessarily this repo's root:

```json
"command": "C:/path/to/repo/documentation/mcp-server/.venv/Scripts/python.exe"
```

### OpenCode

Registered via `opencode.json` at the repo root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "smart-mom-docs": {
      "type": "local",
      "command": ["python", "documentation/mcp-server/server.py"],
      "enabled": true
    }
  }
}
```

!!! note "Two files, not one"
    Claude Code and OpenCode use **incompatible** MCP config schemas — different top-level key (`mcpServers` vs `mcp`), different command shape (`command`+`args` vs. one combined `command` array), and a different env-var key (`env` vs `environment`). Both `.mcp.json` and `opencode.json` are checked in side by side; each tool reads its own file and ignores the other, so there's no conflict.

### Other MCP clients

Any MCP client that supports a local stdio server can use this the same way — point it at:

```bash
python /absolute/path/to/repo/documentation/mcp-server/server.py
```

### Troubleshooting

- **Server won't start / `ModuleNotFoundError: mcp`**: activate `documentation/mcp-server/.venv` first, or point the client's `command` at that venv's Python interpreter directly.
- **Client shows the server as connected but `list_pages` returns nothing**: confirm `documentation/docs/` exists one level up from `documentation/mcp-server/server.py` — the server resolves `DOCS_ROOT` relative to its own file location, not the caller's cwd, so this should be robust to how the client launches it.
- **Never `print()` inside `server.py`** — stdio is the wire protocol; any stray stdout write corrupts the MCP session. Use `logging` (stderr) if you need to debug.

---

## Mode 2 — Remote (streamable-HTTP), once `documentation/` is hosted

Once you deploy `documentation/` to a server (see [Deployment](operations/deployment.md)), `docker compose` there brings up a **second** service, `mcp`, alongside the static docs site — the same `server.py`, running as a network service instead of a subprocess, on port `8006` by default. Anyone can then attach Claude Code or OpenCode to it with just a URL — **no repo checkout, no Python, and nothing to run locally.** This is the point of hosting it: `mcp-server/` stops being something each teammate has to set up, and becomes one thing your team points at.

### Getting it running on the server

```bash
cd documentation
docker compose up -d --build
```

That's it — no `.env` or token needed. **By default the `mcp` service is auth-free**: anyone who can reach port `8006` can call `list_pages`/`get_page`/`search_docs` and read `docs://` resources. Since this handbook is documentation (not secrets or user data), that's a reasonable default for an internal network or a link you only share with your team — but if the server is reachable from the open internet, put it behind your reverse proxy's own access control (e.g. an nginx `allow`/`deny` block, or HTTP basic auth at the proxy level) rather than relying on obscurity. A plain `GET /healthz` is always unauthenticated (used by the container's own `HEALTHCHECK`).

If you'd rather require a bearer token at the application level instead (or in addition), copy `.env.example` to `.env`, set `MCP_AUTH_TOKEN` (e.g. `openssl rand -hex 32`), and `docker compose up -d --build` again — the server picks it up from the environment and starts requiring it on every `/mcp` call.

### Claude Code

Use `claude mcp add` (recommended — it writes the entry for you), or edit `.mcp.json` directly. Either way, `type` must be `"http"` (Claude Code also accepts `"sse"` for the older SSE transport) — an entry with a `url` but no `type` is a hard config error.

```bash
claude mcp add --transport http smart-mom-docs https://docs.yourdomain.com/mcp
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "smart-mom-docs": {
      "type": "http",
      "url": "https://docs.yourdomain.com/mcp"
    }
  }
}
```

### OpenCode

`opencode.json` uses `type: "remote"`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "smart-mom-docs": {
      "type": "remote",
      "url": "https://docs.yourdomain.com/mcp",
      "enabled": true
    }
  }
}
```

### If you turn `MCP_AUTH_TOKEN` on later

Add a `headers` object to either entry — the two tools use **different** env-var substitution syntax (`${VAR}` vs `{env:VAR}`), don't mix them up:

```json
// .mcp.json
"headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
```
```json
// opencode.json
"headers": { "Authorization": "Bearer {env:MCP_TOKEN}" }
```

!!! warning "Pick a non-reserved env var name (Claude Code only)"
    Claude Code expands `${VAR}` in a remote server's `url`/`headers`, **except** for a set of credential-named variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `NPM_TOKEN`, `HTTPS_PROXY`, and similar) — those always expand to an empty string, as a guard against a project config exfiltrating your own Claude credentials to a third-party server. Use something like `MCP_TOKEN`, not one of those names.

### Local vs. remote: which config is "the" config?

`.mcp.json` and `opencode.json` currently hold the **local stdio** entries, so the repo works out of the box for anyone who clones it. Once you have a real hosted URL, you have two reasonable choices — pick based on your team:

1. **Replace** the committed entries with the remote/http variant above. Simplest for teammates (nothing to install), but everyone then depends on the hosted server being up.
2. **Keep the committed config as local for dev, and have individual teammates add the remote entry themselves** (`claude mcp add ... --scope user` for a user-level config that doesn't touch the committed project file, or the equivalent personal config for OpenCode) — better if some contributors work offline or want the server code available regardless of hosting uptime.

### Troubleshooting

- **Client can't connect at all**: confirm your reverse proxy passes headers through untouched, and doesn't buffer/transform the streamable-HTTP response (same class of issue as the [SSE chat proxying note](operations/deployment.md#reverse-proxy-nginx-example) for the backend).
- **Client gets 401 on every call**: you (or someone) set `MCP_AUTH_TOKEN` on the server — either remove it to go back to auth-free, or add the matching `headers` block shown above to the client config.
