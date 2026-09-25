"""Manga chapter scripts: every line of text, in reading order, with who says it.

Stages, each cached next to the chapter's output so a re-run skips what is done:

  ingest  CBZ -> pages + ComicInfo                  (cbz.py)
  detect  Magi v2: panels, texts, characters, order, OCR, speaker links  (magi.py -> magi.json)
  refine  local VLM through Ollama: OCR fixes, speakers, line types      (refine.py -> refined.json)
  emit    script.json + script.md                    (emit.py)

The character bank (bank.py) is built from clusters of character crops, named by
the VLM and confirmed by hand in review.yaml.
"""
