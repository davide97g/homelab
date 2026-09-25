"""Serve chapter scripts to Yomu, and search across them. Standard library only.

  GET /script/chapter/<kavita chapter id>   that chapter's script.json, or 404
  GET /script/search?q=<words>              lines whose text or speaker match
  GET /script/health                        index size, for the hub

A Kavita chapter can hold several files (two scanlations of the same chapter
number end up as one 107-page "Chapter 1"). Kavita reads them in file-id
order, one after the other, so a file's script is shifted by the pages of the
files before it, and a file with no script leaves its pages empty.

There is no auth here. Every request carries the reader's own Kavita JWT, and
this passes it to Kavita: `GET /api/series/chapter` answers the file path of a
chapter (and 401 for a bad token), and `series/all-v2` which series the reader
can see, which filters search. So Kavita stays the only gate.

The search index is SQLite FTS5, rebuilt from every script.json under SCRIPTS
whenever one changes (checked every INDEX_INTERVAL seconds). Mapping a file to
its Kavita chapter id takes the admin KAVITA_API_KEY, the same key `covers`
uses; without it, search is off and chapter scripts still work.
"""

import json
import os
import pathlib
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KAVITA = os.environ.get("KAVITA_URL", "http://kavita:5000").rstrip("/")
KAVITA_KEY = os.environ.get("KAVITA_API_KEY", "")
KAVITA_ROOT = os.environ.get("KAVITA_MANGA_ROOT", "/manga").rstrip("/")  # the library folder, as Kavita sees it
SCRIPTS = pathlib.Path(os.environ.get("SCRIPTS_DIR", "/scripts"))
DB = pathlib.Path(os.environ.get("INDEX_DB", "/tmp/scripts-index.db"))
INTERVAL = int(os.environ.get("INDEX_INTERVAL", "600"))
PORT = int(os.environ.get("PORT", "8080"))
LIMIT = 50


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


class KavitaError(Exception):
    def __init__(self, status: int):
        self.status = status


