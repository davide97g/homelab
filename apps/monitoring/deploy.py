#!/usr/bin/env python3
"""Deploy what is on main, by hand. A push to main already does this from CI.

Dokploy pulls apps/monitoring/docker-compose.yml from davide97g/homelab itself,
so this script pushes nothing: it checks that the committed compose matches
build.py and that main is pushed, then asks Dokploy to deploy. NAS_TAILNET_IP
and the other secrets live in the compose's Environment tab in Dokploy.

Credentials live in `.dokploy.env` (gitignored):

    DOKPLOY_URL=http://debian:3000
    DOKPLOY_API_KEY=...
    DOKPLOY_COMPOSE_ID=...

Usage:
    ./deploy.py              # deploy main
    ./deploy.py --recreate   # same, but stop the stack first

build.py labels every service with a hash of the configs it mounts, so a changed
dashboard or scrape config recreates its service on a normal deploy. --recreate
is only for when something else needs a clean start.
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
    for key in ("DOKPLOY_URL", "DOKPLOY_API_KEY", "DOKPLOY_COMPOSE_ID"):
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
    git = lambda *a: subprocess.run(["git", "-C", str(HERE), *a], capture_output=True, text=True)
    if git("diff", "--quiet", "HEAD", "--", "docker-compose.yml").returncode:
        sys.exit("docker-compose.yml differs from the last commit: commit it and push first")
    git("fetch", "-q", "origin", "main")
    if git("rev-parse", "HEAD").stdout != git("rev-parse", "origin/main").stdout:
        sys.exit("HEAD is not origin/main: Dokploy deploys main from GitHub, so push first")

    if recreate:
        call(env, "compose.stop", {"composeId": env["DOKPLOY_COMPOSE_ID"]})
        print("stopped stack")

    call(env, "compose.deploy", {"composeId": env["DOKPLOY_COMPOSE_ID"]})
    print("deployment queued")
    time.sleep(10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
