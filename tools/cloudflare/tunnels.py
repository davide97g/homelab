#!/usr/bin/env python3
"""Cloudflare tunnel ingress as code: cloudflare/tunnels.json is the source of truth.

    tools/cloudflare/tunnels.py pull    # live -> cloudflare/tunnels.json
    tools/cloudflare/tunnels.py diff    # what apply would change (exit 1 if anything)
    tools/cloudflare/tunnels.py apply   # cloudflare/tunnels.json -> live, after a backup
    tools/cloudflare/tunnels.py audit   # DNS vs ingress: missing CNAMEs, orphan CNAMEs

Edit the JSON (add or drop an ingress rule, keep the catch-all last), run diff, then
apply. apply writes tunnel-backup-<date>-<tunnel>.json first (gitignored), PUTs the
config, and creates the proxied CNAME for any new davideghiotto.it hostname.

Credentials from the repo .env: CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID,
CF_TUNNEL_ID (the mini PC's tunnel) and NAS_TUNNEL_ID (the NAS's). Stdlib only.
"""

import datetime as dt
import json
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = ROOT / "cloudflare" / "tunnels.json"
ZONE_NAME = "davideghiotto.it"


def load_env():
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def api(method, path, body=None):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/" + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + os.environ["CF_API_TOKEN"],
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    if not data.get("success"):
        sys.exit(f"{method} {path}: {data.get('errors')}")
    return data["result"]


def tunnels():
    return {"mini-pc": os.environ["CF_TUNNEL_ID"], "nas": os.environ["NAS_TUNNEL_ID"]}


def live_config(tid):
    return api("GET", f"accounts/{os.environ['CF_ACCOUNT_ID']}/cfd_tunnel/{tid}/configurations")["config"]


def pull():
    spec = {name: live_config(tid) for name, tid in tunnels().items()}
    SPEC.parent.mkdir(exist_ok=True)
    SPEC.write_text(json.dumps(spec, indent=2) + "\n")
    print(f"wrote {SPEC.relative_to(ROOT)}: " + ", ".join(f"{n} {len(c['ingress'])} rules" for n, c in spec.items()))


def key(rule):
    return (rule.get("hostname"), rule.get("path"))


def changes(name, want, have):
    w = {key(r): r for r in want["ingress"]}
    h = {key(r): r for r in have["ingress"]}
    out = []
    for k in w.keys() - h.keys():
        out.append(f"  + {name}: {k[0] or '(catch-all)'}{' ' + k[1] if k[1] else ''} -> {w[k]['service']}")
    for k in h.keys() - w.keys():
        out.append(f"  - {name}: {k[0] or '(catch-all)'}{' ' + k[1] if k[1] else ''} -> {h[k]['service']}")
    for k in w.keys() & h.keys():
        if w[k] != h[k]:
            out.append(f"  ~ {name}: {k[0]}: {json.dumps(h[k], sort_keys=True)} -> {json.dumps(w[k], sort_keys=True)}")
    if [key(r) for r in want["ingress"]] != [key(r) for r in have["ingress"]] and not out:
        out.append(f"  ~ {name}: same rules, different order")
    rest_w = {k: v for k, v in want.items() if k != "ingress"}
    rest_h = {k: v for k, v in have.items() if k != "ingress"}
    if rest_w != rest_h:
        out.append(f"  ~ {name}: non-ingress settings differ")
    return out


def check(spec):
    for name, cfg in spec.items():
        last = cfg["ingress"][-1]
        if last.get("hostname") or last.get("path"):
            sys.exit(f"{name}: the last ingress rule must be the catch-all (no hostname, no path)")
        if any(not r.get("hostname") and not r.get("path") for r in cfg["ingress"][:-1]):
            sys.exit(f"{name}: a catch-all before the end would shadow every rule after it")


def diff():
    spec = json.loads(SPEC.read_text())
    check(spec)
    out = []
    for name, tid in tunnels().items():
        out += changes(name, spec[name], live_config(tid))
    print("\n".join(out) if out else "no changes")
    return 1 if out else 0


def dns_records():
    recs, page = [], 1
    while True:
        r = api("GET", f"zones/{os.environ['CF_ZONE_ID']}/dns_records?per_page=500&page={page}")
        recs += r
        if len(r) < 500:
            return recs
        page += 1


def apply():
    spec = json.loads(SPEC.read_text())
    check(spec)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    records = {r["name"]: r for r in dns_records()}
    for name, tid in tunnels().items():
        have = live_config(tid)
        if not changes(name, spec[name], have):
            print(f"{name}: unchanged")
            continue
        backup = ROOT / f"tunnel-backup-{stamp}-{name}.json"
        backup.write_text(json.dumps({"config": have}, indent=2))
        api("PUT", f"accounts/{os.environ['CF_ACCOUNT_ID']}/cfd_tunnel/{tid}/configurations", {"config": spec[name]})
        print(f"{name}: applied (previous config in {backup.name})")
        for r in spec[name]["ingress"]:
            h = r.get("hostname")
            if h and h.endswith("." + ZONE_NAME) and h not in records:
                api("POST", f"zones/{os.environ['CF_ZONE_ID']}/dns_records",
                    {"type": "CNAME", "name": h, "content": f"{tid}.cfargotunnel.com", "proxied": True})
                print(f"  dns: created CNAME {h}")
    return 0


def audit():
    spec = json.loads(SPEC.read_text())
    records = dns_records()
    problems = 0
    for name, tid in tunnels().items():
        target = f"{tid}.cfargotunnel.com"
        hosts = {r["hostname"] for r in spec[name]["ingress"] if r.get("hostname")}
        cnames = {r["name"] for r in records if r["type"] == "CNAME" and r["content"] == target}
        for h in sorted(h for h in hosts - cnames if h.endswith("." + ZONE_NAME)):
            print(f"{name}: ingress {h} has no CNAME to this tunnel"); problems += 1
        for h in sorted(cnames - hosts):
            print(f"{name}: CNAME {h} points here but no ingress rule serves it"); problems += 1
    print("audit clean" if not problems else f"{problems} problem(s)")
    return 1 if problems else 0


def main():
    load_env()
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    fn = {"pull": pull, "diff": diff, "apply": apply, "audit": audit}.get(cmd)
    if not fn:
        sys.exit(__doc__)
    return fn() or 0


if __name__ == "__main__":
    raise SystemExit(main())
