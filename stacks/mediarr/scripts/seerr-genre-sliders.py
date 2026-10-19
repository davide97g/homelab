#!/usr/bin/env python3
"""Add one Discover row per category (Adventure, Anime, Drama, ...) to Seerr.

Seerr has no filter bar on its home page; categories are sliders. The built-in
"Movie Genres" and "Series Genres" tile rows link to every TMDB genre, and the
rows added here put the common ones on the page directly. Anime is not a TMDB
genre, so its rows use TMDB keyword 210024 ("anime"), the one Seerr itself uses
to spot anime.

Each movie row goes right after the "Movie Genres" tiles and each series row
right after "Series Genres", in the order below. Idempotent: a row that already
exists (same type and data) is enabled and moved, never duplicated.

Usage: python3 seerr-genre-sliders.py
"""
import json, subprocess, sys, urllib.request

CFG = "/app/config/settings.json"
# server/constants/discover.ts
MOVIE_GENRES, TV_GENRES = 6, 10
MOVIE_KEYWORD, MOVIE_GENRE, TV_KEYWORD, TV_GENRE = 13, 14, 15, 16
ANIME = "210024"

MOVIE_ROWS = [
    ("Adventure Movies", MOVIE_GENRE, "12"),
    ("Action Movies", MOVIE_GENRE, "28"),
    ("Anime Movies", MOVIE_KEYWORD, ANIME),
    ("Comedy Movies", MOVIE_GENRE, "35"),
    ("Drama Movies", MOVIE_GENRE, "18"),
    ("Sci-Fi Movies", MOVIE_GENRE, "878"),
    ("Thriller Movies", MOVIE_GENRE, "53"),
    ("Horror Movies", MOVIE_GENRE, "27"),
]
TV_ROWS = [
    ("Anime Series", TV_KEYWORD, ANIME),
    ("Action & Adventure Series", TV_GENRE, "10759"),
    ("Drama Series", TV_GENRE, "18"),
    ("Comedy Series", TV_GENRE, "35"),
    ("Sci-Fi & Fantasy Series", TV_GENRE, "10765"),
    ("Crime Series", TV_GENRE, "80"),
]

def js(path, key, body=None, method="GET"):
    req = urllib.request.Request(
        "http://localhost:5055/api/v1" + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"X-Api-Key": key, "Content-Type": "application/json"},
        method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def main():
    if len(sys.argv) != 1:
        sys.exit(__doc__)
    raw = subprocess.run(["docker", "exec", "jellyseerr", "cat", CFG],
                         capture_output=True, text=True, check=True).stdout
    key = json.loads(raw)["main"]["apiKey"]

    def find(sliders, type_, data):
        return next((s for s in sliders if s["type"] == type_ and s.get("data") == data), None)

    sliders = js("/settings/discover", key)
    for title, type_, data in MOVIE_ROWS + TV_ROWS:
        if not find(sliders, type_, data):
            js("/settings/discover/add", key, {"title": title, "type": type_, "data": data}, "POST")
            print("added:", title)
    sliders = sorted(js("/settings/discover", key), key=lambda s: s["order"])

    ours = {(t, d) for _, t, d in MOVIE_ROWS + TV_ROWS}
    rows = {(t, d): find(sliders, t, d) for t, d in ours}
    ordered = []
    for s in sliders:
        if (s["type"], s.get("data")) in ours:
            continue
        ordered.append(s)
        if s["type"] == MOVIE_GENRES:
            ordered += [rows[(t, d)] for _, t, d in MOVIE_ROWS]
        elif s["type"] == TV_GENRES:
            ordered += [rows[(t, d)] for _, t, d in TV_ROWS]
    if len(ordered) != len(sliders):
        sys.exit("built-in genre tiles missing; reset Discover in Settings first")
    for s in ordered:
        if s["type"] in (MOVIE_GENRES, TV_GENRES) or (s["type"], s.get("data")) in ours:
            s["enabled"] = True

    js("/settings/discover", key, ordered, "POST")
    for s in ordered:
        print("%-3s %s" % ("on" if s["enabled"] else "off", s.get("title") or "built-in #%d" % s["type"]))

main()
