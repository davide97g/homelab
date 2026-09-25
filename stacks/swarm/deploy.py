#!/usr/bin/env python3
"""Build Swarm and hand it to qBittorrent as its WebUI.

The UI is served by qBittorrent itself, so there is no container to build, no
image to push and nothing to restart. Deploying is: put static files where the
container can read them, then flip one preference.

Why /home/davide/media/webui: qBittorrent's /config is a named Docker volume,
awkward to write into, but /data is already a bind mount of /home/davide/media
and the host user is uid 1000 -- the same uid the container runs as. So the
files land with the right ownership and no docker cp or chown is needed.

Rollback needs no working UI and no deploy:

    ./deploy.py --revert
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HOST = "homelab"
# qBittorrent serves an alternative UI from <root>/public, not <root> itself.
# Point RootFolder at the parent and put the build one level down -- this is
# the same layout VueTorrent ships. Get it wrong and qBittorrent logs
# "Using custom WebUI" immediately followed by "Using built-in WebUI", and
# silently resets alternative_webui_enabled to false.
HOST_DIR = "/home/davide/media/webui"
PUBLIC_DIR = f"{HOST_DIR}/public"
CONTAINER_DIR = "/data/webui"
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")


def run(cmd: list[str], **kw) -> str:
    result = subprocess.run(cmd, text=True, capture_output=True, **kw)
    if result.returncode != 0:
        sys.exit(f"failed: {' '.join(cmd)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def api(method: str, path: str, data: str | None = None) -> str:
    """Call the qBittorrent API from inside its own container.

    Doing it there rather than from this machine keeps every request
    same-origin, which matters: qBittorrent answers a request whose Origin is
    not its own with 401, and one whose Host does not match with 403.
    """
    user = os.environ.get("QBIT_USER", "admin")
    password = os.environ.get("QBIT_PASS")
    if not password:
        sys.exit("set QBIT_PASS (and QBIT_USER if it is not 'admin')")

    body = f"-d {json.dumps(data)}" if data else ""
    script = (
        f"curl -s -c /tmp/deploy.cookie -d 'username={user}&password={password}' "
        f"http://localhost:8080/api/v2/auth/login >/dev/null && "
        f"curl -s -b /tmp/deploy.cookie -X {method} {body} "
        f"http://localhost:8080/api/v2{path}; "
        f"rm -f /tmp/deploy.cookie"
    )
    return run(["ssh", HOST, f"docker exec qbittorrent sh -c {json.dumps(script)}"])


def snapshot() -> None:
    prefs = json.loads(api("GET", "/app/preferences"))
    print("current:")
    print(f"  alternative_webui_enabled = {prefs.get('alternative_webui_enabled')}")
    print(f"  alternative_webui_path    = {prefs.get('alternative_webui_path')!r}")


def set_prefs(prefs: dict) -> None:
    api("POST", "/app/setPreferences", f"json={json.dumps(prefs)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revert", action="store_true", help="give qBittorrent its own UI back")
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()

    snapshot()

    if args.revert:
        set_prefs({"alternative_webui_enabled": False})
        print("reverted -- qBittorrent is serving its built-in WebUI again")
        return

    if not args.no_build:
        print("building...")
        run(["pnpm", "build"], cwd=os.path.dirname(FRONTEND))

    print(f"syncing to {HOST}:{PUBLIC_DIR} ...")
    run(["ssh", HOST, f"mkdir -p {PUBLIC_DIR}"])
    # --delete so a rename in dist/ never leaves a stale asset behind.
    run(["rsync", "-a", "--delete", f"{FRONTEND}/dist/", f"{HOST}:{PUBLIC_DIR}/"])

    # Two calls, path first. Sent together, qBittorrent acts on the enable flag
    # before the path is in place, finds no folder, and quietly turns itself
    # back off -- leaving RootFolder set and AlternativeUIEnabled false.
    set_prefs({"alternative_webui_path": CONTAINER_DIR})
    set_prefs({"alternative_webui_enabled": True})
    print("deployed -- http://debian:8080")
    snapshot()


if __name__ == "__main__":
    main()
