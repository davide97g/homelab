"""transcribe: manga chapter -> script.

  transcribe chapter <cbz>...          detect, refine, emit (cached per stage)
  transcribe series <series dir>       every CBZ in a series folder
  transcribe bank <series dir>         propose named reference crops -> review.yaml
  transcribe bank <series dir> --apply confirmed names -> bank.json, for the next detect

Paths mirror the library: a CBZ at <mangas>/<source>/<series>/<file>.cbz gets
its script in <scripts>/<source>/<series>/<file stem>/, and its series bank in
<scripts>/<source>/<series>/bank/. <mangas> defaults to $MANGAS_DIR, <scripts>
to a `scripts` folder next to it (MANGA_ROOT/scripts on the box, outside what
Kavita watches).
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9.]+", "-", s.lower()).strip("-")


class Paths:
    def __init__(self, mangas: Path, scripts: Path):
        self.mangas = mangas.resolve()
        self.scripts = scripts.resolve()

    def rel(self, cbz: Path) -> Path:
        try:
            return cbz.resolve().relative_to(self.mangas)
        except ValueError:
            sys.exit(f"{cbz} is not under {self.mangas} (set --mangas)")

    def chapter_dir(self, cbz: Path) -> Path:
        r = self.rel(cbz)
        return self.scripts / r.parent / r.stem

    def series_dir(self, series: Path) -> Path:
        """A series folder under either tree -> its folder in the scripts tree."""
        s = series.resolve()
        for root in (self.mangas, self.scripts):
            try:
                return self.scripts / s.relative_to(root)
            except ValueError:
                pass
        sys.exit(f"{series} is under neither {self.mangas} nor {self.scripts}")

    def bank_dir(self, cbz: Path) -> Path:
        return self.scripts / self.rel(cbz).parent / "bank"


def read_json(p: Path):
    return json.loads(p.read_text()) if p.exists() else None


def write_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(p)


def load_bank(bank_dir: Path) -> dict | None:
    b = read_json(bank_dir / "bank.json")
    if not b:
        return None
    return {"images": [str(bank_dir / p) for p in b["images"]], "names": b["names"]}


def do_chapter(cbz: Path, paths: Paths, args) -> None:
    from . import cbz as cbzmod, emit

    ch = cbzmod.open_chapter(cbz)
    out = paths.chapter_dir(cbz)
    out.mkdir(parents=True, exist_ok=True)
    force = set(args.force or [])
    log(f"{ch.series} ch.{ch.number} ({ch.scanlator}), {len(ch.page_names)} pages -> {out}")
    pages = None

    bank = load_bank(paths.bank_dir(cbz))
    detected = read_json(out / "magi.json")
    from .magi import ETA

    stale = bool(detected and bank and (detected.get("bank") != bank["names"] or detected.get("eta") != ETA))
    if detected is None or "detect" in force or stale:
        from . import magi

        pages = ch.pages()
        if stale:
            log("bank changed since the last detect, running it again")
        detected, emb = magi.detect(pages, bank)
        write_json(out / "magi.json", detected)
        np.save(out / "magi-characters.npy", emb)
        log(f"detect: {detected['seconds']}s, {detected['seconds'] / len(pages):.1f}s/page on {detected['device']}")

    refined = None
    if not args.no_refine:
        from . import refine

        refine.MODEL = args.vlm or refine.MODEL
        cache = out / f"refined.{slug(refine.MODEL)}.json"
        refined = {int(k): v for k, v in (read_json(cache) or {}).items()}
        if "refine" in force or stale:
            refined = {}
        pages = pages if pages is not None or len(refined) == len(detected["pages"]) else ch.pages()
        cast = list(dict.fromkeys(bank["names"])) if bank else []
        context: list[str] = []
        for page in detected["pages"]:
            i = page["index"]
            if i not in refined:
                refined[i] = refine.refine_page(pages[i], page, series=ch.series, chapter=ch.number, cast=cast, context=context[-15:])
                write_json(cache, refined)
                err = refined[i].get("error")
                log(f"refine: page {i + 1}/{len(detected['pages'])}, {refined[i]['seconds']}s" + (f", kept Magi's lines: {err}" if err else ""))
            for l in emit.page_lines(page, refined[i]):
                s = l["speaker"]
                if s and s != "Narrator" and not s.startswith("Unknown") and s not in cast:
                    cast.append(s)
                if l["type"] not in ("sfx", "sign"):
                    context.append(f"{s or '?'}: {l['text']}")
        secs = sum(r.get("seconds", 0) for r in refined.values())
        log(f"refine: {secs:.0f}s total, {secs / len(detected['pages']):.1f}s/page with {refine.MODEL}")

    s = emit.script(ch, detected, refined, str(paths.rel(cbz)))
    write_json(out / "script.json", s)
    (out / "script.md").write_text(emit.markdown(s))
    n = sum(len(p["lines"]) for p in s["pages"])
    log(f"emit: {n} lines, cast {', '.join(s['cast'][:12]) or '(none)'}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="transcribe", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mangas", type=Path, default=Path(os.environ.get("MANGAS_DIR", "/mangas")))
    ap.add_argument("--scripts", type=Path, default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("chapter")
    c.add_argument("cbz", type=Path, nargs="+")
    s = sub.add_parser("series")
    s.add_argument("dir", type=Path)
    for p in (c, s):
        p.add_argument("--no-refine", action="store_true", help="Magi only, no VLM pass")
        p.add_argument("--vlm", help="Ollama model for the refine pass (default $TRANSCRIBE_VLM or qwen3-vl:8b)")
        p.add_argument("--force", action="append", choices=["detect", "refine"])

    b = sub.add_parser("bank")
    b.add_argument("dir", type=Path)
    b.add_argument("--apply", action="store_true")
    b.add_argument("--threshold", type=float, default=0.3, help="cosine distance to merge clusters")

    args = ap.parse_args()
    paths = Paths(args.mangas, args.scripts or args.mangas.resolve().parent / "scripts")

    if args.cmd == "chapter":
        for cbz in args.cbz:
            do_chapter(cbz, paths, args)
    elif args.cmd == "series":
        from .cbz import natural_key

        for cbz in sorted(args.dir.glob("*.cbz"), key=lambda p: natural_key(p.name)):
            do_chapter(cbz, paths, args)
    elif args.cmd == "bank":
        from . import bank

        d = paths.series_dir(args.dir)
        if args.apply:
            bank.apply(d, log)
        else:
            bank.propose(d, paths, log, threshold=args.threshold)


if __name__ == "__main__":
    main()
