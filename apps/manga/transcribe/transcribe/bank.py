"""The character bank: reference crops with names, which Magi matches characters against.

Magi v2 names a character only if the bank has them. The bank is bootstrapped
from chapters that have already been through detect and refine:

  propose  Every line the VLM gave a name, with some confidence, votes that
           name onto the character box Magi says spoke it (through the
           bubble's tail). Per name, the crops closest to that name's mean
           Magi embedding are kept, which drops the odd wrong vote. Frequent
           characters nobody named come after, as clusters of Magi
           embeddings, named "?". No model calls: it takes seconds.
           Written to review.yaml, with review.html to look at.
  (you)    `status: confirmed` on the right ones, fix `name`, delete a wrong
           crop from its `crops` list, or `status: ignore`. Entries with the
           same name become one character.
  apply    confirmed entries -> bank/images/*.jpg + bank.json. The next
           `transcribe chapter` sees the bank changed and runs detect again.

Why not cluster first and ask the VLM to name each cluster: tried on One
Piece ch. 1-3, the clusters mixed characters and the VLM called 34 of 40
"Luffy". Naming comes from the page, where the VLM sees who talks to whom.
"""

import html
import json
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

from .cbz import open_chapter

CROPS = 6  # shown per candidate
BANK_CROPS = 5  # kept per character in the bank
MIN_CONFIDENCE = 0.7  # of the VLM's speaker, for a vote
MIN_VOTED = 3  # boxes, for a name to be proposed
UNNAMED = 12  # "?" clusters per round
MIN_PAGES = 4  # for a "?" cluster

HEADER = """\
# Character bank review. For each entry, look at its crops in review.html, then:
#   status: confirmed   to add it to the bank as `name` (edit the name if it is wrong)
#   status: ignore      for background characters, mixed entries, and non-characters
# Delete a wrong crop from `crops` before confirming. Entries with the same name become one
# character. Then run: transcribe bank <dir> --apply
"""


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def named(speaker: str) -> bool:
    return bool(speaker) and speaker != "Narrator" and not speaker.startswith("Unknown")


def crop(img: Image.Image, box, pad: float = 0.06) -> Image.Image:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    return img.crop((max(0, x1 - w * pad), max(0, y1 - h * pad), min(img.width, x2 + w * pad), min(img.height, y2 + h * pad)))


def usable(box, page: dict) -> bool:
    """Not a whole panel, not a speck."""
    area = (box[2] - box[0]) * (box[3] - box[1]) / (page["width"] * page["height"])
    return 0.004 < area < 0.4


def boxes(series_dir: Path):
    """Every character box Magi could not name: (chapter dir, page, box index, box, embedding, page dict, script page)."""
    for d in sorted(series_dir.iterdir()):
        if not all((d / f).exists() for f in ("magi.json", "magi-characters.npy", "script.json")):
            continue
        detected = json.loads((d / "magi.json").read_text())
        script = json.loads((d / "script.json").read_text())
        emb = np.load(d / "magi-characters.npy")
        offset = 0
        for page, spage in zip(detected["pages"], script["pages"]):
            for j, box in enumerate(page["characters"]):
                if page["character_names"][j] == "Other":
                    yield d, page, j, box, emb[offset + j], spage
            offset += len(page["characters"])


def pick(items: list[dict], centroid: np.ndarray, n: int) -> list[dict]:
    """The n items most like the centroid, one per page where possible."""
    ranked = sorted(items, key=lambda it: -float(it["emb"] @ centroid))
    out, pages = [], set()
    for it in ranked:
        key = (it["chapter"], it["page"]["index"])
        if key not in pages:
            out.append(it)
            pages.add(key)
        if len(out) == n:
            return out
    return out + [it for it in ranked if it not in out][: n - len(out)]


