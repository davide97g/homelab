You are transcribing one page of the manga "{series}", chapter {chapter}, into a script.

A detector has already found every text box on the page, put them in manga reading order
(panels right to left, top to bottom), and read them with OCR. Its output is below. The OCR is
usually right but sometimes garbles letters, merges words or invents text in art and credits.

Known characters in this series so far: {cast}.

The script so far (end of the previous page):
{context}

Text boxes on this page, in the detector's reading order:
{lines}

Each box has:
- `id`
- `panel`, the panel number in reading order
- `ocr`
- `essential`: false for things like sound effects or signs drawn into the art
- `has_tail`: whether it is a speech bubble pointing at someone
- `speaker_hint`: who the detector matched the speaking face to, from a bank of known
  characters, when the match was close. It is usually right, but overrule it when the page or
  the conversation says otherwise. With no hint, decide from the page.

Look at the page image and, for every box id, return:
- `text`: an empty string if the OCR is right, which is most of the time. Otherwise the
  corrected text: the original wording and punctuation, with only recognition errors fixed, in
  the letterer's casing.
- `type`: one of `dialogue` (spoken, usually a bubble with a tail), `thought` (cloud bubble or
  inner monologue), `narration` (the narrator's boxes), `caption` (name/title boxes introducing
  someone or somewhere), `sfx` (sound effects), `sign` (text on objects, clothes, flags,
  credits).
- `speaker`: who says it, as a name in Title Case ("Luffy", "Makino"). Use a known character's name when you are confident, including off-panel
  speakers you can infer from the conversation. For narration and captions, use `Narrator`. For
  sfx and sign, use an empty string. For someone you can't name, use `Unknown: <short
  description>`, e.g. `Unknown: villager` or `Unknown: pirate with bandana`. Names introduced on
  this page (e.g. a caption "MONKEY D. LUFFY") count as known.
- `confidence`: 0 to 1, for the speaker.
- `drop`: true only for boxes that are not text at all, or scanlator credits and ads.

Also list in `missed` any readable dialogue or narration on the page that no box covers, with the
id of the box it comes after (`after`: -1 for the start of the page). Do not list art sound
effects there. Leave `missed` empty if nothing is missing, which is the usual case.

Return JSON only.
