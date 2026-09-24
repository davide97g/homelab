"""Put each series' real cover beside its chapters, for Kavita.

Kavita takes a series cover from the first page of the first chapter it has,
which for MANGA Plus is a title card and for MangaDex scanlations is often a
credits page. A `cover.*` image in the series folder wins over that, so this
writes one: the thumbnail Suwayomi already knows for the series, which is the
source's own cover art.

Runs in its own container next to Suwayomi, every COVERS_INTERVAL seconds:

  1. ask Suwayomi which manga have at least one downloaded chapter
  2. find each one's folder under MANGA_ROOT/mangas/<source>/<title>
  3. if the folder has no cover.* yet, fetch the thumbnail and write it
  4. ask Kavita to refresh that series' covers, when a key is set

A cover already in a folder is never replaced, so dropping your own cover.jpg
into one is how to override this. Standard library only.
"""

import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

SUWAYOMI = os.environ.get("SUWAYOMI_URL", "http://suwayomi:4567").rstrip("/")
KAVITA = os.environ.get("KAVITA_URL", "http://kavita:5000").rstrip("/")
KAVITA_KEY = os.environ.get("KAVITA_API_KEY", "")
ROOT = pathlib.Path(os.environ.get("MANGAS_DIR", "/mangas"))
INTERVAL = int(os.environ.get("COVERS_INTERVAL", "600"))

EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def http(url: str, *, data: bytes | None = None, headers: dict | None = None, timeout: int = 30):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    return urllib.request.urlopen(req, timeout=timeout)


def graphql(query: str) -> dict:
    body = json.dumps({"query": query}).encode()
    with http(f"{SUWAYOMI}/api/graphql", data=body, headers={"content-type": "application/json"}) as res:
        out = json.load(res)
    if out.get("errors"):
        raise RuntimeError(out["errors"][0].get("message", "GraphQL error"))
    return out["data"]


def valid_filename(name: str) -> str:
    """Suwayomi's folder names, which are Mihon's DiskUtil.buildValidFilename:
    trim dots and spaces, replace FAT-invalid characters with `_`, cap at 240
    bytes. Matching it exactly is what lets a title find its folder."""
    name = name.strip(". ")
    out = "".join("_" if (ord(c) < 0x20 or ord(c) == 0x7F or c in '"*/:<>?\\|') else c for c in name)
    raw = out.encode()
    if len(raw) > 240:
        out = raw[:240].decode(errors="ignore")
    return out or "(invalid)"


def folder_for(source: str, title: str) -> pathlib.Path | None:
    exact = ROOT / valid_filename(source) / valid_filename(title)
    if exact.is_dir():
        return exact
    # Fall back to a case-insensitive match inside the source folder, in case a
    # Suwayomi update changes the sanitising in a way this copy does not.
    parent = ROOT / valid_filename(source)
    if parent.is_dir():
        want = valid_filename(title).casefold()
        for child in parent.iterdir():
            if child.is_dir() and child.name.casefold() == want:
                return child
    return None


def has_cover(folder: pathlib.Path) -> bool:
    return any(p.is_file() and p.stem.lower() == "cover" for p in folder.iterdir())


def write_cover(manga_id: int, folder: pathlib.Path) -> str:
    with http(f"{SUWAYOMI}/api/v1/manga/{manga_id}/thumbnail", timeout=60) as res:
        kind = res.headers.get_content_type()
        data = res.read()
    ext = EXT.get(kind)
    if not ext or not data:
        raise RuntimeError(f"thumbnail came back as {kind or 'nothing'}")
    # Written under a dot-name first and renamed, so Kavita's watcher never sees
    # half a file called cover.jpg.
    tmp = folder / f".cover{ext}.tmp"
    tmp.write_bytes(data)
    final = folder / f"cover{ext}"
    tmp.replace(final)
    return final.name


def kavita(path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"x-api-key": KAVITA_KEY, "content-type": "application/json"}
    with http(f"{KAVITA}{path}", data=data, headers=headers) as res:
        text = res.read()
    return json.loads(text) if text else None


def refresh_kavita(folders: list[pathlib.Path]) -> None:
    """A normal scan keeps the cover Kavita already generated, so a new cover.jpg
    needs a forced cover refresh for its series. Kavita addresses series by id,
    found here by the folder it lives in."""
    if not KAVITA_KEY or not folders:
        return
    wanted = {"/manga/" + str(f.relative_to(ROOT)) for f in folders}
    every = kavita("/api/series/all-v2?PageNumber=1&PageSize=0", {"statements": [], "combination": 1, "limitTo": 0})
    for s in every or []:
        if s.get("lowestFolderPath") not in wanted:
            continue
        kavita("/api/series/refresh-metadata", {"libraryId": s["libraryId"], "seriesId": s["id"], "forceUpdate": True})
        log(f"kavita: refreshing covers for {s.get('name')}")


def once() -> None:
    data = graphql("{ chapters(condition: { isDownloaded: true }) { nodes { mangaId } } }")
    ids = sorted({c["mangaId"] for c in data["chapters"]["nodes"]})
    if not ids:
        return
    mangas = graphql(
        "{ mangas(filter: { id: { in: [%s] } }) { nodes { id title source { displayName } } } }"
        % ",".join(map(str, ids))
    )["mangas"]["nodes"]

    written: list[pathlib.Path] = []
    for m in mangas:
        source = (m.get("source") or {}).get("displayName") or ""
        folder = folder_for(source, m["title"])
        if folder is None:
            log(f"skip {m['title']!r}: no folder under {source!r}")
            continue
        if has_cover(folder):
            continue
        try:
            name = write_cover(m["id"], folder)
            written.append(folder)
            log(f"wrote {folder.relative_to(ROOT)}/{name}")
        except (urllib.error.URLError, RuntimeError, OSError) as err:
            log(f"cover for {m['title']!r} failed: {err}")

    try:
        refresh_kavita(written)
    except (urllib.error.URLError, OSError, ValueError) as err:
        log(f"kavita refresh failed, it will show on the next forced scan: {err}")


def main() -> int:
    log(f"covers: every {INTERVAL}s, Kavita refresh {'on' if KAVITA_KEY else 'off (no KAVITA_API_KEY)'}")
    while True:
        try:
            once()
        except Exception as err:  # keep the loop alive; the next pass retries
            log(f"pass failed: {err}")
        if "--once" in sys.argv:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