def propose(series_dir: Path, paths, log, *, threshold: float) -> None:
    from scipy.cluster.hierarchy import fcluster, linkage

    bank_dir = series_dir / "bank"
    review_path = bank_dir / "review.yaml"
    old = (yaml.safe_load(review_path.read_text()) or {}).get("clusters", []) if review_path.exists() else []
    kept = [e for e in old if e.get("status") in ("confirmed", "ignore", "applied")]
    next_id = max((int(e["id"][1:]) for e in old), default=0) + 1

    # 1. Votes from the script.
    items, votes = [], {}
    for d, page, j, box, emb, spage in boxes(series_dir):
        it = {"chapter": d, "page": page, "box": box, "emb": emb}
        items.append(it)
        v = Counter(
            l["speaker"]
            for l in spage["lines"]
            if l.get("character") == j and named(l["speaker"]) and (l.get("confidence") or 0) >= MIN_CONFIDENCE
        )
        if v:
            votes[id(it)] = v.most_common(1)[0][0]
    by_name: dict[str, list[dict]] = defaultdict(list)
    for it in items:
        if id(it) in votes:
            by_name[votes[id(it)]].append(it)

    candidates = []  # (entry fields, chosen items)
    centroids = []
    for name, its in sorted(by_name.items(), key=lambda kv: -len(kv[1])):
        if len(its) < MIN_VOTED:
            continue
        X = np.stack([it["emb"] for it in its])
        c = X.mean(axis=0)
        c /= np.linalg.norm(c) or 1
        centroids.append(c)
        good = [it for it in its if usable(it["box"], it["page"])] or its
        candidates.append(({
            "name": name,
            "source": "speakers",
            "boxes": len(its),
            "consistency": round(float(np.median(X @ c)), 2),
        }, pick(good, c, CROPS)))

    # 2. Frequent characters nobody named.
    rest = [it for it in items if id(it) not in votes and usable(it["box"], it["page"])]
    if len(rest) > 1:
        X = np.stack([it["emb"] for it in rest])
        labels = fcluster(linkage(X, "average", metric="cosine"), t=threshold, criterion="distance")
        groups: dict[int, list[dict]] = defaultdict(list)
        for it, l in zip(rest, labels):
            groups[int(l)].append(it)
        unnamed = 0
        for its in sorted(groups.values(), key=len, reverse=True):
            if unnamed == UNNAMED or len({(it["chapter"], it["page"]["index"]) for it in its}) < MIN_PAGES:
                break
            c = np.stack([it["emb"] for it in its]).mean(axis=0)
            c /= np.linalg.norm(c) or 1
            # Someone already proposed by name, seen in panels nobody spoke in.
            if centroids and max(float(c @ k) for k in centroids) > 0.85:
                continue
            candidates.append(({"name": "?", "source": "cluster", "boxes": len(its)}, pick(its, c, CROPS)))
            unnamed += 1

    # 3. Crops on disk.
    pages_cache: dict[Path, list[Image.Image]] = {}
    series_name = None
    entries = []
    keep_ids = {e["id"] for e in kept}
    if (bank_dir / "candidates").exists():
        for d in (bank_dir / "candidates").iterdir():
            if d.name not in keep_ids:
                shutil.rmtree(d)
    for fields, chosen in candidates:
        cid = f"c{next_id:03d}"
        next_id += 1
        out = bank_dir / "candidates" / cid
        out.mkdir(parents=True, exist_ok=True)
        files = []
        for k, it in enumerate(chosen):
            ch = it["chapter"]
            if ch not in pages_cache:
                chapter = open_chapter(paths.mangas / ch.relative_to(paths.scripts).parent / f"{ch.name}.cbz")
                series_name = series_name or chapter.series
                pages_cache[ch] = chapter.pages()
            crop(pages_cache[ch][it["page"]["index"]], it["box"]).save(out / f"{k}.jpg", quality=92)
            files.append(f"candidates/{cid}/{k}.jpg")
        entries.append({"id": cid, **fields, "status": "proposed", "crops": files})
        log(f"bank: {cid} {fields['name']} ({fields['source']}, {fields['boxes']} boxes)")

    review_path.write_text(HEADER + yaml.safe_dump({"clusters": kept + entries}, sort_keys=False, allow_unicode=True, width=100))
    (bank_dir / "review.html").write_text(review_html(series_name or series_dir.name, kept + entries))
    log(f"bank: {len(entries)} to review in {review_path} (pictures in review.html)")


def review_html(series: str, entries: list[dict]) -> str:
    rows = []
    for e in entries:
        imgs = "".join(f'<img src="{html.escape(f)}" loading="lazy">' for f in e["crops"])
        facts = ", ".join(str(x) for x in (e["status"], e.get("source"), f"{e.get('boxes')} boxes" if e.get("boxes") else None,
                                           f"consistency {e['consistency']}" if e.get("consistency") else None) if x)
        rows.append(f'<section><h2>{e["id"]} &middot; {html.escape(str(e["name"]))} <small>{facts}</small></h2>'
                    + (f'<p>{html.escape(str(e["note"]))}</p>' if e.get("note") else "")
                    + f'<div>{imgs}</div></section>')
    return f"""<!doctype html><meta charset="utf-8"><title>{html.escape(series)} bank review</title>
<style>body{{font:15px system-ui;margin:24px;background:#f3e6d3;color:#3a1d16}}section{{margin:0 0 28px}}
h2{{font-size:17px;margin:0 0 6px}}small{{font-weight:400;opacity:.7}}p{{margin:0 0 8px;opacity:.8}}
img{{height:180px;margin:0 8px 8px 0;border-radius:6px;background:#fff}}</style>
<h1>{html.escape(series)}: who is who</h1><p>Edit review.yaml next to this file, then run <code>transcribe bank &lt;dir&gt; --apply</code>.</p>{''.join(rows)}"""


def apply(series_dir: Path, log) -> None:
    bank_dir = series_dir / "bank"
    review_path = bank_dir / "review.yaml"
    if not review_path.exists():
        log(f"bank: no {review_path}; run `transcribe bank <dir>` first")
        return
    entries = (yaml.safe_load(review_path.read_text()) or {}).get("clusters", [])
    bank = json.loads((bank_dir / "bank.json").read_text()) if (bank_dir / "bank.json").exists() else {"images": [], "names": []}
    per_name = Counter(bank["names"])
    (bank_dir / "images").mkdir(exist_ok=True)
    added = 0
    for e in entries:
        if e.get("status") != "confirmed":
            continue
        name = str(e["name"]).strip()
        if not name or name == "?":
            log(f"bank: {e['id']} is confirmed with no name, skipped")
            continue
        for f in e["crops"]:
            if per_name[name] >= BANK_CROPS or not (bank_dir / f).exists():
                continue
            dest = f"images/{slug(name)}-{per_name[name]}.jpg"
            shutil.copy(bank_dir / f, bank_dir / dest)
            bank["images"].append(dest)
            bank["names"].append(name)
            per_name[name] += 1
            added += 1
        e["status"] = "applied"
    (bank_dir / "bank.json").write_text(json.dumps(bank, ensure_ascii=False, indent=1))
    review_path.write_text(HEADER + yaml.safe_dump({"clusters": entries}, sort_keys=False, allow_unicode=True, width=100))
    log(f"bank: {added} crops added; bank now {len(per_name)} characters, {len(bank['images'])} crops")
