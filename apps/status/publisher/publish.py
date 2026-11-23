#!/usr/bin/env python3
"""Snapshot the blackbox-public probes and send them to status.davideghiotto.it.

Runs on the mini PC every five minutes (status-publish.timer). Reads Prometheus
through `docker exec` -- its port is not published -- and POSTs one JSON
document to the status Worker, which keeps it in KV. Stdlib only.

Config: ~/.config/homelab/status.env with STATUS_URL and STATUS_INGEST_TOKEN.
"""

import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request

DAYS = 90
JOB = 'job="blackbox-public"'
ENV = pathlib.Path.home() / ".config/homelab/status.env"


def load_env():
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def prom(path, **params):
    url = "http://localhost:9090/api/v1/" + path + "?" + urllib.parse.urlencode(params)
    out = subprocess.run(["docker", "exec", "homelab-prometheus", "wget", "-qO-", url],
                         check=True, capture_output=True, timeout=60).stdout
    data = json.loads(out)
    if data.get("status") != "success":
        raise RuntimeError(f"prometheus: {data}")
    return data["data"]["result"]


def by_instance(result):
    return {r["metric"]["instance"]: r for r in result}


def main():
    load_env()
    now = time.time()
    today = dt.date.today()
    midnight = dt.datetime.combine(today, dt.time()).timestamp()

    # Which services exist, and their labels, come from the scrape config.
    current = by_instance(prom("query", query=f"avg_over_time(probe_success{{{JOB}}}[5m])"))
    latency = by_instance(prom("query", query=f"avg_over_time(probe_duration_seconds{{{JOB}}}[5m])"))
    overall = by_instance(prom("query", query=f"avg_over_time(probe_success{{{JOB}}}[{DAYS}d])"))

    # Completed days: evaluated at each midnight, over the day before it.
    first = midnight - (DAYS - 1) * 86400
    past = by_instance(prom("query_range", query=f"avg_over_time(probe_success{{{JOB}}}[1d])",
                            start=first + 86400, end=midnight, step="86400"))
    # Today so far.
    since = max(60, int(now - midnight))
    today_r = by_instance(prom("query", query=f"avg_over_time(probe_success{{{JOB}}}[{since}s])"))

    services = []
    for inst, r in sorted(current.items(), key=lambda kv: kv[1]["metric"].get("service", "")):
        m = r["metric"]
        ok = float(r["value"][1])
        status = "up" if ok >= 1 else "down" if ok <= 0 else "degraded"
        values = {round(float(t)): float(v) for t, v in past.get(inst, {}).get("values", [])}
        days = []
        for i in range(DAYS):
            day = today - dt.timedelta(days=DAYS - 1 - i)
            if day == today:
                u = float(today_r[inst]["value"][1]) if inst in today_r else None
            else:
                end = round(dt.datetime.combine(day + dt.timedelta(days=1), dt.time()).timestamp())
                # query_range steps are UTC-regular; a DST change moves midnight by an hour.
                u = values.get(end, values.get(end - 3600, values.get(end + 3600)))
            days.append({"date": day.isoformat(), "uptime": None if u is None else round(u, 5)})
        services.append({
            "name": m.get("service", inst),
            "group": m.get("group", "Altro"),
            "url": inst,
            "status": status,
            "latency_ms": round(float(latency[inst]["value"][1]) * 1000) if inst in latency else None,
            "uptime": round(float(overall[inst]["value"][1]), 5) if inst in overall else None,
            "days": days,
        })

    if not services:
        print("no blackbox-public series; not publishing an empty page", file=sys.stderr)
        return 1

    body = json.dumps({"generated_at": int(now), "services": services}, separators=(",", ":")).encode()
    req = urllib.request.Request(
        os.environ["STATUS_URL"].rstrip("/") + "/api/ingest", data=body, method="POST",
        headers={"Authorization": "Bearer " + os.environ["STATUS_INGEST_TOKEN"],
                 "Content-Type": "application/json", "User-Agent": "homelab-status-publisher"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()
    down = [s["name"] for s in services if s["status"] != "up"]
    print(f"published {len(services)} services, {len(body)} bytes" + (f"; not up: {', '.join(down)}" if down else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
