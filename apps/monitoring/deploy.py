#!/usr/bin/env python3
"""Build docker-compose.yml and push it to Dokploy, then deploy.

Credentials live in `.dokploy.env` (gitignored):

    DOKPLOY_URL=http://debian:3000
    DOKPLOY_API_KEY=...
    DOKPLOY_COMPOSE_ID=...
    NAS_TAILNET_IP=...       # the NAS's Tailscale address, a scrape target

Usage:
    ./deploy.py              # build, push, deploy
    ./deploy.py --recreate   # same, but stop the stack first

`docker compose up -d` does not notice a change in the *content* of an inline
`configs:` entry, so editing a dashboard and deploying normally leaves the old
JSON mounted. Use --recreate whenever compose.base.yml configs or a dashboard
changed. It costs a few seconds of monitoring downtime; the Prometheus and
Grafana volumes are untouched.
"""

import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).parent


def load_env() -> dict:
    path = HERE / ".dokploy.env"
    if not path.exists():
        sys.exit(f"missing {path.name} — see the docstring for its contents")
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    for key in ("DOKPLOY_URL", "DOKPLOY_API_KEY", "DOKPLOY_COMPOSE_ID", "NAS_TAILNET_IP"):
        if not env.get(key):
            sys.exit(f"{path.name}: {key} is not set")
    return env


def call(env: dict, endpoint: str, payload: dict, timeout: int = 180):
    req = urllib.request.Request(
        f"{env['DOKPLOY_URL']}/api/{endpoint}",
        data=json.dumps(payload).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": env["DOKPLOY_API_KEY"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or "null")
    except urllib.error.HTTPError as exc:
        sys.exit(f"{endpoint} failed: {exc.code} {exc.read().decode()[:400]}")


def main() -> int:
    recreate = "--recreate" in sys.argv[1:]
    env = load_env()

    subprocess.run([sys.executable, str(HERE / "build.py")], check=True)
    # The repo is public, so the NAS's tailnet address stays out of it: the
    # committed compose says ${NAS_TAILNET_IP} and the value is filled in here.
    compose_file = (HERE / "docker-compose.yml").read_text()
    compose_file = compose_file.replace("${NAS_TAILNET_IP}", env["NAS_TAILNET_IP"])

    call(env, "compose.update", {
        "composeId": env["DOKPLOY_COMPOSE_ID"],
        "composeFile": compose_file,
    })
    print("pushed compose to Dokploy")

    if recreate:
        call(env, "compose.stop", {"composeId": env["DOKPLOY_COMPOSE_ID"]})
        print("stopped stack")

    call(env, "compose.deploy", {"composeId": env["DOKPLOY_COMPOSE_ID"]})
    print("deployment queued")
    time.sleep(10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