def kavita(path: str, *, token: str | None = None, body: dict | None = None):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = token
    else:
        headers["x-api-key"] = KAVITA_KEY
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{KAVITA}{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            text = res.read()
    except urllib.error.HTTPError as err:
        raise KavitaError(err.code) from None
    return json.loads(text) if text else None


def script_for(file_path: str) -> pathlib.Path | None:
    """/manga/<source>/<series>/<file>.cbz -> SCRIPTS/<source>/<series>/<file>/script.json"""
    if not file_path.startswith(KAVITA_ROOT + "/"):
        return None
    rel = pathlib.PurePosixPath(file_path[len(KAVITA_ROOT) + 1 :])
    if ".." in rel.parts:
        return None
    p = SCRIPTS / rel.parent / rel.stem / "script.json"
    return p if p.is_file() else None


# --- search index -------------------------------------------------------------

EVERY = {"statements": [], "combination": 1, "limitTo": 0}


def in_reading_order(files: list[dict]) -> list[tuple[dict, int]]:
    """A chapter's files in the order Kavita reads them, each with its first page."""
    out, offset = [], 0
    for f in sorted(files, key=lambda f: f.get("id", 0)):
        out.append((f, offset))
        offset += int(f.get("pages") or 0)
    return out


def chapter_script(files: list[dict]) -> dict | None:
    """One script for a whole Kavita chapter, from the scripts of its files."""
    merged = None
    for f, offset in in_reading_order(files):
        p = script_for(f["filePath"])
        if not p:
            continue
        s = json.loads(p.read_text())
        for page in s["pages"]:
            page["index"] += offset
        if merged is None:
            merged = {**s, "files": []}
        else:
            merged["pages"] += s["pages"]
            merged["cast"] += [c for c in s["cast"] if c not in merged["cast"]]
        merged["files"].append({"cbz": s["cbz"], "scanlator": s["scanlator"], "firstPage": offset})
    return merged


def chapter_ids() -> dict[str, tuple[int, int, int]]:
    """Kavita file path -> (series id, chapter id, first page), for every chapter in the library."""
    out = {}
    for s in kavita("/api/series/all-v2?PageNumber=1&PageSize=0", body=EVERY) or []:
        d = kavita(f"/api/series/series-detail?seriesId={s['id']}") or {}
        chapters = list(d.get("chapters") or []) + [c for v in d.get("volumes") or [] for c in v.get("chapters") or []]
        chapters += list(d.get("specials") or [])
        for c in chapters:
            files = c.get("files")
            if files is None:
                files = (kavita(f"/api/series/chapter?chapterId={c['id']}") or {}).get("files") or []
            for f, offset in in_reading_order(files):
                out[f["filePath"]] = (s["id"], c["id"], offset)
    return out


def signature() -> list[tuple[str, float]]:
    return sorted((str(p), p.stat().st_mtime) for p in SCRIPTS.glob("**/script.json"))


def build_index() -> int:
    ids = chapter_ids()
    tmp = DB.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.execute(
        "CREATE VIRTUAL TABLE lines USING fts5(text, speaker, series UNINDEXED, chapter UNINDEXED, "
        "title UNINDEXED, series_id UNINDEXED, chapter_id UNINDEXED, page UNINDEXED, line UNINDEXED)"
    )
    rows = 0
    for p in SCRIPTS.glob("**/script.json"):
        try:
            s = json.loads(p.read_text())
        except (OSError, ValueError) as err:
            log(f"index: skip {p}: {err}")
            continue
        found = ids.get(f"{KAVITA_ROOT}/{s['cbz']}")
        if not found:
            continue
        for page in s["pages"]:
            for l in page["lines"]:
                if l["type"] in ("sfx", "sign"):
                    continue
                db.execute(
                    "INSERT INTO lines VALUES (?,?,?,?,?,?,?,?,?)",
                    (l["text"], l["speaker"], s["series"], s["chapter"], s["title"], found[0], found[1], page["index"] + found[2], l["order"]),
                )
                rows += 1
    db.commit()
    db.close()
    tmp.replace(DB)
    return rows


def indexer() -> None:
    last = None
    while True:
        try:
            sig = signature()
            if sig != last:
                if KAVITA_KEY:
                    n = build_index()
                    log(f"index: {n} lines from {len(sig)} scripts")
                else:
                    log(f"index: {len(sig)} scripts, search off (no KAVITA_API_KEY)")
                last = sig
        except Exception as err:  # keep the loop alive; the next pass retries
            log(f"index failed: {err}")
        time.sleep(INTERVAL)


_visible: dict[str, tuple[float, set[int]]] = {}
_visible_lock = threading.Lock()


def visible_series(token: str) -> set[int]:
    now = time.time()
    with _visible_lock:
        hit = _visible.get(token)
        if hit and now - hit[0] < 60:
            return hit[1]
    ids = {s["id"] for s in kavita("/api/series/all-v2?PageNumber=1&PageSize=0", token=token, body=EVERY) or []}
    with _visible_lock:
        for k in [k for k, (t, _) in _visible.items() if now - t > 60]:
            del _visible[k]
        _visible[token] = (now, ids)
    return ids


def fts_query(q: str) -> str | None:
    """User words -> an FTS5 query: every word must match, the last as a prefix."""
    words = [w for w in "".join(c if c.isalnum() or c in "'-" else " " for c in q).split() if w.strip("'-")]
    if not words:
        return None
    quoted = ['"' + w.replace('"', "") + '"' for w in words[:8]]
    quoted[-1] += "*"
    return " ".join(quoted)


def search(q: str, series: set[int]) -> list[dict]:
    match = fts_query(q)
    if not match or not DB.exists() or not series:
        return []
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        marks = ",".join("?" * len(series))
        rows = db.execute(
            f"SELECT series, chapter, title, series_id, chapter_id, page, line, speaker, text, "
            f"snippet(lines, 0, '\u0002', '\u0003', '…', 16) FROM lines "
            f"WHERE lines MATCH ? AND series_id IN ({marks}) ORDER BY rank LIMIT {LIMIT}",
            (match, *series),
        ).fetchall()
    finally:
        db.close()
    keys = ["series", "chapter", "title", "seriesId", "chapterId", "page", "line", "speaker", "text", "snippet"]
    return [dict(zip(keys, r)) for r in rows]


# --- http ---------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "scripts"

    def send(self, status: int, body=None, *, raw: bytes | None = None) -> None:
        data = raw if raw is not None else json.dumps(body if body is not None else {}).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.send_header("cache-control", "private, no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        parts = url.path.strip("/").split("/")
        token = self.headers.get("authorization", "")
        try:
            if parts == ["script", "health"]:
                n = 0
                if DB.exists():
                    with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as db:
                        n = db.execute("SELECT count(*) FROM lines").fetchone()[0]
                return self.send(200, {"scripts": len(signature()), "lines": n, "search": bool(KAVITA_KEY)})
            if not token.lower().startswith("bearer "):
                return self.send(401, {"error": "sign in"})
            if len(parts) == 3 and parts[:2] == ["script", "chapter"] and parts[2].isdigit():
                chapter = kavita(f"/api/series/chapter?chapterId={parts[2]}", token=token)
                merged = chapter_script((chapter or {}).get("files") or [])
                if merged is None:
                    return self.send(404, {"error": "no script for this chapter"})
                return self.send(200, merged)
            if parts == ["script", "search"]:
                q = urllib.parse.parse_qs(url.query).get("q", [""])[0][:200]
                return self.send(200, {"q": q, "results": search(q, visible_series(token))})
            return self.send(404, {"error": "not found"})
        except KavitaError as err:
            return self.send(401 if err.status == 401 else 502, {"error": f"kavita answered {err.status}"})
        except (urllib.error.URLError, OSError) as err:
            log(f"{self.path}: {err}")
            return self.send(502, {"error": "kavita unreachable"})

    def log_message(self, fmt, *args) -> None:
        pass


def main() -> int:
    log(f"scripts: {SCRIPTS} on :{PORT}, index every {INTERVAL}s, search {'on' if KAVITA_KEY else 'off (no KAVITA_API_KEY)'}")
    threading.Thread(target=indexer, daemon=True).start()
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
