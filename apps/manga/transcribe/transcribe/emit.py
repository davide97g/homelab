"""script.json and script.md, from Magi's structure and the VLM's corrections."""

import re

from . import magi
from .refine import squeeze

# The VLM sometimes copies the hint's "(sure)" into the name it answers.
HINT_TAG = re.compile(r"\s*\((?:sure|unsure)\)\s*$", re.I)

VERSION = 1


def magi_only_line(l: dict) -> dict:
    """What a line looks like with no VLM pass: Magi's OCR and speaker, a type from its flags."""
    name = l["magi_speaker"]
    if not l["essential"]:
        kind, speaker = "sfx", ""
    elif name and name != "Other":
        kind, speaker = "dialogue", name
    elif l["character"] is not None:
        kind, speaker = "dialogue", f"Unknown: character {l['character']}"
    else:
        kind, speaker = ("dialogue" if l["has_tail"] else "narration"), ("" if l["has_tail"] else "Narrator")
    return {"text": squeeze(l["ocr"]), "type": kind, "speaker": speaker, "confidence": None, "source": "magi"}


def page_lines(page: dict, refined: dict | None) -> list[dict]:
    base = magi.lines(page)
    fixes = {r["id"]: r for r in (refined or {}).get("lines", [])}
    missed = (refined or {}).get("missed", [])
    out = []

    def add_missed(after: int):
        for m in missed:
            if m["after"] == after and m["text"].strip():
                out.append({"panel": None, "bbox": None, "character": None, "text": m["text"], "type": m["type"],
                            "speaker": m["speaker"], "confidence": None, "source": "vlm"})

    add_missed(-1)
    for l in base:
        fix = fixes.get(l["id"])
        if fix is None:
            line = magi_only_line(l)
        elif fix.get("drop"):
            add_missed(l["id"])
            continue
        else:
            line = {
                # An empty text means the VLM kept Magi's OCR.
                "text": fix["text"].strip() or squeeze(l["ocr"]),
                "type": fix["type"],
                "speaker": HINT_TAG.sub("", fix["speaker"]).strip(),
                "confidence": round(float(fix["confidence"]), 2),
                "source": "magi+vlm",
            }
        # `character`: the index of the speaker's box in magi.json, from the bubble's tail.
        out.append({"panel": l["panel"], "bbox": l["bbox"], "character": l["character"], **line})
        add_missed(l["id"])
    for i, line in enumerate(out):
        line["order"] = i
    return out


def named(speaker: str) -> bool:
    return bool(speaker) and speaker != "Narrator" and not speaker.startswith("Unknown")


def canonical_names(lines: list[dict]) -> dict[str, str]:
    """"MAKINO" and "Makino" are one person: every spelling that differs only in
    case maps to the one that is not all caps, or else the most common one."""
    seen: dict[str, dict[str, int]] = {}
    for l in lines:
        if named(l["speaker"]):
            forms = seen.setdefault(l["speaker"].casefold(), {})
            forms[l["speaker"]] = forms.get(l["speaker"], 0) + 1
    out = {}
    for forms in seen.values():
        best = max(forms, key=lambda f: (not f.isupper(), forms[f]))
        out.update({f: best for f in forms})
    return out


def script(chapter, detected: dict, refined: dict[int, dict] | None, cbz_rel: str) -> dict:
    pages = []
    vlm = None
    for page in detected["pages"]:
        r = (refined or {}).get(page["index"])
        vlm = vlm or (r or {}).get("model")
        pages.append({"index": page["index"], "width": page["width"], "height": page["height"], "lines": page_lines(page, r)})
    every = [l for p in pages for l in p["lines"]]
    names = canonical_names(every)
    cast: dict[str, int] = {}
    for l in every:
        l["speaker"] = names.get(l["speaker"], l["speaker"])
        if named(l["speaker"]):
            cast[l["speaker"]] = cast.get(l["speaker"], 0) + 1
    return {
        "version": VERSION,
        "series": chapter.series,
        "chapter": chapter.number,
        "title": chapter.title,
        "scanlator": chapter.scanlator,
        "cbz": cbz_rel,
        "models": {"magi": detected["model"], "vlm": vlm},
        "cast": sorted(cast, key=lambda k: -cast[k]),
        "pages": pages,
    }


def markdown(s: dict) -> str:
    out = [f"# {s['series']} — {s['title']}", ""]
    if s["cast"]:
        out += [f"Cast: {', '.join(s['cast'])}", ""]
    for p in s["pages"]:
        if not p["lines"]:
            continue
        out += [f"## Page {p['index'] + 1}", ""]
        for l in p["lines"]:
            text = l["text"]
            if l["type"] in ("sfx", "sign"):
                out.append(f"_[{l['type']}] {text}_")
            elif l["type"] in ("narration", "caption"):
                out.append(f"> {text}")
            else:
                who = l["speaker"] or "?"
                aside = " (thinking)" if l["type"] == "thought" else ""
                out.append(f"**{who}**{aside}: {text}")
            out.append("")
    return "\n".join(out)
