#!/usr/bin/env python3
"""memories-search: search Immich with a sentence ("tutte le foto di marci che mangia").

    POST <api>/memories/search        Authorization: Bearer <immich token>  (or x-api-key)
    {"query": "foto di marci che mangia al mare l'estate scorsa", "page": 1, "size": 100}

An LLM turns the sentence into a small plan (people, what is in the picture in English,
years / month / season, place, photo or video, favourites). The plan becomes Immich filters:
names -> person ids (the caller's named people), place -> a known city / country, dates ->
takenAfter / takenBefore. With something to look at it's `/search/smart` (CLIP); with only
filters it's `/search/metadata`. The answer is Immich's own SearchResponseDto plus a
`memories` object saying how the sentence was read.

The LLM is any OpenAI-compatible chat endpoint (Ollama on the NAS by default; DeepSeek,
Gemini, Mistral, OpenAI... by changing LLM_URL / LLM_KEY / LLM_MODEL). When it is slow,
down or answers nonsense, the sentence goes to Immich's smart search as typed: search
always answers. Python stdlib only.
"""

import hashlib
import http.client
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = urllib.parse.urlsplit(os.environ.get("IMMICH_UPSTREAM", "http://immich_server:2283"))
PORT = int(os.environ.get("PORT", "8080"))
LLM_URL = os.environ.get("LLM_URL", "http://memories-llm:11434/v1").rstrip("/")
LLM_KEY = os.environ.get("LLM_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3:4b")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "12"))
# "schema" (Ollama, OpenAI, Gemini, Mistral), "object" (DeepSeek: JSON mode without a
# schema) or "none" (just ask nicely and parse).
LLM_JSON = os.environ.get("LLM_JSON", "schema")
# Extra JSON merged into the chat request, e.g. {"reasoning_effort": "none"}.
LLM_EXTRA = json.loads(os.environ.get("LLM_EXTRA", "{}") or "{}")

SEASONS = {"spring": (3, 5), "summer": (6, 8), "autumn": (9, 11), "winter": (12, 2)}

# The LLM only does what rules can't: who, what is in the picture (in English, for CLIP),
# where. Dates, photo/video and favourites come from rules (see `rules`): small models on a
# CPU are slow at long JSON and get dates wrong, and a three-field answer takes a second or two.
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "people": {"type": "array", "items": {"type": "string"}},
        "visual": {"type": "string"},
        "place": {"type": "string"},
    },
    "required": ["people", "visual", "place"],
    "additionalProperties": False,
}

SYSTEM = """You read a photo-search request (usually Italian) and answer with JSON:
- people: names of people in the request, as written. Never things, animals, places or dates.
- visual: what is visible in the photo, as a short English description for an image search ("eating", "dogs in the snow", "birthday cake", "selfie in the mountains"). No people's names, no towns or countries, no dates or years. "" when there is nothing to see besides people/places/dates.
- place: a town, city, region or country named in the request, else "". Not "mare", "montagna" or other kinds of places: those go in visual.
Known people: {people}.

Examples:
"foto di marci che mangia" -> {{"people":["marci"],"visual":"eating","place":""}}
"video di luca e sara a parigi nel 2023" -> {{"people":["luca","sara"],"visual":"","place":"parigi"}}
"cani che giocano sulla spiaggia" -> {{"people":[],"visual":"dogs playing on the beach","place":""}}
Answer with the JSON only."""

_cache_guard = threading.Lock()
_auth_cache: dict[str, float] = {}
_people_cache: dict[str, tuple[float, list[dict]]] = {}
_places_cache: dict[str, tuple[float, dict[str, list[str]]]] = {}
_plan_cache: dict[str, tuple[float, dict]] = {}


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), *a, file=sys.stderr, flush=True)


def fold(s: str) -> str:
    """lowercase, no accents, single spaces"""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


# MARK: Immich

