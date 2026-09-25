#!/usr/bin/env python3
"""Ship the dashboard to the homelab box.

    ./deploy.py              # sync, build the image on the box, deploy
    ./deploy.py --no-build   # redeploy the image that is already there
    ./deploy.py --logs       # follow the container log afterwards

The image is built on the box rather than here: there is no registry in this
setup, and Dokploy's Raw compose provider can only reference an image, not a
build context. So the source is copied to ~/mediarr-dash, `docker build` runs
over SSH, and the compose file that Dokploy holds just names the result.

Dokploy is optional. With DOKPLOY_COMPOSE_ID set in .dokploy.env the compose
file is pushed through its API and deployed there; without it the stack is
brought up with plain `docker compose` in ~/mediarr-dash, which is also the
fallback if Dokploy is ever down.

.dokploy.env (gitignored, chmod 600):

    DOKPLOY_URL=http://debian:3000
    DOKPLOY_API_KEY=<Dokploy -> Settings -> API/CLI>
    DOKPLOY_COMPOSE_ID=<from the browser URL of the compose app>
"""

import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).parent
SSH_HOST = "homelab"
REMOTE_DIR = "/home/davide/mediarr-dash"
IMAGE = "mediarr-dash:latest"

# Everything the image needs and nothing that would be rebuilt inside it.
EXCLUDES = [
    "./node_modules",
    "./server/node_modules",
    "./frontend/node_modules",
    "./server/dist",
    "./frontend/dist",
    "./.env",
    "./.dokploy.env",
    "./.git",
]

# Directories that are wholly ours: cleared before unpacking so a file deleted
# here does not linger on the box. .env lives next to them and is left alone.
OWNED = ["server", "frontend", "scripts"]


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, **kwargs)


def ssh(command: str, **kwargs) -> subprocess.CompletedProcess:
    return run(["ssh", SSH_HOST, command], **kwargs)


def sync() -> None:
    """Copy the source up as a tar stream.

    The box has no rsync, and installing one to move a few hundred kilobytes is
    not worth it -- tar over the SSH connection needs nothing that is not
    already there."""
    ssh(f"mkdir -p {REMOTE_DIR} && rm -rf " + " ".join(f"{REMOTE_DIR}/{d}" for d in OWNED))
    excludes = [f"--exclude={pattern}" for pattern in EXCLUDES]
    cmd = ["tar", "-czf", "-", *excludes, "-C", str(HERE), "."]
    print(f"$ {' '.join(cmd)} | ssh {SSH_HOST} tar -xzf - -C {REMOTE_DIR}")
    tar = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    try:
        subprocess.run(["ssh", SSH_HOST, f"tar -xzf - -C {REMOTE_DIR}"], stdin=tar.stdout, check=True)
    finally:
        if tar.stdout:
            tar.stdout.close()
        if tar.wait() != 0:
            sys.exit("tar failed while packing the source")


def load_env() -> dict:
    path = HERE / ".dokploy.env"
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def dokploy(env: dict, endpoint: str, payload: dict, timeout: int = 300):
    req = urllib.request.Request(
        f"{env['DOKPLOY_URL']}/api/{endpoint}",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "x-api-key": env["DOKPLOY_API_KEY"]},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or "null")
    except urllib.error.HTTPError as exc:
        sys.exit(f"{endpoint} failed: {exc.code} {exc.read().decode()[:400]}")


def main() -> int:
    args = sys.argv[1:]
    env = load_env()

    sync()

    if "--no-build" not in args:
        # BuildKit keeps the pnpm install layer between deploys, so a source-only
        # change rebuilds in seconds.
        ssh(f"cd {REMOTE_DIR} && DOCKER_BUILDKIT=1 docker build -t {IMAGE} .")

    compose_id = env.get("DOKPLOY_COMPOSE_ID")
    if compose_id and env.get("DOKPLOY_URL") and env.get("DOKPLOY_API_KEY"):
        compose_file = (HERE / "docker-compose.yml").read_text()
        dokploy(env, "compose.update", {"composeId": compose_id, "composeFile": compose_file})
        print("pushed compose to Dokploy")
        dokploy(env, "compose.deploy", {"composeId": compose_id})
        print("deployment queued in Dokploy")
        time.sleep(8)
    else:
        print("no DOKPLOY_COMPOSE_ID — bringing the stack up directly on the box")
        ssh(f"cd {REMOTE_DIR} && docker compose up -d --remove-orphans")

    ssh("docker ps --filter name=mediarr-dash --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'")

    if "--logs" in args:
        subprocess.run(["ssh", SSH_HOST, "docker logs -f --tail 60 mediarr-dash"])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
