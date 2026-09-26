# Deploying with Docker Compose

Everything needed to run TalkWithMe on a remote Linux box lives in four
files at the repository root: `Dockerfile`, `docker-compose.yml`,
`.dockerignore`, and `.env.example` (plus `docker/entrypoint.sh` and
`docker/seed_personas.py`, which run inside the image).

This is a packaging layer only — no application code changed, and a
bare-metal `uvicorn app.main:app` run still works exactly as before.

---

## Quick start

On the target machine:

```bash
git clone <your fork or this repo> talkwithme
cd talkwithme

cp .env.example .env
$EDITOR .env                       # at minimum, check PUID/PGID and the bind address

mkdir -p data
sudo chown -R 1000:1000 data       # must match PUID:PGID in .env

docker compose up -d --build
docker compose logs -f
```

Then open `http://<host>:8000` (or whatever you set `TALKWITHME_PORT`
to). On the first start the two stock personas, Alex and Luna, are
created for you, exactly as on a fresh bare-metal install.

Day to day:

```bash
docker compose ps                  # status, including the healthcheck
docker compose logs -f             # follow the log
docker compose restart             # pick up a hand-edited data/settings.yaml
docker compose down                # stop; data/ is untouched
docker compose up -d --build       # after a git pull
```

---

## Where your data lives

The container keeps **all** persistent state in `/data`, which is the
`./data` directory on the host:

| Host path | What it is |
|---|---|
| `data/Personas/` | one subdirectory per persona (`prompt.md`, avatar, TTS reference audio, memories) |
| `data/chatrooms/` | per-room message history and audio |
| `data/settings.yaml` | LLM/TTS/STT/MCP endpoints and chat settings, written by the Settings dialog |
| `data/chatrooms.yaml` | the configured chat rooms |
| `data/llm_api_key` | optional; the API key file, if you prefer it over the environment variable |

Backing up `data/` backs up the installation. The image holds no state:
`docker compose down --rmi all` followed by a rebuild loses nothing.

Inside the container the app still looks for these next to its own code
(`/app/settings.yaml`, `/app/Personas`, ...), because it resolves
everything relative to the project root. Those names are symlinks into
`/data`, created when the image is built. Two consequences worth
knowing:

* Keep `general.personas_directory` in `settings.yaml` at the default
  `Personas/`. An absolute path there points outside the volume, and
  those personas would vanish on the next `docker compose up`.
* `docker compose exec talkwithme ls -l /app` shows the symlinks, which
  is a quick way to confirm the wiring if something looks unpersisted.

### Using a named volume instead

If you would rather not manage host directory permissions, swap the
volume in `docker-compose.yml`:

```yaml
    volumes:
      - talkwithme-data:/data

volumes:
  talkwithme-data:
```

Docker then creates the volume already owned by uid 1000, and you can
drop the `user:` line. The trade-off is that dropping a persona's
`ref.wav` in by hand now needs `docker compose cp` rather than a file
manager.

---

## Reaching your LLM, TTS, STT and MCP servers

This is the one thing that always needs adjusting after the first start:
`localhost` inside a container means *the container*, not the Docker
host, so the stock `http://localhost:8080` will not find a llama.cpp
server running on the box.

Open the Settings dialog in the UI (or edit `data/settings.yaml`) and
pick the form that matches where the server runs:

| The server runs... | Use this base URL |
|---|---|
| On the Docker host itself | `http://host.docker.internal:8080` |
| In another container in the same compose project | `http://<service-name>:8080` |
| On another machine | `http://<its address>:8080` |

`host.docker.internal` resolves because of the `extra_hosts:
host-gateway` line in `docker-compose.yml`; on Linux it would not exist
otherwise.

Make sure the server itself listens on more than loopback — a llama.cpp
started with `--host 127.0.0.1` is unreachable from a container whatever
hostname you use. Start it with `--host 0.0.0.0` and firewall the port.

The same applies to MCP servers configured under `mcp.servers`, and to
the TTS and STT endpoints.

### Host networking, as an alternative

If you would rather keep every endpoint as `localhost`, replace the
`ports:` and `extra_hosts:` blocks with:

```yaml
    network_mode: host
```

The app is then on the host's port 8000 directly, reachable by anything
that can reach the host — including from outside, if the port is not
firewalled. Since TalkWithMe has no authentication, prefer the default
published-port setup with a `127.0.0.1` bind.

---