def immich(method: str, path: str, creds: dict, body=None, timeout=30):
    port = UPSTREAM.port or (443 if UPSTREAM.scheme == "https" else 80)
    cls = http.client.HTTPSConnection if UPSTREAM.scheme == "https" else http.client.HTTPConnection
    conn = cls(UPSTREAM.hostname, port, timeout=timeout)
    headers = {**creds, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    try:
        conn.request(method, path, body=data, headers=headers)
        res = conn.getresponse()
        return res.status, res.read()
    finally:
        conn.close()


def creds_of(h) -> dict:
    return {k: h.get(k) for k in ("Authorization", "x-api-key") if h.get(k)}


def key_of(creds: dict) -> str:
    return hashlib.sha256(json.dumps(creds, sort_keys=True).encode()).hexdigest()


def check_auth(creds: dict) -> int:
    if not creds:
        return 401
    k, now = key_of(creds), time.time()
    with _cache_guard:
        if _auth_cache.get(k, 0) > now:
            return 200
    try:
        status, _ = immich("GET", "/api/users/me", creds, timeout=10)
    except OSError:
        return 502
    if status == 200:
        with _cache_guard:
            _auth_cache[k] = now + 120
    return status


def named_people(creds: dict) -> list[dict]:
    """The caller's people with a name, cached a minute (names are added from the app)."""
    k, now = key_of(creds), time.time()
    with _cache_guard:
        hit = _people_cache.get(k)
        if hit and hit[0] > now:
            return hit[1]
    people, page = [], 1
    while page <= 20:
        status, body = immich("GET", f"/api/people?withHidden=false&size=500&page={page}", creds)
        if status != 200:
            break
        res = json.loads(body)
        people += [{"id": p["id"], "name": p["name"]} for p in res.get("people", []) if p.get("name")]
        if not res.get("hasNextPage"):
            break
        page += 1
    with _cache_guard:
        _people_cache[k] = (now + 60, people)
    return people


def known_places(creds: dict) -> dict[str, list[str]]:
    """Countries and cities in the caller's library (Immich's own spelling), cached 30 min."""
    k, now = key_of(creds), time.time()
    with _cache_guard:
        hit = _places_cache.get(k)
        if hit and hit[0] > now:
            return hit[1]
    places = {}
    for kind in ("country", "city"):
        try:
            status, body = immich("GET", f"/api/search/suggestions?type={kind}", creds)
            places[kind] = [p for p in json.loads(body) if p] if status == 200 else []
        except (OSError, ValueError):
            places[kind] = []
    with _cache_guard:
        _places_cache[k] = (now + 1800, places)
    return places


# Italian names Immich's geocoder spells differently.
PLACE_ALIASES = {
    "italia": "italy", "francia": "france", "spagna": "spain", "germania": "germany",
    "inghilterra": "united kingdom", "regno unito": "united kingdom", "svizzera": "switzerland",
    "grecia": "greece", "portogallo": "portugal", "olanda": "netherlands", "paesi bassi": "netherlands",
    "stati uniti": "united states of america", "america": "united states of america",
    "giappone": "japan", "croazia": "croatia", "austria": "austria", "belgio": "belgium",
    "parigi": "paris", "londra": "london", "monaco di baviera": "munich", "vienna": "vienna",
    "lisbona": "lisbon", "barcellona": "barcelona", "atene": "athens", "praga": "prague",
    "roma": "rome", "milano": "milan", "napoli": "naples", "firenze": "florence", "venezia": "venice",
    "torino": "turin", "genova": "genoa", "padova": "padua", "siviglia": "seville", "berlino": "berlin",
}


def match_place(name: str, places: dict[str, list[str]]):
    """-> ("city"|"country", Immich's spelling) or None"""
    f = fold(name)
    if not f:
        return None
    candidates = {f, fold(PLACE_ALIASES.get(f, f))}
    for kind in ("city", "country"):
        for p in places.get(kind, []):
            if fold(p) in candidates:
                return kind, p
    return None


def match_people(names: list[str], people: list[dict]):
    """-> (person ids, names not found). Exact name, then first name, then prefix."""
    ids, missing = [], []
    for n in names:
        f = fold(n)
        if not f:
            continue
        exact = [p for p in people if fold(p["name"]) == f]
        first = [p for p in people if fold(p["name"]).split(" ")[0] == f]
        prefix = [p for p in people if fold(p["name"]).startswith(f)]
        hit = exact or first or prefix
        if hit:
            ids += [p["id"] for p in hit if p["id"] not in ids]
        else:
            missing.append(n)
    return ids, missing


# MARK: LLM

def ask_llm(query: str, people: list[dict]) -> dict:
    # Same text all day for a given set of names, so Ollama reuses the cached prompt.
    system = SYSTEM.format(people=", ".join(sorted({p["name"] for p in people})[:300]) or "none")
    body = {
        "model": LLM_MODEL,
        "temperature": 0,
        "max_tokens": 200,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": query}],
        **LLM_EXTRA,
    }
    if LLM_JSON == "schema":
        body["response_format"] = {"type": "json_schema",
                                   "json_schema": {"name": "plan", "schema": PLAN_SCHEMA, "strict": True}}
    elif LLM_JSON == "object":
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(LLM_URL + "/chat/completions", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {LLM_KEY}"} if LLM_KEY else {})})
    with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as res:
        out = json.loads(res.read())
    text = out["choices"][0]["message"].get("content") or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        raise ValueError(f"no JSON in {text[:200]!r}")
    return clean_llm(json.loads(m.group(0)), query)


def clean_llm(raw: dict, query: str) -> dict:
    """Keeps only what the sentence actually says: small models copy examples and invent."""
    q = f" {fold(query)} "
    people = []
    for p in raw.get("people") or []:
        f = fold(str(p))
        if (f and f" {f} " in q and f not in people and not re.search(r"\d", f)
                and not set(f.split()) & NOT_PEOPLE):
            people.append(f)
    place = fold(str(raw.get("place") or ""))
    if not place or f" {place} " not in q or place in NOT_PLACES:
        place = ""
    visual = str(raw.get("visual") or "").strip()[:200]
    return {"people": people[:10], "visual": visual, "place": place}


# MARK: Rules (dates, photo/video, favourites)

MONTHS = {m: i + 1 for i, m in enumerate(
    "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre".split())}
MONTHS.update({m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october november december".split())})
SEASON_WORDS = {"primavera": "spring", "estate": "summer", "autunno": "autumn", "inverno": "winter",
                "spring": "spring", "summer": "summer", "autumn": "autumn", "fall": "autumn", "winter": "winter"}
NOT_PLACES = {"mare", "montagna", "spiaggia", "lago", "campagna", "citta", "casa", "neve", "parco", "bosco"}
# Words small models like to call people.
NOT_PEOPLE = set(MONTHS) | set(SEASON_WORDS) | NOT_PLACES | {
    "amici", "amiche", "amico", "amica", "famiglia", "bambini", "bambino", "bambina", "figli", "figlio",
    "figlia", "gente", "persone", "tutti", "noi", "io", "friends", "family", "kids", "people", "natale",
    "foto", "video", "selfie", "cane", "cani", "gatto", "gatti"}
UNIT_DAYS = {"giorn": 1, "day": 1, "settiman": 7, "week": 7, "mes": 30, "month": 30, "ann": 365, "year": 365}


def rules(query: str, today: date) -> dict:
    q = fold(query)
    out = {"media": "any", "favorite": False, "span": None, "when": ""}
    if re.search(r"\b(video|filmat\w*|clip)\b", q):
        out["media"] = "video"
    elif re.search(r"\bsolo (le )?foto\b|\bonly photos\b", q):
        out["media"] = "photo"
    if re.search(r"\b(preferit\w*|favorit\w*|favourit\w*|stellin\w*|cuor\w*)\b", q):
        out["favorite"] = True

    # Rolling windows: "ultimo mese", "ultime 2 settimane", "ieri", "questo mese".
    m = re.search(r"\b(?:ultim[oaie]|last|past|scors[oaie])\s+(\d+\s+)?(giorn|settiman|mes|ann|day|week|month|year)\w*", q)
    m2 = re.search(r"\b(giorn|settiman|mes)\w*\s+(?:scors|passat)\w*", q)
    if m2 and not m:
        out["span"] = (today - timedelta(days=UNIT_DAYS[m2.group(1)]), today + timedelta(days=1))
        out["when"] = m2.group(0)
        return out
    if m and not re.search(r"\b(anno scorso|anno passato|last year)\b", q):
        n = int(m.group(1) or 1)
        days = n * UNIT_DAYS[m.group(2)]
        out["span"] = (today - timedelta(days=days), today + timedelta(days=1))
        out["when"] = m.group(0)
        return out
    if re.search(r"\boggi\b|\btoday\b", q):
        out["span"], out["when"] = (today, today + timedelta(days=1)), "oggi"
        return out
    if re.search(r"\bieri\b|\byesterday\b", q):
        out["span"], out["when"] = (today - timedelta(days=1), today), "ieri"
        return out
    if re.search(r"\bquest[oa] settimana\b|\bthis week\b", q):
        start = today - timedelta(days=today.weekday())
        out["span"], out["when"] = (start, today + timedelta(days=1)), "questa settimana"
        return out
    if re.search(r"\bquesto mese\b|\bthis month\b", q):
        out["span"], out["when"] = (today.replace(day=1), today + timedelta(days=1)), "questo mese"
        return out

    # Years: explicit, "l'anno scorso", "quest'anno", "3 anni fa".
    years = [int(y) for y in re.findall(r"\b(19[5-9]\d|20\d\d)\b", q)]
    if re.search(r"\b(anno scorso|anno passato|last year)\b", q):
        years.append(today.year - 1)
    if re.search(r"\b(quest anno|this year)\b", q):
        years.append(today.year)
    for n in re.findall(r"\b(\d+) anni fa\b", q):
        years.append(today.year - int(n))
    y1, y2 = (min(years), max(years)) if years else (0, 0)

    month = 0
    for w, i in MONTHS.items():
        if re.search(rf"\b{w}\b", q):
            month = i
            break
    if not month and re.search(r"\bnatale\b|\bchristmas\b", q):
        month = 12
    season = ""
    for w, name in SEASON_WORDS.items():
        if re.search(rf"\b{w}\b", q):
            season = name
            break
    last = bool(re.search(r"\b(scors[oaie]|passat[oaie]|last)\b", q))

    if season and (y1 or last):
        a, b = SEASONS[season]
        if not y1:  # the last one that is over
            if season == "winter":  # a winter is named by the year of its December
                y1 = today.year - 2 if today.month <= 2 else today.year - 1
            else:
                y1 = today.year if today.month > b else today.year - 1
            y2 = y1
        if season == "winter":
            out["span"] = (date(y1, 12, 1), date(y2 + 1, 3, 1))
        else:
            out["span"] = (date(y1, a, 1), date(y2, b + 1, 1))
        out["when"] = f"{season} {y1}" + (f"-{y2}" if y2 != y1 else "")
    elif month and (y1 or last):
        if not y1:
            y1 = y2 = today.year if month < today.month else today.year - 1
        out["span"] = (date(y1, month, 1), date(y2, month + 1, 1) if month < 12 else date(y2 + 1, 1, 1))
        out["when"] = f"{month:02d}/{y1}" + (f"-{y2}" if y2 != y1 else "")
    elif y1:
        out["span"] = (date(y1, 1, 1), date(y2 + 1, 1, 1))
        out["when"] = f"{y1}" + (f"-{y2}" if y2 != y1 else "")
    # A month or season with no year ("d'estate", "a dicembre") would mean every one of them,
    # which a single date range can't say: the visual search gets the hint instead.
    elif season:
        out["hint"] = season
    elif month:
        out["hint"] = "christmas" if re.search(r"\bnatale\b", q) else ""
    return out


def spot_people(query: str, people: list[dict]) -> list[str]:
    """Known names written in the sentence, longest first ("nonna pina" before "pina")."""
    q = f" {fold(query)} "
    found = []
    for name in sorted({fold(p["name"]) for p in people}, key=len, reverse=True):
        if name and f" {name} " in q and not any(name in f for f in found):
            found.append(name)
    return found


# MARK: Search

def plan_for(query: str, creds: dict, people: list[dict]):
    """-> (LLM plan or None, error or None, seconds); cached per user + sentence for an hour."""
    k = key_of(creds) + "|" + fold(query) + "|" + str(len(people))
    now = time.time()
    with _cache_guard:
        hit = _plan_cache.get(k)
        if hit and hit[0] > now:
            return hit[1], None, 0.0
    started = time.time()
    try:
        plan = ask_llm(query, people)
    except Exception as e:  # anything at all: search must still answer
        return None, f"{type(e).__name__}: {e}"[:300], time.time() - started
    with _cache_guard:
        if len(_plan_cache) > 2000:
            _plan_cache.clear()
        _plan_cache[k] = (now + 3600, plan)
    return plan, None, time.time() - started


def iso(d: date) -> str:
    return datetime.combine(d, datetime.min.time()).isoformat() + ".000Z"


def run_search(query: str, page: int, size: int, creds: dict, with_exif: bool):
    today = date.today()
    people = named_people(creds)
    plan, error, took = plan_for(query, creds, people)
    r = rules(query, today)
    info = {"query": query, "model": LLM_MODEL, "seconds": round(took, 2)}

    # Without the LLM: rules + the names we can spot, and the sentence as typed for CLIP.
    if plan is None:
        log("LLM fallback:", error)
        info.update(fallback=True, error=error)
        plan = {"people": [], "visual": query, "place": ""}
    else:
        info["fallback"] = False

    names = plan["people"] + [n for n in spot_people(query, people) if n not in plan["people"]]
    person_ids, missing = match_people(names, people)
    visual = plan["visual"]
    dto = {"page": page, "size": size, "withExif": with_exif}
    if person_ids:
        dto["personIds"] = person_ids
    if r["media"] == "photo":
        dto["type"] = "IMAGE"
    elif r["media"] == "video":
        dto["type"] = "VIDEO"
    if r["favorite"]:
        dto["isFavorite"] = True
    if r["span"]:
        dto["takenAfter"], dto["takenBefore"] = iso(r["span"][0]), iso(r["span"][1])
    if r.get("hint") and not info["fallback"]:
        visual = f"{visual}, {r['hint']}".strip(", ")
    place = None
    if plan["place"]:
        place = match_place(plan["place"], known_places(creds))
        if place:
            dto[place[0]] = place[1]
        elif not info["fallback"]:
            # Not a place Immich knows by that name: let CLIP look for it instead.
            visual = f"{visual}, {plan['place']}".strip(", ")

    info.update(people=names, personIds=person_ids, missingPeople=missing, visual=visual,
                place=list(place) if place else None, media=r["media"], favorite=r["favorite"],
                when=r["when"], takenAfter=dto.get("takenAfter"), takenBefore=dto.get("takenBefore"))
    if visual:
        dto["query"] = visual
        info["endpoint"] = "smart"
        status, body = immich("POST", "/api/search/smart", creds, dto)
    else:
        dto["order"] = "desc"
        info["endpoint"] = "metadata"
        status, body = immich("POST", "/api/search/metadata", creds, dto)
    return status, body, info


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "memories-search/1"

    def log_message(self, fmt, *args):
        log(self.address_string(), fmt % args)

    def reply(self, status: int, body: bytes | dict):
        if isinstance(body, dict):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path.rstrip("/").endswith("/memories/search/config"):
            return self.reply(200, {"version": 1, "model": LLM_MODEL})
        self.reply(404, {"message": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if 0 < n <= 64 * 1024 else b""
        if not urllib.parse.urlsplit(self.path).path.rstrip("/").endswith("/memories/search"):
            return self.reply(404, {"message": "not found"})
        try:
            req = json.loads(raw or b"{}")
            query = str(req.get("query", "")).strip()[:500]
            page = max(1, int(req.get("page", 1)))
            size = min(250, max(1, int(req.get("size", 100))))
            with_exif = bool(req.get("withExif", False))
        except (ValueError, TypeError):
            return self.reply(400, {"message": "bad request"})
        if not query:
            return self.reply(400, {"message": "query is empty"})
        creds = creds_of(self.headers)
        status = check_auth(creds)
        if status != 200:
            return self.reply(401 if status in (401, 403) else 502, {"message": "not signed in to Immich"})
        try:
            status, body, info = run_search(query, page, size, creds, with_exif)
        except OSError as e:
            return self.reply(502, {"message": f"Immich didn't answer: {e}"})
        log("search", json.dumps(info, ensure_ascii=False))
        if status != 200:
            return self.reply(status, body)
        try:
            out = json.loads(body)
        except ValueError:
            return self.reply(502, {"message": "Immich answered something that isn't JSON"})
        out["memories"] = info
        self.reply(200, out)


def warm_up():
    """Loads the model once at start (a cold local model takes ~30 s, longer than LLM_TIMEOUT)."""
    global LLM_TIMEOUT
    saved, LLM_TIMEOUT = LLM_TIMEOUT, 180
    try:
        started = time.time()
        ask_llm("foto di marci che mangia", [])
        log(f"LLM warm in {time.time() - started:.1f}s")
    except Exception as e:
        log("LLM warm-up failed:", e)
    finally:
        LLM_TIMEOUT = saved


def main():
    threading.Thread(target=warm_up, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    log(f"memories-search on :{PORT}, LLM {LLM_MODEL} at {LLM_URL} ({LLM_JSON}), upstream {UPSTREAM.geturl()}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
