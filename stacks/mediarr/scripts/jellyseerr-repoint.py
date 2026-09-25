#!/usr/bin/env python3
"""Repoint Jellyseerr at a Jellyfin server.

Jellyseerr decides whether a request is Available by asking one Jellyfin
whether the file exists. Point it at the wrong one and everything downstream
looks broken: requests sit at Requested forever even for films already in the
library. It has been pointed at the wrong server twice now -- first the Mac's,
then the mini PC's -- so the target is an argument rather than a constant.

Both the settings file and the account row in db.sqlite3 have to move: a
Jellyseerr user is keyed by the Jellyfin user id it was created from, and those
ids differ between servers. Without the second half, logging in would mint a
second account and the existing requests would lose their owner.

Usage: python3 jellyseerr-repoint.py <jellyfin-api-key> [jellyfin-url]

The URL defaults to the NAS, which is the only Jellyfin now -- it is the one
cinema.davideghiotto.it serves, and the only box the library is copied to. It
is reachable from the mini PC over Tailscale and nowhere else: the NAS is not
on the home LAN despite advertising a 192.168.15.x address.

Key comes from that server's Dashboard -> API Keys -> +.
"""
import json, sqlite3, subprocess, sys, time, urllib.parse, urllib.request

JF = "http://${NAS_TAILNET_IP}:8899"
CFG = "/app/config/settings.json"
DB = "/app/config/db/db.sqlite3"

def jf(path, key):
    # `Authorization`, not `X-Emby-Token`: Jellyfin 12 dropped the Emby-era
    # header names and answers 401 to them. 10.x accepts this one too, so it is
    # the form that works against either server.
    req = urllib.request.Request(
        JF + path, headers={"Authorization": 'MediaBrowser Token="%s"' % key})
    return json.load(urllib.request.urlopen(req, timeout=30))

def dexec(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw).stdout

def wait_healthy(container, timeout=120):
    """Jellyseerr restarts on its own often enough that a `docker exec` fired
    blind will sometimes land in the gap and fail with a bare exit 1."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        out = subprocess.run(["docker", "inspect", "-f",
                              "{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                              container], capture_output=True, text=True)
        running, _, health = out.stdout.strip().partition(" ")
        if running == "true" and health in ("healthy", "none"):
            return
        time.sleep(3)
    sys.exit("%s never became healthy" % container)

def main():
    global JF
    if not 2 <= len(sys.argv) <= 3:
        sys.exit(__doc__)
    key = sys.argv[1].strip()
    if len(sys.argv) == 3:
        JF = sys.argv[2].strip().rstrip("/")

    info = jf("/System/Info", key)
    print("jellyfin:", info["ServerName"], info["Version"], info["Id"])

    users = jf("/Users", key)
    admin = next(u for u in users if u["Policy"]["IsAdministrator"])
    views = jf("/Users/%s/Views" % admin["Id"], key)["Items"]
    libs = [{"id": v["Id"], "name": v["Name"], "enabled": True,
             "type": "movie" if v["CollectionType"] == "movies" else "show"}
            for v in views if v.get("CollectionType") in ("movies", "tvshows")]
    print("libraries:", [(l["name"], l["type"]) for l in libs])

    wait_healthy("jellyseerr")
    cfg = json.loads(dexec("docker", "exec", "jellyseerr", "cat", CFG))
    # `ip: jellyfin` worked only while Jellyfin was a container on the same
    # compose network. The NAS is a different machine, so the address Jellyseerr
    # dials has to come out of the URL it was given.
    url = urllib.parse.urlsplit(JF)
    cfg["jellyfin"].update({
        "name": info["ServerName"], "ip": url.hostname,
        "port": url.port or (443 if url.scheme == "https" else 80),
        "useSsl": url.scheme == "https",
        "urlBase": url.path.rstrip("/"), "externalHostname": JF,
        "serverId": info["Id"], "apiKey": key, "libraries": libs,
    })
    open("/tmp/js-settings.json", "w").write(json.dumps(cfg, indent=2))

    # Stop first: SQLite keeps recent writes in the -wal sidecar, so a copy
    # taken while Jellyseerr is running can be missing the newest rows.
    dexec("docker", "stop", "jellyseerr")
    dexec("docker", "cp", "jellyseerr:" + DB, "/tmp/js-db.sqlite3")
    con = sqlite3.connect("/tmp/js-db.sqlite3")
    for row_id, name in con.execute("select id, jellyfinUsername from user"):
        match = next((u for u in users if u["Name"].lower() == (name or "").lower()), None)
        if not match:
            print("no Jellyfin user named %r on the new server; leaving row %d alone" % (name, row_id))
            continue
        con.execute("update user set jellyfinUserId = ?, jellyfinDeviceId = ? where id = ?",
                    (match["Id"], match["Id"], row_id))
        print("relinked %s -> %s" % (name, match["Id"]))
    con.commit()
    con.close()

    dexec("docker", "cp", "/tmp/js-settings.json", "jellyseerr:" + CFG)
    dexec("docker", "cp", "/tmp/js-db.sqlite3", "jellyseerr:" + DB)
    dexec("docker", "start", "jellyseerr")
    print("done - jellyseerr restarted")

main()
