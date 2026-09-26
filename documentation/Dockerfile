# Two independent images from one build context (documentation/) — see docker-compose.yml:
#   target: site  — the MkDocs handbook, built to static HTML and served by nginx
#   target: mcp   — the same handbook exposed over the network as a streamable-HTTP
#                   MCP server, for Claude Code / OpenCode to attach to remotely
#                   once this is hosted (no local checkout or Python needed on
#                   the client side) — see docs/mcp-server.md

FROM python:3.12-slim AS builder
WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY mkdocs.yml .
COPY docs/ docs/
RUN mkdocs build --strict

FROM nginx:alpine AS site
COPY --from=builder /build/site /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1

FROM python:3.12-slim AS mcp
WORKDIR /app
ENV PYTHONUNBUFFERED=1 MCP_TRANSPORT=http

COPY mcp-server/requirements.txt mcp-server/requirements.txt
RUN pip install --no-cache-dir -r mcp-server/requirements.txt

COPY docs/ docs/
COPY mcp-server/server.py mcp-server/server.py

EXPOSE 8006
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8006/healthz', timeout=3)" || exit 1
CMD ["python", "mcp-server/server.py"]
