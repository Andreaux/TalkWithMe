"""Create the Personas directory from a personas.yaml-style file.

Used once, by docker/entrypoint.sh, before uvicorn starts. It calls the
app's own migration routine so the on-disk layout is byte-for-byte what
a bare-metal first run produces (docs/feature_persona_autodiscovery.md).

Why the entrypoint does this at all, rather than letting the app seed
itself at startup: in the image /app/Personas is a symlink into the
volume, and when its target is missing the app's own seeding path dies
on Path.mkdir(exist_ok=True) — that call raises FileExistsError for a
dangling symlink. Creating the real directory in /data first means the
app finds a populated directory and skips its seeding branch entirely.

usage: seed_personas.py <source personas.yaml> <target Personas dir>
"""

import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="seed_personas: %(message)s")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    source, target = Path(argv[1]), Path(argv[2])

    # Imported here, after the argument check, so a usage error does not
    # depend on the app importing cleanly.
    from app.services import persona_store

    try:
        # backup=False: renaming the source is the entrypoint's job — it
        # knows whether the file is user data or the shipped example.
        persona_store.migrate_from_legacy_yaml(source, target, backup=False)
    except Exception as exc:  # noqa: BLE001 — the caller decides what is fatal
        logging.error("cannot seed %s from %s: %s", target, source, exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
