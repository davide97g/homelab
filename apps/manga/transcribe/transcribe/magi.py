"""Magi v2: the structure of every page, in one pass over the whole chapter.

Magi v2 ("Tails Tell Tales", Sachdeva et al. 2024) detects panels, text boxes,
characters and speech-bubble tails, sorts panels and texts in manga reading
order (right to left), links each text to its speaker, OCRs the text, and names
characters by matching them against a bank of reference crops.

Its character clusters are per page. For the bank we also keep every
character crop's embedding (`magi-characters.npy`), so bank.py can cluster across pages
and chapters with the model's own notion of "same character".

Licence: personal, research and non-commercial use.
"""

import os
import time

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np
import torch
from PIL import Image

MODEL = "ragavsachdeva/magiv2"
# Pinned: the model is remote code, so a new upload would run unreviewed.
REVISION = "fbc890fec52977142e8ee00bfe26e9458b65517c"

# Magi's "none of the bank" cost: a character is named only when its crop is
# closer than this (euclidean, normalised embeddings) to one of that name's
# bank crops. Magi ships 0.75. On One Piece ch. 1 with a ten-character bank,
# right matches had a median distance of 0.44-0.60 and lookalikes wrongly named
# after characters not in the chapter 0.64-0.70, so 0.62 keeps most of the
# first and drops most of the second; the VLM names the rest from the page.
ETA = float(os.environ.get("TRANSCRIBE_ETA", "0.62"))
SURE = 0.5  # below this, the hint the VLM gets says "sure"

_model = None


def device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def model():
    global _model
    if _model is None:
        from transformers import AutoModel

        _model = AutoModel.from_pretrained(MODEL, revision=REVISION, trust_remote_code=True).to(device()).eval()
    return _model


def as_array(page: Image.Image) -> np.ndarray:
    # Magi was trained on greyscale pages; colour ones go through the same conversion its demo uses.
    return np.array(page.convert("L").convert("RGB"))


def empty_bank() -> dict:
    return {"images": [], "names": []}


def load_bank(bank: dict | None) -> dict:
    """bank.json lists image paths; Magi wants arrays."""
    if not bank or not bank.get("images"):
        return empty_bank()
    return {
        "images": [np.array(Image.open(p).convert("L").convert("RGB")) for p in bank["images"]],
        "names": list(bank["names"]),
    }


@torch.no_grad()
def detect(pages: list[Image.Image], bank: dict | None = None) -> tuple[dict, np.ndarray]:
    """Returns (magi.json content, character embeddings in page/character order)."""
    m = model()
    arrays = [as_array(p) for p in pages]
    started = time.time()
    loaded = load_bank(bank)
    results = m.do_chapter_wide_prediction(arrays, loaded, eta=ETA, use_tqdm=True, do_ocr=True)
    embeddings = m.predict_crop_embeddings(arrays, [r["characters"] for r in results])
    emb = torch.cat(embeddings, dim=0) if embeddings else torch.zeros(0, 768)
    emb = torch.nn.functional.normalize(emb, p=2, dim=1).float().cpu().numpy()

    # How close each named character is to its name's nearest bank crop.
    distances: list[float | None] = [None] * len(emb)
    if loaded["images"]:
        b = m.predict_crop_embeddings(loaded["images"], [[[0, 0, x.shape[1], x.shape[0]]] for x in loaded["images"]])
        b = torch.nn.functional.normalize(torch.cat(b, dim=0), p=2, dim=1).float().cpu().numpy()
        names = np.array(loaded["names"])
        assigned = [n for r in results for n in r["character_names"]]
        for i, n in enumerate(assigned):
            if n in loaded["names"]:
                distances[i] = round(float(np.linalg.norm(b[names == n] - emb[i], axis=1).min()), 3)
    offsets = np.cumsum([0] + [len(r["characters"]) for r in results]).tolist()
    out = {
        "model": f"{MODEL}@{REVISION[:12]}",
        "device": device(),
        "seconds": round(time.time() - started, 1),
        "bank": list(bank["names"]) if bank else [],
        "eta": ETA,
        "pages": [
            {
                "index": i,
                "width": p.width,
                "height": p.height,
                "panels": r["panels"],
                "texts": r["texts"],
                "ocr": r.get("ocr", []),
                "is_essential_text": r["is_essential_text"],
                "characters": r["characters"],
                "character_names": r["character_names"],
                "character_distances": distances[offsets[i] : offsets[i] + len(r["characters"])],
                "character_cluster_labels": [int(c) for c in r["character_cluster_labels"]],
                "tails": r["tails"],
                "text_character_associations": r["text_character_associations"],
                "text_tail_associations": r["text_tail_associations"],
            }
            for i, (p, r) in enumerate(zip(pages, results))
        ],
    }
    return out, emb


def panel_of(box: list[float], panels: list[list[float]]) -> int | None:
    """Index of the (sorted) panel that holds most of this box."""
    best, best_area = None, 0.0
    x1, y1, x2, y2 = box
    for i, (px1, py1, px2, py2) in enumerate(panels):
        w = max(0.0, min(x2, px2) - max(x1, px1))
        h = max(0.0, min(y2, py2) - max(y1, py1))
        if w * h > best_area:
            best, best_area = i, w * h
    return best


def lines(page: dict) -> list[dict]:
    """Magi's texts for one page, as lines in reading order, with the candidate speaker."""
    speaker = {t: c for t, c in page["text_character_associations"]}
    tailed = {t for t, _ in page["text_tail_associations"]}
    out = []
    for i, box in enumerate(page["texts"]):
        c = speaker.get(i)
        out.append(
            {
                "id": i,
                "bbox": [round(v) for v in box],
                "panel": panel_of(box, page["panels"]),
                "ocr": page["ocr"][i] if i < len(page["ocr"]) else "",
                "essential": bool(page["is_essential_text"][i]),
                "has_tail": i in tailed,
                "character": c,
                "magi_speaker": page["character_names"][c] if c is not None else None,
                "magi_distance": (page.get("character_distances") or [None] * len(page["characters"]))[c] if c is not None else None,
            }
        )
    return out
