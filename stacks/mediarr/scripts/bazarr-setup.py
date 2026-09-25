#!/usr/bin/env python3
"""First-run Bazarr wiring: Radarr and Sonarr connections, the language profile,
and the provider list. Idempotent -- it writes the same settings every time.

Runs on the box (see scripts/on-box.sh), because Bazarr's API key lives inside
the container and the *arr keys live inside theirs.

    ./scripts/on-box.sh bazarr-setup.py

Not covered, because it needs a human: the OpenSubtitles.com username and
password, under Settings -> Providers. Note the .com -- an account on the old
opensubtitles.org will authenticate against nothing and throttle the provider
out for 12 hours.
"""
import json, re, subprocess, urllib.parse, urllib.request

# Bazarr 1.6 reads audio_only_include on every profile item in its indexer. An
# item written without it raises KeyError there, and because the scan dies the
# missing-subtitle list comes back empty -- so nothing is ever fetched and
# nothing looks wrong. All five keys are required.
def item(n, language):
    return {"id": n, "language": language, "audio_exclude": "False",
            "audio_only_include": "False", "hi": "False", "forced": "False"}

PROFILE = {
    "profileId": 1,
    "name": "Italiano + English",
    "items": [item(1, "it"), item(2, "en")],
    "cutoff": None, "mustContain": [], "mustNotContain": [],
    "originalFormat": False, "tag": None,
}

# subf2m is deliberately absent: it needs a browser user-agent configured and
# throttles itself out on the first search without one.
PROVIDERS = ["opensubtitlescom", "podnapisi", "yifysubtitles"]


def cat(container, path):
    return subprocess.run(["docker", "exec", container, "cat", path],
                          capture_output=True, text=True, check=True).stdout


def main():
    bz = re.search(r"^  apikey: (\S+)$", cat("bazarr", "/config/config/config.yaml"), re.M).group(1)
    rad = re.search(r"<ApiKey>(\w+)</ApiKey>", cat("radarr", "/config/config.xml")).group(1)
    son = re.search(r"<ApiKey>(\w+)</ApiKey>", cat("sonarr", "/config/config.xml")).group(1)

    data = [
        ("languages-profiles", json.dumps([PROFILE])),
        ("settings-general-use_radarr", "true"),
        ("settings-radarr-ip", "radarr"),
        ("settings-radarr-port", "7878"),
        ("settings-radarr-base_url", "/"),
        ("settings-radarr-ssl", "false"),
        ("settings-radarr-apikey", rad),
        ("settings-general-use_sonarr", "true"),
        ("settings-sonarr-ip", "sonarr"),
        ("settings-sonarr-port", "8989"),
        ("settings-sonarr-base_url", "/"),
        ("settings-sonarr-ssl", "false"),
        ("settings-sonarr-apikey", son),
        # Every new movie and series picks up the profile without being asked.
        ("settings-general-movie_default_enabled", "true"),
        ("settings-general-movie_default_profile", "1"),
        ("settings-general-serie_default_enabled", "true"),
        ("settings-general-serie_default_profile", "1"),
        ("settings-general-upgrade_subs", "true"),
        ("settings-general-enabled_providers", PROVIDERS),
    ]

    req = urllib.request.Request(
        "http://localhost:6767/api/system/settings",
        data=urllib.parse.urlencode(data, doseq=True).encode(),
        headers={"X-API-KEY": bz})
    with urllib.request.urlopen(req, timeout=120) as r:
        print("settings saved:", r.status)

    req = urllib.request.Request("http://localhost:6767/api/providers",
                                 headers={"X-API-KEY": bz})
    for p in json.load(urllib.request.urlopen(req, timeout=60))["data"]:
        print("  %-20s %s" % (p["name"], p["status"]))


main()
