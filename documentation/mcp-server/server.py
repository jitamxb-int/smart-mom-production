"""MCP server that exposes this repo's MkDocs handbook (docs/) to AI coding agents.

Two ways to run this, chosen via the MCP_TRANSPORT env var:

- MCP_TRANSPORT unset or "stdio" (default): runs over stdio, for a client that
  has this repo checked out locally. Registered for Claude Code in `.mcp.json`
  and for OpenCode in `opencode.json`, both at the repo root.
- MCP_TRANSPORT=http: runs as a network service (streamable-HTTP transport),
  for a client that only has a URL — e.g. once `documentation/` is hosted on a
  server. See docs/mcp-server.md for the remote-client config for both tools.

See docs/mcp-server.md for full setup notes either way.
"""

import os
import re
from pathlib import Path

from mcp.server import MCPServer

DOCS_ROOT = (Path(__file__).resolve().parent.parent / "docs").resolve()

mcp = MCPServer("smart-mom-docs")


def _iter_pages() -> list[Path]:
    return sorted(DOCS_ROOT.rglob("*.md"))


def _rel(path: Path) -> str:
    return str(path.relative_to(DOCS_ROOT)).replace("\\", "/")


def _safe_path(rel_path: str) -> Path:
    candidate = (DOCS_ROOT / rel_path).resolve()
    if candidate != DOCS_ROOT and DOCS_ROOT not in candidate.parents:
        raise ValueError(f"Path escapes the docs root: {rel_path!r}")
    if not candidate.is_file():
        raise ValueError(f"No such documentation page: {rel_path!r}")
    return candidate


@mcp.tool()
def list_pages() -> list[str]:
    """List every documentation page, as a path relative to the docs/ root
    (e.g. 'backend/api-reference.md'). Use this first to see what's available."""
    return [_rel(p) for p in _iter_pages()]


@mcp.tool()
def get_page(path: str) -> str:
    """Return the full markdown content of one documentation page.

    Args:
        path: page path relative to docs/, exactly as returned by list_pages()
            (e.g. 'backend/api-reference.md').
    """
    return _safe_path(path).read_text(encoding="utf-8")


@mcp.tool()
def search_docs(query: str, max_results: int = 15) -> list[dict]:
    """Full-text, case-insensitive search across every documentation page.

    Args:
        query: substring to search for (e.g. an endpoint path, a model name,
            a collection name, or a keyword like 'JWT' or 'Celery').
        max_results: stop after this many matches (default 15).

    Returns a list of {file, line, match, context} objects, each naming the
    page and line number where the term was found, with one line of context
    on either side.
    """
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results: list[dict] = []
    for page in _iter_pages():
        lines = page.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if pattern.search(line):
                start, end = max(0, i - 1), min(len(lines), i + 2)
                results.append(
                    {
                        "file": _rel(page),
                        "line": i + 1,
                        "match": line.strip(),
                        "context": "\n".join(lines[start:end]).strip(),
                    }
                )
                if len(results) >= max_results:
                    return results
    return results


@mcp.resource("docs://{path}")
def doc_resource(path: str) -> str:
    """A documentation page, addressable by its relative path under docs/."""
    return _safe_path(path).read_text(encoding="utf-8")


def _build_http_app():
    """The streamable-HTTP ASGI app, wrapped in bearer-token auth if MCP_AUTH_TOKEN is set.

    DNS-rebinding Host/Origin validation is deliberately left at its default
    (disabled) here, since the public hostname isn't known in advance — the
    bearer token is the actual access control for a hosted deployment. Put
    this behind HTTPS (via your reverse proxy) and always set MCP_AUTH_TOKEN
    before exposing it beyond localhost.
    """
    app = mcp.streamable_http_app(host=os.environ.get("MCP_HOST", "0.0.0.0"))

    from starlette.responses import PlainTextResponse
    from starlette.routing import Route

    async def _healthz(request):
        return PlainTextResponse("ok")

    app.router.routes.insert(0, Route("/healthz", _healthz))

    token = os.environ.get("MCP_AUTH_TOKEN")
    if not token:
        import sys

        print(
            "WARNING: MCP_AUTH_TOKEN is not set — the docs MCP server is running "
            "over HTTP with no auth. Fine for localhost; do not expose this port "
            "to the internet without setting MCP_AUTH_TOKEN.",
            file=sys.stderr,
        )
        return app

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    class BearerAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            if request.url.path == "/healthz":
                return await call_next(request)
            if request.headers.get("authorization") != f"Bearer {token}":
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            return await call_next(request)

    app.add_middleware(BearerAuthMiddleware)
    return app


if __name__ == "__main__":
    transport = os.environ.get("MCP_TRANSPORT", "stdio")

    if transport == "stdio":
        mcp.run()  # blocks on stdio — never print() to stdout above this line
    elif transport == "http":
        import uvicorn

        uvicorn.run(
            _build_http_app(),
            host=os.environ.get("MCP_HOST", "0.0.0.0"),
            port=int(os.environ.get("MCP_PORT", "8006")),
        )
    else:
        raise SystemExit(f"Unknown MCP_TRANSPORT: {transport!r} (expected 'stdio' or 'http')")
