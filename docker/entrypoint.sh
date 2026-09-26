#!/bin/sh
# Prepare /data, then hand off to uvicorn (PID 1, so signals work).
#
# Everything here is idempotent: the container is restarted far more
# often than it is created, and a restart must never touch existing data.
set -eu

DATA_DIR=/data

log() { echo "entrypoint: $*" >&2; }

if [ ! -d "$DATA_DIR" ]; then
    log "ERROR: $DATA_DIR does not exist inside the container."
    log "       Check the volumes: section of docker-compose.yml."
    exit 1
fi

if [ ! -w "$DATA_DIR" ]; then
    log "ERROR: $DATA_DIR is not writable by uid $(id -u):$(id -g)."
    log "       With a bind mount, give it to that user on the host:"
    log "         sudo chown -R $(id -u):$(id -g) ./data"
    log "       Or set PUID/PGID in .env to the owner of ./data."
    exit 1
fi

# The chat-room persistence root. The app creates per-room directories
# under it but never the root itself through a symlink, so do it here.
mkdir -p "$DATA_DIR/chatrooms"

# First run only: no Personas directory yet. Seed it the same way a bare
# metal install does — from a personas.yaml left in /data if the user
# brought one over from an older install, otherwise from the stock
# personas.yaml.example shipped in the image. Once the directory exists
# this block never runs again, so a user who deletes every persona keeps
# an empty app instead of getting Alex and Luna back.
if [ ! -e "$DATA_DIR/Personas" ]; then
    if [ -f "$DATA_DIR/personas.yaml" ]; then
        log "importing $DATA_DIR/personas.yaml into $DATA_DIR/Personas"
        # Fatal on failure: this is the user's own data, and starting
        # with an empty app would look like it had been lost.
        python /usr/local/bin/seed_personas.py "$DATA_DIR/personas.yaml" "$DATA_DIR/Personas"
        mv "$DATA_DIR/personas.yaml" "$DATA_DIR/personas.yaml.bak"
        log "import complete; the original is kept as personas.yaml.bak"
    else
        log "first run: seeding the example personas into $DATA_DIR/Personas"
        # Not fatal: an app that starts with no personas is still usable
        # (you can create them in the UI), so don't block the boot.
        python /usr/local/bin/seed_personas.py /app/personas.yaml.example "$DATA_DIR/Personas" \
            || log "WARNING: could not seed the example personas; starting with none"
    fi
fi

exec "$@"
