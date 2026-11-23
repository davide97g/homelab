#!/usr/bin/env python3
"""Free the mini PC once a library file is md5-verified on the NAS.

    nas-sync-cleanup.py <rel>     e.g. movies/Hoppers (2026)/Hoppers.mkv

First unmonitors whatever owns the file -- the movie in Radarr, the episode(s) in
Sonarr -- then deletes the file and any folders it leaves empty. The order
matters: a monitored movie whose file vanishes is "missing", and Radarr would
grab it again on the next RSS sync (autoUnmonitorPreviouslyDownloadedMovies is
off). If the *arr cannot be reached the file stays, and the script exits 1 so
nas-sync retries it on the next run.

Files no *arr knows about (subtitles, nfo, artwork) are just deleted.
Matching is by path, never by hasFile: Radarr keeps hasFile true until a rescan.
"""
import json
import os
import subprocess
import sys
import urllib.request

LIB = os.environ.get("LIB", "/home/davide/media/library")
# The *arrs see the host's ~/media as /data.
CONTAINER_LIB = os.environ.get("CONTAINER_LIB", "/data/library")
RADARR = os.environ.get("RADARR_URL", "http://localhost:7878")
SONARR = os.environ.get("SONARR_URL", "http://localhost:8989")


def api_key(container):
    out = subprocess.run(
        ["docker", "exec", container, "cat", "/config/config.xml"],
        capture_output=True, text=True, check=True, timeout=30,
    ).stdout
    return out.split("<ApiKey>", 1)[1].split("</ApiKey>", 1)[0]


def api(base, key, path, method="GET", body=None):
    req = urllib.request.Request(
        base + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"X-Api-Key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        return json.loads(data) if data else None


def unmonitor_movie(path):
    key = api_key("radarr")
    for m in api(RADARR, key, "/api/v3/movie"):
        mf = m.get("movieFile") or {}
        if mf.get("path") == path:
            if m["monitored"]:
                api(RADARR, key, "/api/v3/movie/editor", "PUT",
                    {"movieIds": [m["id"]], "monitored": False})
            return f"radarr: unmonitored {m['title']} ({m['year']})"
    return "radarr: no movie owns it"


def unmonitor_episodes(path):
    key = api_key("sonarr")
    for s in api(SONARR, key, "/api/v3/series"):
        if not path.startswith(s["path"].rstrip("/") + "/"):
            continue
        files = [f["id"] for f in api(SONARR, key, f"/api/v3/episodefile?seriesId={s['id']}")
                 if f["path"] == path]
        if not files:
            return f"sonarr: no episode of {s['title']} owns it"
        eps = [e for e in api(SONARR, key, f"/api/v3/episode?seriesId={s['id']}")
               if e.get("episodeFileId") in files]
        ids = [e["id"] for e in eps if e["monitored"]]
        if ids:
            api(SONARR, key, "/api/v3/episode/monitor", "PUT",
                {"episodeIds": ids, "monitored": False})
        names = ", ".join(f"S{e['seasonNumber']:02}E{e['episodeNumber']:02}" for e in eps)
        return f"sonarr: unmonitored {s['title']} {names}"
    return "sonarr: no series owns it"


def main():
    rel = sys.argv[1]
    local = os.path.join(LIB, rel)
    if not os.path.isfile(local):
        print("already gone")
        return 0
    path = f"{CONTAINER_LIB}/{rel}"
    try:
        note = unmonitor_movie(path) if rel.startswith("movies/") else unmonitor_episodes(path)
    except Exception as e:  # *arr down, docker missing, ...: keep the file
        print(f"kept, could not unmonitor: {e}")
        return 1
    os.remove(local)
    # Remove folders left empty, up to (not including) movies/ or tv/.
    top = os.path.join(LIB, rel.split("/", 1)[0])
    d = os.path.dirname(local)
    while d != top and d.startswith(top + "/"):
        try:
            os.rmdir(d)
        except OSError:
            break
        d = os.path.dirname(d)
    print(f"deleted locally; {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
