"""Read a Suwayomi CBZ: its pages in order, and what ComicInfo.xml says about it."""

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


def natural_key(name: str):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", name)]


@dataclass
class Chapter:
    path: Path
    series: str
    number: str
    title: str
    scanlator: str
    page_names: list[str] = field(default_factory=list)

    def pages(self) -> list[Image.Image]:
        """Every page as RGB, in reading order."""
        with zipfile.ZipFile(self.path) as z:
            return [Image.open(io.BytesIO(z.read(n))).convert("RGB") for n in self.page_names]


def open_chapter(path: Path) -> Chapter:
    with zipfile.ZipFile(path) as z:
        names = sorted(
            (n for n in z.namelist() if Path(n).suffix.lower() in IMAGE_EXT and not n.startswith("__MACOSX")),
            key=natural_key,
        )
        info = {}
        if "ComicInfo.xml" in z.namelist():
            root = ET.fromstring(z.read("ComicInfo.xml"))
            info = {el.tag.split("}")[-1]: (el.text or "").strip() for el in root}
    return Chapter(
        path=path,
        series=info.get("Series") or path.parent.name,
        number=info.get("Number", ""),
        title=info.get("Title") or path.stem,
        # Suwayomi puts the scanlator in <Translator>, and in the file name as "<scanlator>_".
        scanlator=info.get("Translator") or (path.stem.split("_", 1)[0] if "_" in path.stem else ""),
        page_names=names,
    )