## Configuration reference (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `TALKWITHME_BIND_ADDR` | `127.0.0.1` | Host interface the port is published on. `0.0.0.0` exposes it to the network. |
| `TALKWITHME_PORT` | `8000` | Host port. The container always listens on 8000 internally. |
| `TALKWITHME_DATA_DIR` | `./data` | Host directory mounted at `/data`. |
| `PUID` / `PGID` | `1000` | uid/gid the app runs as; must own the data directory. |
| `TALKWITHME_LLM_API_KEY` | *(empty)* | API key for a remote LLM. Overrides `data/llm_api_key`; changing it needs a restart, as on bare metal. |
| `TALKWITHME_LOG_LEVEL` | `info` | `debug` turns on the app's verbose logging (see the Logging section of the README). |
| `TZ` | `UTC` | Timezone for log timestamps and persisted message times. |

Application settings — endpoints, personas, rooms — are deliberately not
here. They belong in the UI and in `data/settings.yaml`, so the Settings
dialog stays the single source of truth.

---

## Security

TalkWithMe has **no authentication**. Anyone who can reach the port can
read every conversation, rewrite the personas' system prompts, and
invoke whatever your MCP servers expose.

The defaults reflect that: the port is published on `127.0.0.1` only,
and the container runs as an unprivileged user with no shell. To reach
it from elsewhere, tunnel in (`ssh -L 8000:127.0.0.1:8000 user@host`) or
put a reverse proxy with authentication in front of it. Setting
`TALKWITHME_BIND_ADDR=0.0.0.0` on an untrusted network exposes all of the
above.

---

## Operational notes

**One worker, on purpose.** The active session, the persona cache and
chat-room membership live in module-level state (`app/session.py`,
`app/config.py`). A second uvicorn worker would serve a second,
divergent copy of the conversation depending on which process got the
request. Scaling out would need shared state first; don't add
`--workers`.

**The healthcheck** fetches `/` every 30s, so `docker compose ps` tells
you whether the app is actually serving, not just whether the process is
alive. It says nothing about the LLM being reachable — that surfaces as
an error in the chat UI.

**Log volume.** The app logs a line per HTTP request at `info`, and the
UI polls. The `json-file` driver is capped at 3 × 10 MB in
`docker-compose.yml`; raise it there if you need more history, or switch
the driver if you ship logs elsewhere.

**Upgrades.** `git pull && docker compose up -d --build`. The image is
rebuilt, the container replaced, `data/` carried over untouched.
Dependency versions are pinned in `requirements.txt`, so a rebuild
reproduces the same environment unless that file changed.

**Image size** is about 260 MB, almost all of it the Python runtime and
the pinned wheels. The build is two-stage: dependencies are installed
into a virtualenv in a builder stage, and only that virtualenv plus the
app are copied into the runtime image.

---

## Troubleshooting

**`/data is not writable by uid 1000:1000`** — the entrypoint refuses to
start rather than half-working. Fix the owner on the host
(`sudo chown -R 1000:1000 data`) or set `PUID`/`PGID` in `.env` to the
uid that owns it (`stat -c '%u:%g' data`).

**Started with no personas** — this only happens if first-run seeding
failed; the log line says so. Create personas in the UI, or drop a
`personas.yaml` into `data/`, delete `data/Personas`, and restart to
import it.

**"Connection refused" when a persona replies** — the LLM base URL still
points at `localhost`, or the LLM is bound to loopback on the host. See
*Reaching your LLM...* above. A quick check from inside the container:

```bash
docker compose exec talkwithme python -c \
  "import urllib.request; print(urllib.request.urlopen('http://host.docker.internal:8080/v1/models', timeout=5).status)"
```

**Settings changes don't survive a restart** — confirm you are editing
`data/settings.yaml` and not a `settings.yaml` left over in the
repository root from a bare-metal run. Only `data/` is mounted, and the
repo-root copy is not even in the image (`.dockerignore` excludes it).

**Migrating an existing bare-metal install** — stop the old service, then
copy its state into place before the first `docker compose up`:

```bash
mkdir -p data
cp -a Personas chatrooms settings.yaml chatrooms.yaml llm_api_key data/ 2>/dev/null
sudo chown -R 1000:1000 data
docker compose up -d --build
```

Anything missing is simply recreated with defaults. If you are coming
from a version old enough to still use a single `personas.yaml`, put
that file in `data/` instead of a `Personas/` directory: the entrypoint
imports it on the first start and keeps the original as
`data/personas.yaml.bak`.
