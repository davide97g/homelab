"""The VLM pass: OCR fixes, speakers by name, and what kind of text each line is.

One Ollama call per page. The model sees the colour page, Magi's lines for it,
the known cast and the end of the previous page's script, and answers in a JSON
schema. It may correct, type, attribute or drop Magi's lines, and report text
Magi missed, but it cannot reorder them: Magi's reading order is the stronger
signal, and the VLM only says so when it disagrees.
"""

import base64
import io
import json
import os
import time
from pathlib import Path

import ollama
from PIL import Image

from . import magi

MODEL = os.environ.get("TRANSCRIBE_VLM", "qwen3-vl:8b")
PROMPT = (Path(__file__).parent / "prompts" / "refine.md").read_text()
TYPES = ["dialogue", "thought", "narration", "caption", "sfx", "sign"]

SCHEMA = {
    "type": "object",
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "text": {"type": "string"},
                    "type": {"type": "string", "enum": TYPES},
                    "speaker": {"type": "string"},
                    "confidence": {"type": "number"},
                    "drop": {"type": "boolean"},
                },
                "required": ["id", "text", "type", "speaker", "confidence", "drop"],
            },
        },
        "missed": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "after": {"type": "integer"},
                    "text": {"type": "string"},
                    "type": {"type": "string", "enum": TYPES},
                    "speaker": {"type": "string"},
                },
                "required": ["after", "text", "type", "speaker"],
            },
        },
    },
    "required": ["lines", "missed"],
}


def encode(page: Image.Image, longest: int = 1024) -> str:
    img = page.copy()
    img.thumbnail((longest, longest))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def chat_json(prompt: str, images: list[str], schema: dict, *, model: str | None = None, num_ctx: int = 8192, max_tokens: int = 1024) -> dict:
    """One structured answer from the VLM, retried once, warmer, if it fails.

    Small VLMs can fall into a loop ("HA HA HA ...") and write until the
    context is gone, so output is capped at max_tokens, and a capped answer is
    unparseable JSON, which counts as a failure."""
    for attempt in range(2):
        try:
            res = ollama.chat(
                model=model or MODEL,
                messages=[{"role": "user", "content": prompt, "images": images}],
                format=schema,
                think=False,
                options={
                    "temperature": 0 if attempt == 0 else 0.4,
                    "num_ctx": num_ctx,
                    "num_predict": max_tokens,
                    "repeat_penalty": 1.1,
                },
            )
            # Ollama with qwen3-vl and think=False sometimes returns the whole
            # answer in `thinking` and leaves `content` empty.
            return json.loads(res.message.content or res.message.thinking or "")
        except (ValueError, ollama.ResponseError):
            if attempt:
                raise
    raise AssertionError("unreachable")


def squeeze(text: str, limit: int = 160) -> str:
    """Collapse a word repeated many times ("HA HA HA ..." x60) and cap the length:
    the OCR does this on drawn laughter, and small VLMs copy the loop."""
    words, out = text.split(), []
    for w in words:
        if len(out) >= 4 and all(x == w for x in out[-4:]):
            continue
        out.append(w)
    s = " ".join(out)
    return s if len(s) <= limit else s[:limit] + "…"


def speaker_hint(line: dict) -> str | None:
    """Magi's name for the speaker, only when the face match was close.

    An unsure match is left out rather than flagged: on One Piece ch. 1 the VLM
    took "(unsure)" names as given anyway, crediting Shanks's crew's lines to
    Coby and Alvida, who are not in the chapter."""
    name = line["magi_speaker"]
    d = line.get("magi_distance")
    if not name or name == "Other" or d is None or d >= magi.SURE:
        return None
    return name


def prompt_for(series: str, chapter: str, cast: list[str], context: list[str], lines: list[dict]) -> str:
    boxes = [
        {
            "id": l["id"],
            "panel": l["panel"],
            "ocr": squeeze(l["ocr"]),
            "essential": l["essential"],
            "has_tail": l["has_tail"],
            "speaker_hint": speaker_hint(l),
        }
        for l in lines
    ]
    return PROMPT.format(
        series=series,
        chapter=chapter,
        cast=", ".join(cast) if cast else "none yet",
        context="\n".join(context) if context else "(start of chapter)",
        lines=json.dumps(boxes, ensure_ascii=False, indent=1),
    )


def refine_page(page_img: Image.Image, page: dict, *, series: str, chapter: str, cast: list[str], context: list[str]) -> dict:
    lines = magi.lines(page)
    if not lines:
        return {"lines": [], "missed": [], "seconds": 0.0, "model": MODEL}
    started = time.time()
    try:
        out = chat_json(
            prompt_for(series, chapter, cast, context, lines),
            [encode(page_img)],
            SCHEMA,
            num_ctx=16384,
            # About 40 tokens a line when the text is unchanged, 60 when it is fixed.
            max_tokens=400 + 90 * len(lines),
        )
    except (ValueError, ollama.ResponseError) as err:
        # The page keeps Magi's lines as they are; emit marks them source "magi".
        out = {"lines": [], "missed": [], "error": str(err)[:200]}
    out["seconds"] = round(time.time() - started, 1)
    out["model"] = MODEL
    return out
