#!/usr/bin/env python3
"""Where every requested title stands between the download and the NAS, as one JSON on the NAS.

Runs forever on the mini PC (nas-pipeline.service). Every few seconds it reads

  - Radarr's and Sonarr's download queues (size left, ETA, import state),
  - nas-sync's control/ files (the queue, the file being copied, what arrived),

maps each file to its film or series by folder, estimates when each one will be
on the NAS, and writes the result to the NAS over ssh (NAS_STATUS_PATH). accounts
on the NAS mounts that folder read-only: cinema's Discover shows the progress from
it, and accounts refreshes Jellyfin when a file shows up under "arrived".

The NAS cannot reach the mini PC (Tailscale ports are firewalled that way), so the
mini PC pushes. Nothing here changes anything: it only reads and reports.

Output, version 1:
  {
    "v": 1, "at": ISO,
    "sync": {"enabled": bool, "note": str, "rateBps": int, "measured": bool},
    "titles": {
      "movie:<tmdbId>" | "tv:<tmdbId>": {
        "title": str,
        "stage": "queued" | "downloading" | "stalled" | "importing" | "settling"
                 | "waiting" | "sending" | "verifying" | "arrived",
        "message": str | null,
        "download": {"size", "left", "eta", "state"} | null,
        "transfer": {"bytes", "total", "startsAt", "eta", "paused"} | null,
        "eta": ISO | null,       # when it should be watchable on the NAS
        "files": int, "filesArrived": int, "arrivedAt": ISO | null
      }
    },
    "arrived": [{"key", "path", "at"}]   # NAS paths under the media root, last hour
  }
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

HOME_DIR = os.environ.get("NAS_SYNC_HOME", os.path.expanduser("~/ops/xfer-nas"))
CTL = os.path.join(HOME_DIR, "control")
LIB = os.environ.get("LIB", "/home/davide/media/library")
RADARR = os.environ.get("RADARR_URL", "http://localhost:7878")
SONARR = os.environ.get("SONARR_URL", "http://localhost:8989")
NAS_SSH = os.environ.get("NAS_SSH", "nas")
NAS_STATUS_PATH = os.environ.get("NAS_STATUS_PATH", "/volume1/docker/accounts/pipeline/status.json")
# nas-sync leaves a file alone until it has been still this long (QUIET_MIN there).
QUIET_S = int(os.environ.get("QUIET_MIN", "5")) * 60
# nas-sync runs every 2 minutes, so a ready file waits up to that long to start.
TICK_S = 120
# Both ends hash the file after the copy; the NAS is the slower one.
MD5_BPS = float(os.environ.get("MD5_BPS", 150e6))
# Copy speed before the first measurement (~23 MB/s seen over Tailscale).
DEFAULT_BPS = float(os.environ.get("DEFAULT_BPS", 20e6))
ARRIVED_WINDOW = timedelta(hours=1)
RATE_FILE = os.path.join(HOME_DIR, ".nas-pipeline-rate")
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
       "-o", "ControlMaster=auto", "-o", f"ControlPath={HOME_DIR}/.ssh-nas-pipeline",
       "-o", "ControlPersist=10m", NAS_SSH]


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if dt else None


def parse_time(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def log(msg):
    print(f"{iso(now())} {msg}", flush=True)


# --- *arr ---------------------------------------------------------------------

_keys = {}


def api_key(container):
    if container not in _keys:
        out = subprocess.run(["docker", "exec", container, "cat", "/config/config.xml"],
                             capture_output=True, text=True, check=True, timeout=30).stdout
        _keys[container] = out.split("<ApiKey>", 1)[1].split("</ApiKey>", 1)[0]
    return _keys[container]


def api(base, container, path):
    req = urllib.request.Request(base + path, headers={"X-Api-Key": api_key(container)})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            _keys.pop(container, None)  # rotated: read it again next time
        raise


_owners = {"at": 0.0, "movies": {}, "series": {}}


def owners():
    """Library folder name -> (key, title), for films and series. Cached for two minutes."""
    if time.time() - _owners["at"] > 120:
        movies, series = {}, {}
        for m in api(RADARR, "radarr", "/api/v3/movie"):
            if m.get("tmdbId") and m.get("path"):
                movies[os.path.basename(m["path"].rstrip("/"))] = (f"movie:{m['tmdbId']}", m["title"])
        for s in api(SONARR, "sonarr", "/api/v3/series"):
            if s.get("tmdbId") and s.get("path"):
                series[os.path.basename(s["path"].rstrip("/"))] = (f"tv:{s['tmdbId']}", s["title"])
        _owners.update(at=time.time(), movies=movies, series=series)
    return _owners


def owner_of(rel):
    parts = rel.split("/")
    if len(parts) < 3:
        return None
    table = owners()["movies" if parts[0] == "movies" else "series"]
    return table.get(parts[1])


def queue_state(r):
    """One word for where a download is: what the UI calls its stage."""
    tracked = r.get("trackedDownloadState") or ""
    if tracked in ("importPending", "importing"):
        return "stalled" if r.get("trackedDownloadStatus") in ("warning", "error") else "importing"
    if r.get("trackedDownloadStatus") in ("warning", "error") or r.get("status") in ("warning", "failed"):
        return "stalled"
    if r.get("status") in ("queued", "paused", "delay", "downloadClientUnavailable"):
        return "queued"
    return "downloading"


def queue_message(r):
    msgs = [m for s in r.get("statusMessages") or [] for m in s.get("messages") or []]
    return (r.get("errorMessage") or (msgs[0] if msgs else None) or None)


def downloads():
    """key -> list of queue records, both *arrs."""
    out = {}
    rad = api(RADARR, "radarr", "/api/v3/queue?pageSize=500&includeMovie=true")
    for r in rad.get("records", []):
        m = r.get("movie") or {}
        if m.get("tmdbId"):
            out.setdefault(f"movie:{m['tmdbId']}", {"title": m.get("title"), "records": []})["records"].append(r)
    son = api(SONARR, "sonarr", "/api/v3/queue?pageSize=1000&includeSeries=true")
    for r in son.get("records", []):
        s = r.get("series") or {}
        if s.get("tmdbId"):
            out.setdefault(f"tv:{s['tmdbId']}", {"title": s.get("title"), "records": []})["records"].append(r)
    return out


# --- nas-sync -----------------------------------------------------------------

def read_tsv(name):
    try:
        with open(os.path.join(CTL, name), encoding="utf-8") as f:
            return [line.rstrip("\n").split("\t") for line in f if line.strip()]
    except FileNotFoundError:
        return []


def sync_enabled():
    try:
        with open(os.path.join(CTL, "enabled")) as f:
            return f.read().strip() == "on"
    except FileNotFoundError:
        return False


def last_change(rel):
    """When the file last changed: nas-sync waits QUIET_MIN after that."""
    try:
        return os.stat(os.path.join(LIB, rel)).st_mtime
    except FileNotFoundError:
        return None


def nas_path(rel):
    top, rest = rel.split("/", 1)
    return f"{'Movies' if top == 'movies' else top}/{rest}"


class Rate:
    """Bytes per second of the copy to the NAS, smoothed, kept across restarts."""

    def __init__(self):
        self.bps, self.measured, self.sample = DEFAULT_BPS, False, None
        try:
            with open(RATE_FILE) as f:
                self.bps, self.measured = float(f.read().strip()), True
        except (FileNotFoundError, ValueError):
            pass

    def observe(self, rel, phase, have):
        t = time.time()
        prev, self.sample = self.sample, (rel, phase, have, t)
        if not prev or prev[0] != rel or phase != "send" or prev[1] != "send":
            return
        dt, db = t - prev[3], have - prev[2]
        if dt < 5 or db <= 0:
            return
        bps = db / dt
        self.bps = bps if not self.measured else 0.7 * self.bps + 0.3 * bps
        self.measured = True
        try:
            with open(RATE_FILE, "w") as f:
                f.write(str(int(self.bps)))
        except OSError:
            pass


# --- the picture ----------------------------------------------------------------

STAGE_ORDER = ["stalled", "queued", "downloading", "importing", "settling", "waiting", "sending", "verifying", "arrived"]


def build(rate):
    t_now = now()
    enabled = sync_enabled()
    titles = {}

    def title(key, name):
        t = titles.setdefault(key, {"title": name, "stages": [], "message": None, "download": None,
                                    "transfer": None, "eta": None, "files": 0, "filesArrived": 0,
                                    "arrivedAt": None})
        if name and not t["title"]:
            t["title"] = name
        return t

    # Downloads, summed per title.
    for key, d in downloads().items():
        t = title(key, d["title"])
        size = sum(r.get("size") or 0 for r in d["records"])
        left = sum(r.get("sizeleft") or 0 for r in d["records"])
        etas = [parse_time(r.get("estimatedCompletionTime")) for r in d["records"]]
        states = [queue_state(r) for r in d["records"]]
        known = [e for e in etas if e]
        t["download"] = {"size": size, "left": left, "eta": iso(max(known)) if known and "queued" not in states else None,
                         "state": min(states, key=STAGE_ORDER.index)}
        t["stages"].extend(states)
        t["message"] = next((queue_message(r) for r in d["records"] if queue_message(r)), None)

    # The copy to the NAS: what is being sent, what waits, in the order nas-sync takes them.
    current = read_tsv("current.tsv")
    cur = None
    if current and len(current[0]) >= 4:
        rel, phase, have, total = current[0][0], current[0][1], int(current[0][2] or 0), int(current[0][3] or 0)
        rate.observe(rel, phase, have)
        cur = (rel, phase, have, total)
    else:
        rate.sample = None

    bps = max(rate.bps, 1e6)
    t_free = t_now  # when nas-sync is free for the next file
    transfers = {}  # rel -> (stage, bytes, total, startsAt, eta)
    if cur:
        rel, phase, have, total = cur
        left = 0 if phase == "verify" else (total - have) / bps
        verify = total / MD5_BPS * (0.5 if phase == "verify" else 1)
        t_free = t_now + timedelta(seconds=left + verify)
        transfers[rel] = ("verifying" if phase == "verify" else "sending", have, total, None, t_free)

    waiting = [row for row in read_tsv("queue.tsv") if len(row) >= 3 and (not cur or row[1] != cur[0])]
    for size, rel, state in waiting:
        size = int(size or 0)
        changed = last_change(rel)
        ready_at = t_now if state == "ready" or not changed else datetime.fromtimestamp(changed + QUIET_S, timezone.utc)
        start = max(t_free, ready_at) + timedelta(seconds=TICK_S / 2)
        end = start + timedelta(seconds=size / bps + size / MD5_BPS)
        transfers[rel] = ("settling" if state == "settling" else "waiting", 0, size, start, end)
        t_free = end

    for rel, (stage, have, total, start, end) in transfers.items():
        o = owner_of(rel)
        if not o:
            continue
        t = title(*o)
        t["stages"].append(stage)
        t["files"] += 1
        tr = t["transfer"] or {"bytes": 0, "total": 0, "startsAt": None, "eta": None}
        tr["bytes"] += have
        tr["total"] += total
        if start and (not tr["startsAt"] or start < tr["startsAt"]):
            tr["startsAt"] = start
        if not tr["eta"] or end > tr["eta"]:
            tr["eta"] = end
        t["transfer"] = tr

    # What arrived on the NAS in the last hour (md5-verified).
    arrived = []
    for row in read_tsv("recent.tsv"):
        if len(row) < 3 or row[1] != "done":
            continue
        at = parse_time(row[0])
        if not at or t_now - at > ARRIVED_WINDOW:
            continue
        o = owner_of(row[2])
        arrived.append({"key": o[0] if o else None, "path": nas_path(row[2]), "at": iso(at)})
        if o:
            t = title(*o)
            t["files"] += 1
            t["filesArrived"] += 1
            t["arrivedAt"] = max(t["arrivedAt"] or "", iso(at))

    # A failure note for a file still waiting is the most useful message there is.
    failed = {row[2]: row[3] for row in read_tsv("recent.tsv") if len(row) >= 4 and row[1] in ("failed", "full")}
    for rel in transfers:
        if rel in failed and owner_of(rel):
            titles[owner_of(rel)[0]]["message"] = failed[rel]

    # One stage and one ETA per title: the least advanced part decides.
    out = {}
    for key, t in titles.items():
        stages = t.pop("stages")
        stage = min(stages, key=STAGE_ORDER.index) if stages else "arrived"
        tr = t["transfer"]
        if tr:
            tr["paused"] = not enabled
            eta = tr["eta"] if enabled else None
            tr["startsAt"], tr["eta"] = iso(tr["startsAt"]), iso(eta)
        d = t["download"]
        if d and stage in ("queued", "downloading", "importing"):
            # Still downloading: download, import, the quiet minutes, then the copy behind the queue.
            done_dl = parse_time(d["eta"]) if d["eta"] else (t_now if stage == "importing" else None)
            if done_dl and enabled:
                start = max(done_dl + timedelta(seconds=60 + QUIET_S + TICK_S / 2), t_free)
                t["eta"] = iso(start + timedelta(seconds=d["size"] / bps + d["size"] / MD5_BPS + 60))
        elif tr and tr["eta"]:
            # After the copy and the checksum, Jellyfin needs about a minute to list it.
            t["eta"] = iso(parse_time(tr["eta"]) + timedelta(seconds=60))
        t["stage"] = stage
        out[key] = t

    return {
        "v": 1,
        "at": iso(t_now),
        "sync": {"enabled": enabled, "note": (read_tsv("tick.tsv") or [["", ""]])[0][-1],
                 "rateBps": int(rate.bps), "measured": rate.measured},
        "titles": out,
        "arrived": arrived,
    }


def push(doc):
    data = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
    path = NAS_STATUS_PATH
    cmd = f"mkdir -p \"$(dirname '{path}')\" && cat > '{path}.tmp' && mv -f '{path}.tmp' '{path}'"
    subprocess.run(SSH + [cmd], input=data, check=True, timeout=30, capture_output=True)


def main():
    rate = Rate()
    last, last_push = None, 0.0
    while True:
        busy = False
        try:
            doc = build(rate)
            busy = any(t["stage"] != "arrived" for t in doc["titles"].values())
            body = {k: v for k, v in doc.items() if k != "at"}
            # Push on change, and at least every minute so the reader can tell it is alive.
            if body != last or time.time() - last_push > 60:
                push(doc)
                last, last_push = body, time.time()
        except Exception as e:  # an *arr restarting, the NAS asleep: try again next round
            log(f"error: {e!r}")
            busy = False
        time.sleep(10 if busy else 30)


if __name__ == "__main__":
    if sys.argv[1:] == ["--once"]:
        print(json.dumps(build(Rate()), indent=2, ensure_ascii=False))
    else:
        main()
