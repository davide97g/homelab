#!/usr/bin/env python3
"""After a Dokploy deploy reports done, ask the box whether it actually worked.

    verify-deploy.py <compose-file> [check-id,check-id,...]

A green Dokploy deploy means `compose up` returned. It does not mean the new
images are running, that their healthchecks passed, or that the service kept
the setting that matters -- Jellyfin 12.1 came up healthy with transcoding
silently moved to the CPU. The hub's /api/checks knows those things, so this
polls it until:

  * every image the compose file pins has a running container, not unhealthy
    and not still starting, and
  * every check named on the command line is settled (ok or warn),

then fails the run on anything that is not. Only this app's containers and
named checks count: a manga deploy does not go red over a Radarr warning.

The hub sits behind Cloudflare Access on the monitoring hostname, so the call
carries an Access service token plus the hub's own CHECKS_TOKEN. With any of
them missing the step says so and passes: the deploy itself already succeeded.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ATTEMPTS = 30  # x 10 s: healthchecks with a 60 s start_period fit comfortably
INTERVAL = 10


def pinned_images(path: str) -> list[str]:
    """Literal `image:` values; `${VAR:-x}` ones are locally built and carry no
    version to confirm. A digest is dropped because Docker reports a container's
    image by the reference without it."""
    images = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\s*image:\s*[\"']?([^\"'\s#]+)", line)
        if m and "${" not in m.group(1):
            images.append(m.group(1).split("@", 1)[0])
    return sorted(set(images))


def fetch(url: str, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read().decode()
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        # Cloudflare Access answers a missing or wrong service token with its
        # login page, 200 text/html.
        raise RuntimeError("not JSON -- is the Access service token allowed on the monitoring app?")


def judge(data: dict, images: list[str], required: list[str]) -> tuple[str, list[str]]:
    """('ok' | 'wait' | 'fail', reasons)."""
    waiting, failing = [], []

    for image in images:
        ours = [c for c in data["containers"] if c["image"] == image]
        running = [c for c in ours if c["state"] == "running"]
        if not running:
            state = ", ".join(f"{c['name']} {c['status']}" for c in ours) or "no container"
            waiting.append(f"{image}: not running ({state})")
        elif any("(unhealthy)" in c["status"] for c in running):
            failing.append(f"{image}: unhealthy")
        elif any("(health: starting)" in c["status"] for c in running):
            waiting.append(f"{image}: health starting")

    by_id = {c["id"]: c for c in data["checks"]}
    for cid in required:
        check = by_id.get(cid)
        if check is None:
            failing.append(f"check {cid}: not reported by the hub")
        elif check["level"] == "pending":
            waiting.append(f"{check['label']}: {check['detail']}")
        elif check["level"] == "fail":
            failing.append(f"{check['label']}: {check['detail']}")

    if waiting:
        return "wait", waiting + failing
    return ("fail" if failing else "ok"), failing


def summary(data: dict, images: list[str], required: list[str], verdict: str) -> str:
    rows = ["| check | level | detail |", "|---|---|---|"]
    for c in data["checks"]:
        if c["id"] in required or c["id"] == "containers":
            rows.append(f"| {c['label']} | {c['level']} | {c['detail']} |")
    running = {c["image"] for c in data["containers"] if c["state"] == "running"}
    img = "\n".join(f"- {'ok' if i in running else 'MISSING'} `{i}`" for i in images)
    return f"### Deploy verification: {verdict}\n\n{img}\n\n" + "\n".join(rows) + "\n"


def main() -> int:
    compose = sys.argv[1]
    required = [c for c in (sys.argv[2] if len(sys.argv) > 2 else "").split(",") if c]
    url = os.environ.get("HUB_CHECKS_URL", "")
    token = os.environ.get("HUB_CHECKS_TOKEN", "")
    cf_id = os.environ.get("CF_ACCESS_CLIENT_ID", "")
    cf_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET", "")
    if not all([url, token, cf_id, cf_secret]):
        print("::notice::deploy verification skipped: HUB_CHECKS_URL, HUB_CHECKS_TOKEN or the Access service token is not set")
        return 0

    headers = {
        "authorization": f"Bearer {token}",
        "cf-access-client-id": cf_id,
        "cf-access-client-secret": cf_secret,
        "accept": "application/json",
    }
    images = pinned_images(compose)
    print(f"expecting {len(images)} pinned images from {compose}; checks: {', '.join(required) or 'containers only'}")

    data, verdict, reasons = None, "wait", ["no answer from the hub yet"]
    for attempt in range(1, ATTEMPTS + 1):
        try:
            data = fetch(url, headers)
            verdict, reasons = judge(data, images, required)
        except (urllib.error.URLError, RuntimeError, KeyError, TimeoutError) as err:
            # The hub restarts when the hub itself is what was deployed.
            verdict, reasons = "wait", [f"hub: {err}"]
        if verdict != "wait":
            break
        print(f"[{attempt}/{ATTEMPTS}] waiting: " + "; ".join(reasons))
        time.sleep(INTERVAL)

    if data is not None and os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary(data, images, required, verdict))

    if verdict == "ok":
        print("deploy verified")
        return 0
    for r in reasons:
        print(f"::error::{r}")
    if verdict == "wait":
        print(f"::error::still not settled after {ATTEMPTS * INTERVAL} s")
    return 1


if __name__ == "__main__":
    sys.exit(main())
