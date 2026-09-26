# Smart MoM Docs MCP Server

A tiny local MCP (Model Context Protocol) server that exposes this repo's `documentation/docs/` MkDocs handbook to AI coding agents — so Claude Code, OpenCode, or any other MCP client can search and read the handbook directly from the editor/terminal instead of you pasting pages into chat.

Tools exposed: `list_pages()`, `get_page(path)`, `search_docs(query)`. Pages are also available as MCP resources under `docs://<path>`.

Runs two ways, via `MCP_TRANSPORT`:

- **stdio** (default) — a client launches `server.py` directly; needs this repo checked out. Used by the committed `.mcp.json`/`opencode.json`.
- **`MCP_TRANSPORT=http`** — runs as a network service instead, so a client only needs a URL + bearer token, no local checkout. This is how `../docker-compose.yml`'s `mcp` service runs it once `documentation/` is hosted.

## Setup (local, stdio)

```bash
cd documentation/mcp-server
python -m venv .venv
# .venv\Scripts\activate   (Windows)   or   source .venv/bin/activate   (macOS/Linux)
pip install -r requirements.txt
python server.py   # sanity check: should block waiting on stdio, Ctrl+C to exit
```

Then point your MCP client at `documentation/mcp-server/server.py` — see the repo-root `.mcp.json` (Claude Code) and `opencode.json` (OpenCode).

For the hosted/remote setup (Docker, `MCP_AUTH_TOKEN`, and the exact `.mcp.json`/`opencode.json` remote entries for both tools), see [../docs/mcp-server.md](../docs/mcp-server.md) — that's the full reference for both modes.
