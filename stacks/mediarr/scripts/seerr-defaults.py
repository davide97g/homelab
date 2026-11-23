#!/usr/bin/env python3
"""Make every Seerr request default to HD, preferring Italian audio.

Creates (or updates) a quality profile called "HD ITA" in Radarr and Sonarr and
makes it the profile Seerr uses for new requests. Seerr itself is also switched
to Italian (UI language, Discover and streaming region).

How the profile decides:
  - Only 720p and 1080p are allowed (no SD, CAM, Remux or 4K). They sit in one
    quality group, so neither beats the other on quality alone.
  - Custom format "Italian" (+1000) then decides first: an Italian release wins
    over any non-Italian one. "1080p" (+50) breaks the tie between two Italian
    releases, or between two non-Italian ones.
  - Italian is preferred, not required: anime from Nyaa is rarely Italian, and a
    title with no Italian release still downloads. Upgrades stay on until the
    file is Italian 1080p, so an English grab is replaced when an Italian one
    turns up.
  - Radarr's profile language is "Any". "Original" (Radarr's default) rejects
    an ITA-only release of an English-language film outright.

Existing movies and series keep their profile; only new requests change.
Idempotent: run it again and it converges to the same state.

Usage: python3 seerr-defaults.py
"""
import json, subprocess, sys, urllib.request

PROFILE = "HD ITA"
GROUP_ID = 1100  # any id not used by the stock groups (1000-1003)
ITALIAN, ITALIAN_SCORE = 5, 1000
P1080, P1080_SCORE = 1080, 50
HD = {  # quality names that go into the single HD group
    "HDTV-720p", "WEBDL-720p", "WEBRip-720p", "Bluray-720p",
    "HDTV-1080p", "WEBDL-1080p", "WEBRip-1080p", "Bluray-1080p",
}
SEERR_MAIN = {"locale": "it", "discoverRegion": "IT", "streamingRegion": "IT"}


def call(base, key, path, body=None, method="GET", header="X-Api-Key"):
    req = urllib.request.Request(
        base + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={header: key, "Content-Type": "application/json"},
        method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def arr_key(container):
    out = subprocess.run(
        ["docker", "exec", container, "sh", "-c",
         "grep -o '<ApiKey>[^<]*' /config/config.xml | cut -d'>' -f2"],
        capture_output=True, text=True, check=True).stdout.strip()
    if not out:
        sys.exit(f"no API key in {container}")
    return out


def custom_format(api, name, impl, value):
    schema = next(s for s in api("/customformat/schema") if s["implementation"] == impl)
    spec = dict(schema, name=name, required=True, negate=False,
                fields=[dict(f, value=value) if f["name"] == "value" else f
                        for f in schema["fields"]])
    body = {"name": name, "includeCustomFormatWhenRenaming": False, "specifications": [spec]}
    have = next((c for c in api("/customformat") if c["name"] == name), None)
    if have:
        body["id"] = have["id"]
        return api(f"/customformat/{have['id']}", body, "PUT")
    return api("/customformat", body, "POST")


def flatten(items):
    for i in items:
        if i.get("items"):
            yield from i["items"]
        else:
            yield i


def profile(api, radarr, formats):
    # Any stock profile works as a template: it lists every quality the app knows.
    template = api("/qualityprofile")[0]
    singles = [dict(i, allowed=False) for i in flatten(template["items"])]
    hd = [dict(i, allowed=True) for i in singles if i["quality"]["name"] in HD]
    missing = HD - {i["quality"]["name"] for i in hd}
    if missing:
        sys.exit(f"qualities not found: {sorted(missing)}")
    rest = [i for i in singles if i["quality"]["name"] not in HD]
    # Order is rank, lowest first. Put the HD group where 720p used to start.
    first_hd = next(n for n, i in enumerate(singles) if i["quality"]["name"] in HD)
    before = [i for i in rest if singles.index(i) < first_hd]
    after = [i for i in rest if singles.index(i) > first_hd]
    group = {"id": GROUP_ID, "name": "HD", "allowed": True, "items": hd}

    scores = {f["id"]: s for f, s in formats}
    body = {
        "name": PROFILE,
        "upgradeAllowed": True,
        "cutoff": GROUP_ID,
        "items": before + [group] + after,
        "minFormatScore": 0,
        "cutoffFormatScore": ITALIAN_SCORE + P1080_SCORE,
        "minUpgradeFormatScore": 1,
        "formatItems": [{"format": c["id"], "name": c["name"], "score": scores.get(c["id"], 0)}
                        for c in api("/customformat")],
    }
    if radarr:
        body["language"] = {"id": -1, "name": "Any"}
    have = next((p for p in api("/qualityprofile") if p["name"] == PROFILE), None)
    if have:
        body["id"] = have["id"]
        return api(f"/qualityprofile/{have['id']}", body, "PUT")
    return api("/qualityprofile", body, "POST")


def main():
    if len(sys.argv) != 1:
        sys.exit(__doc__)

    ids = {}
    for app, port in (("radarr", 7878), ("sonarr", 8989)):
        key = arr_key(app)
        api = lambda p, b=None, m="GET", _k=key, _p=port: call(
            f"http://localhost:{_p}/api/v3", _k, p, b, m)
        ita = custom_format(api, "Italian", "LanguageSpecification", ITALIAN)
        hd = custom_format(api, "1080p", "ResolutionSpecification", P1080)
        p = profile(api, app == "radarr", [(ita, ITALIAN_SCORE), (hd, P1080_SCORE)])
        ids[app] = p["id"]
        print(f"{app}: profile {PROFILE!r} id {p['id']}, "
              f"Italian +{ITALIAN_SCORE}, 1080p +{P1080_SCORE}")

    raw = subprocess.run(["docker", "exec", "jellyseerr", "cat", "/app/config/settings.json"],
                         capture_output=True, text=True, check=True).stdout
    settings = json.loads(raw)
    seerr = lambda p, b=None, m="GET": call(
        "http://localhost:5055/api/v1", settings["main"]["apiKey"], p, b, m)

    for app in ("radarr", "sonarr"):
        for server in settings[app]:
            body = {k: v for k, v in server.items() if k != "id"}  # id is read-only
            body.update(activeProfileId=ids[app], activeProfileName=PROFILE)
            seerr(f"/settings/{app}/{server['id']}", body, "PUT")
            print(f"seerr: {app} server {server['name']!r} -> {PROFILE}")

    seerr("/settings/main", SEERR_MAIN, "POST")
    print(f"seerr: {SEERR_MAIN}")


if __name__ == "__main__":
    main()
