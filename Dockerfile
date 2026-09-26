# TalkWithMe — production image.
#
# Layout inside the container:
#   /app    the application (nothing the app writes lives here)
#   /data   every file the app writes, backed by a volume (see docker-compose.yml)
#
# The app resolves all of its state relative to the project root (see
# _PROJECT_ROOT in app/config.py), so the writable names under /app are
# symlinks into /data. Writes follow the symlinks; the container layer
# stays disposable and /data is the only thing worth backing up.

# ---------------------------------------------------------------------------
# Stage 1 — build the virtualenv
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Every pinned dependency (including uvloop/httptools/watchfiles from
# uvicorn[standard]) ships manylinux wheels for cp312 on amd64 and
# arm64, so no compiler is needed. If you bump a pin to a version
# without a wheel, add build-essential to this stage only.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install -r requirements.txt

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    HOME=/tmp

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Only what the app serves or reads at runtime. personas.yaml.example is
# required, not decoration: it is the template the stock Alex/Luna
# personas are seeded from on first start.
COPY app/ ./app/
COPY static/ ./static/
COPY templates/ ./templates/
COPY personas.yaml.example LICENSE ./
COPY docker/entrypoint.sh docker/seed_personas.py /usr/local/bin/
# Explicit modes, not bare `chmod +x` (which only adds bits on top of
# whatever COPY preserved from the build context): the container runs as
# a non-root user, so everything it reads or executes must be
# world-readable regardless of the source files' permissions on the host
# doing the build (a restrictive umask/ACL there must not become a
# permission-denied crash loop at runtime).
RUN chmod -R a+rX /app \
    && chmod 755 /usr/local/bin/entrypoint.sh \
    && chmod 644 /usr/local/bin/seed_personas.py

# The writable project-root names, pointed at the volume. A dangling
# symlink to a *file* reads as "missing" (the app falls back to its
# defaults) and a write through it creates the file in /data. The two
# *directories* are created by the entrypoint instead: pathlib's
# mkdir(exist_ok=True) raises on a dangling directory symlink.
RUN set -eux; \
    ln -s /data/Personas       /app/Personas; \
    ln -s /data/chatrooms      /app/chatrooms; \
    ln -s /data/settings.yaml  /app/settings.yaml; \
    ln -s /data/chatrooms.yaml /app/chatrooms.yaml; \
    ln -s /data/llm_api_key    /app/llm_api_key; \
    mkdir -p /data

# Runs as uid/gid 1000 by default; docker-compose.yml lets you override
# that with PUID/PGID to match the owner of a bind-mounted ./data.
RUN groupadd --gid 1000 talkwithme \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin talkwithme \
    && chown -R talkwithme:talkwithme /data
USER 1000:1000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# One worker, always: the active session, persona cache and chat-room
# membership live in module-level state (app/session.py, app/config.py),
# so a second worker would answer from a different conversation.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
