# /// script
# requires-python = ">=3.11"
# dependencies = ["pyjwt", "cryptography"]
# ///
"""Drive App Store Connect from an app's `store/` folder.

Adapted from cassette's store/asc/asc.py. One script for every homelab iOS app:
`--store` names the folder, whose `store.json` says which app it is.

    export ASC_KEY_ID=MFCGJ8UX92 ASC_ISSUER_ID=f8b76e45-dfdd-4938-916a-f2840dde0f09
    uv run tools/asc/asc.py --store apps/memories/ios/store status


Everything App Store Connect's API can set for a submission, read from the
files that already hold it, so a submission is a sequence of commands rather
than an afternoon of pasting into web forms:

    PY="uv run tools/asc/asc.py --store <app>/store"   # key at ~/.appstoreconnect/private_keys/
    $PY status
    $PY metadata                       # name, subtitle, description, URLs, categories
    $PY age-rating
    $PY pricing                        # free, every territory
    $PY review --first Davide --last Ghiotto --phone +39... --email ...
    $PY screenshots APP_IPHONE_67 screenshots/6.9
    $PY build --wait 3                 # attach build 3 once it has processed
    $PY submit

Two things Apple's API does not offer and that stay in the web UI: creating the
app record, and the App Privacy questionnaire (`privacy/app-privacy-answers.md`).

Nothing here prints a secret: the demo password is read from the gitignored
`review/demo-credentials.md` and sent, never echoed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import jwt

API = "https://api.appstoreconnect.apple.com"
LOCALE = "en-US"
#: Set by main() from --store.
STORE = Path("store")
CONF: dict = {}


# --- HTTP -------------------------------------------------------------------


def _token() -> str:
    key_id = os.environ["ASC_KEY_ID"]
    issuer = os.environ["ASC_ISSUER_ID"]
    key_path = Path(
        os.environ.get(
            "ASC_KEY_PATH", Path.home() / f".appstoreconnect/private_keys/AuthKey_{key_id}.p8"
        )
    )
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"},
        key_path.read_text(),
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def call(method: str, path: str, body: dict | None = None, ok: tuple[int, ...] = ()) -> dict:
    url = path if path.startswith("http") else f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {_token()}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        if exc.code in ok:
            return {"_status": exc.code}
        detail = exc.read().decode(errors="replace")
        try:
            errors = json.loads(detail).get("errors", [])
            detail = "; ".join(
                f"{e.get('code')}: {e.get('detail') or e.get('title')}"
                + (f" ({e['source'].get('pointer')})" if e.get("source") else "")
                for e in errors
            )
        except ValueError:
            pass
        sys.exit(f"{method} {path} -> {exc.code}: {detail}")


def get(path: str) -> dict:
    return call("GET", path)


def every(path: str) -> list[dict]:
    """All pages of a collection."""
    out: list[dict] = []
    url: str | None = path
    while url:
        page = get(url)
        out.extend(page.get("data", []))
        url = page.get("links", {}).get("next")
    return out


# --- Lookups ------------------------------------------------------------------


def app() -> dict:
    bundle_id = CONF["bundle_id"]
    found = [a for a in get(f"/v1/apps?filter[bundleId]={bundle_id}")["data"]
             if a["attributes"]["bundleId"] == bundle_id]
    if not found:
        sys.exit(
            f"No app record for {bundle_id}. Create it in App Store Connect "
            "(My Apps -> + -> New App) — the API cannot."
        )
    return found[0]


def editable_version(app_id: str) -> dict:
    versions = get(f"/v1/apps/{app_id}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
    editable = {
        "PREPARE_FOR_SUBMISSION",
        "DEVELOPER_REJECTED",
        "REJECTED",
        "METADATA_REJECTED",
        "INVALID_BINARY",
    }
    for v in versions:
        if v["attributes"].get("appStoreState") in editable:
            return v
    sys.exit("No editable App Store version. States: " + ", ".join(
        f"{v['attributes']['versionString']}={v['attributes'].get('appStoreState')}" for v in versions
    ))


def editable_app_info(app_id: str) -> dict:
    infos = get(f"/v1/apps/{app_id}/appInfos")["data"]
    for info in infos:
        if info["attributes"].get("appStoreState") != "READY_FOR_SALE":
            return info
    return infos[0]


def text(name: str) -> str:
    return (STORE / "listing" / name).read_text().strip()


def first_line(name: str) -> str:
    return text(name).splitlines()[0].strip()


def urls() -> dict[str, str]:
    out = {}
    for line in text("urls.txt").splitlines():
        m = re.match(r"^(Support|Marketing|Privacy Policy) URL:\s+(\S+)", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def localization(collection: list[dict]) -> dict:
    for loc in collection:
        if loc["attributes"].get("locale") == LOCALE:
            return loc
    sys.exit(f"No {LOCALE} localization; locales: {[c['attributes'].get('locale') for c in collection]}")


# --- Commands -----------------------------------------------------------------


def cmd_status(_: argparse.Namespace) -> None:
    a = app()
    print("app", a["id"], a["attributes"]["name"], a["attributes"].get("contentRightsDeclaration"))
    for v in get(f"/v1/apps/{a['id']}/appStoreVersions?filter[platform]=IOS")["data"]:
        at = v["attributes"]
        print("version", at["versionString"], at.get("appStoreState"), at.get("releaseType"))
    builds = get(f"/v1/builds?filter[app]={a['id']}&sort=-uploadedDate&limit=5")["data"]
    for b in builds:
        at = b["attributes"]
        print("build", at["version"], at["processingState"], at.get("uploadedDate"))
    subs = get(f"/v1/reviewSubmissions?filter[app]={a['id']}&limit=5")["data"]
    for s in subs:
        print("review submission", s["id"], s["attributes"].get("state"))


def cmd_metadata(_: argparse.Namespace) -> None:
    a = app()
    u = urls()
    info = editable_app_info(a["id"])
    call("PATCH", f"/v1/appInfos/{info['id']}", {
        "data": {
            "type": "appInfos",
            "id": info["id"],
            "relationships": {
                "primaryCategory": {"data": {"type": "appCategories", "id": CONF["primary_category"]}},
                "secondaryCategory": {"data": {"type": "appCategories", "id": CONF["secondary_category"]}},
            },
        }
    })
    loc = localization(every(f"/v1/appInfos/{info['id']}/appInfoLocalizations"))
    call("PATCH", f"/v1/appInfoLocalizations/{loc['id']}", {
        "data": {
            "type": "appInfoLocalizations",
            "id": loc["id"],
            "attributes": {
                "name": first_line("name.txt"),
                "subtitle": first_line("subtitle.txt"),
                "privacyPolicyUrl": u["Privacy Policy"],
            },
        }
    })
    # USES_THIRD_PARTY_CONTENT when the demo account shows CC/public-domain
    # media we have the rights to show; the user's own server is theirs.
    call("PATCH", f"/v1/apps/{a['id']}", {
        "data": {
            "type": "apps",
            "id": a["id"],
            "attributes": {"contentRightsDeclaration": CONF["content_rights"]},
        }
    })

    version = editable_version(a["id"])
    call("PATCH", f"/v1/appStoreVersions/{version['id']}", {
        "data": {
            "type": "appStoreVersions",
            "id": version["id"],
            "attributes": {
                "versionString": _app_version(),
                "copyright": first_line("copyright.txt"),
                "releaseType": "AFTER_APPROVAL",
            },
        }
    })
    vloc = localization(every(f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations"))
    attributes = {
        "description": text("description.txt"),
        "keywords": first_line("keywords.txt"),
        "promotionalText": text("promotional-text.txt"),
        "supportUrl": u["Support"],
    }
    if u.get("Marketing"):
        attributes["marketingUrl"] = u["Marketing"]
    # "What's New" is refused until a version has been released — whatever this
    # one is numbered. 1.0 was rejected and renamed 1.1.0, still the first release.
    released = get(
        f"/v1/apps/{a['id']}/appStoreVersions?filter[platform]=IOS"
        "&filter[appStoreState]=READY_FOR_SALE&limit=1"
    )["data"]
    if released:
        attributes["whatsNew"] = text("whats-new.txt")
    call("PATCH", f"/v1/appStoreVersionLocalizations/{vloc['id']}", {
        "data": {"type": "appStoreVersionLocalizations", "id": vloc["id"], "attributes": attributes}
    })
    print("metadata set on", version["attributes"]["versionString"], "->", _app_version())


def _app_version() -> str:
    return CONF["version"]


def cmd_age_rating(_: argparse.Namespace) -> None:
    """Every content question None/No — see store/privacy/age-rating-answers.md.

    The questionnaire grows (2025 added capability questions), so this answers
    whatever the declaration currently has rather than a fixed list: a level
    question gets NONE and a yes/no question gets false. Overrides are left
    alone. Prints what it set, so a new question is visible rather than
    silently answered.
    """
    a = app()
    info = editable_app_info(a["id"])
    decl = get(f"/v1/appInfos/{info['id']}/ageRatingDeclaration")["data"]
    skip = {"kidsAgeBand", "ageRatingOverride", "ageRatingOverrideV2", "koreaAgeRatingOverride",
            "seventeenPlus", "developerAgeRatingInfoUrl", "gracRatingClassificationNumber"}
    answers: dict[str, object] = {}
    for key, value in decl["attributes"].items():
        if key in skip:
            continue
        if isinstance(value, bool) or value is None and _looks_boolean(key):
            answers[key] = False
        elif isinstance(value, str) or value is None:
            answers[key] = "NONE"
    res = call("PATCH", f"/v1/ageRatingDeclarations/{decl['id']}", {
        "data": {"type": "ageRatingDeclarations", "id": decl["id"], "attributes": answers}
    })
    for key, value in sorted(res["data"]["attributes"].items()):
        print(f"  {key}: {value}")


def _looks_boolean(key: str) -> bool:
    return key in {
        "gambling", "unrestrictedWebAccess", "lootBox", "messagingAndChat", "userGeneratedContent",
        "advertising", "ageAssurance", "parentalControls", "healthOrWellnessTopics",
        "socialMedia", "socialMediaAgeRestricted",
    }


def cmd_pricing(_: argparse.Namespace) -> None:
    a = app()
    points = every(f"/v1/apps/{a['id']}/appPricePoints?filter[territory]=USA&limit=200")
    free = next((p for p in points if float(p["attributes"]["customerPrice"]) == 0.0), None)
    if not free:
        sys.exit("No free price point for USA.")
    call("POST", "/v1/appPriceSchedules", {
        "data": {
            "type": "appPriceSchedules",
            "relationships": {
                "app": {"data": {"type": "apps", "id": a["id"]}},
                "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
                "manualPrices": {"data": [{"type": "appPrices", "id": "${free}"}]},
            },
        },
        "included": [{
            "type": "appPrices",
            "id": "${free}",
            "attributes": {"startDate": None},
            "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": free["id"]}}},
        }],
    })
    print("price: free")

    existing = call("GET", f"/v1/apps/{a['id']}/appAvailabilityV2", ok=(404,))
    if existing.get("_status") != 404 and existing.get("data"):
        print("availability already set")
        return
    territories = every("/v1/territories?limit=200")
    call("POST", "/v2/appAvailabilities", {
        "data": {
            "type": "appAvailabilities",
            "attributes": {"availableInNewTerritories": True},
            "relationships": {
                "app": {"data": {"type": "apps", "id": a["id"]}},
                "territoryAvailabilities": {
                    "data": [{"type": "territoryAvailabilities", "id": f"${{{t['id']}}}"}
                             for t in territories]
                },
            },
        },
        "included": [{
            "type": "territoryAvailabilities",
            "id": f"${{{t['id']}}}",
            "attributes": {"available": True},
            "relationships": {"territory": {"data": {"type": "territories", "id": t["id"]}}},
        } for t in territories],
    })
    print(f"available in {len(territories)} territories, and new ones")


def _demo_credentials() -> tuple[str, str]:
    raw = (STORE / "review/demo-credentials.md").read_text()
    email = re.search(r"^\s*Email:\s*(\S+)", raw, re.M)
    password = re.search(r"^\s*Password:\s*(\S+)", raw, re.M)
    if not (email and password):
        sys.exit("store/review/demo-credentials.md has no Email:/Password: lines.")
    return email.group(1), password.group(1)


def cmd_review(args: argparse.Namespace) -> None:
    a = app()
    version = editable_version(a["id"])
    login, password = _demo_credentials()  # noqa
    notes = (STORE / "review/app-review-notes.md").read_text()
    # The file is written for people: drop its first heading and the paste hint.
    notes = re.sub(r"^# .*\n+(Paste into .*\n+)?", "", notes).strip()
    # Apple caps the field at 4000; cutting it would drop whatever section is last.
    if len(notes) > 4000:
        sys.exit(f"Review notes are {len(notes)} characters; App Store Connect takes 4000.")
    attributes = {
        "contactFirstName": args.first,
        "contactLastName": args.last,
        "contactPhone": args.phone,
        "contactEmail": args.email,
        "demoAccountName": login,
        "demoAccountPassword": password,
        "demoAccountRequired": True,
        "notes": notes,
    }
    existing = call("GET", f"/v1/appStoreVersions/{version['id']}/appStoreReviewDetail", ok=(404,))
    if existing.get("data"):
        rid = existing["data"]["id"]
        call("PATCH", f"/v1/appStoreReviewDetails/{rid}", {
            "data": {"type": "appStoreReviewDetails", "id": rid, "attributes": attributes}
        })
    else:
        call("POST", "/v1/appStoreReviewDetails", {
            "data": {
                "type": "appStoreReviewDetails",
                "attributes": attributes,
                "relationships": {
                    "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}
                },
            }
        })
    print(f"review details set ({len(notes)} chars of notes; demo login {login})")


def cmd_screenshots(args: argparse.Namespace) -> None:
    """`screenshots APP_IPHONE_67 screenshots/6.9` (6.9" shots, 1320x2868, go in
    the slot the API still calls 6.7"); `APP_IPAD_PRO_3GEN_129` for 13" iPad."""
    SCREENSHOT_TYPE = args.display_type
    folder = Path(args.folder)
    if not folder.is_absolute():
        folder = STORE / folder
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    if not files:
        sys.exit(f"No screenshots in {folder}")
    a = app()
    version = editable_version(a["id"])
    vloc = localization(every(f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations"))
    sets = every(f"/v1/appStoreVersionLocalizations/{vloc['id']}/appScreenshotSets")
    target = next((s for s in sets if s["attributes"]["screenshotDisplayType"] == SCREENSHOT_TYPE), None)
    if target is None:
        target = call("POST", "/v1/appScreenshotSets", {
            "data": {
                "type": "appScreenshotSets",
                "attributes": {"screenshotDisplayType": SCREENSHOT_TYPE},
                "relationships": {
                    "appStoreVersionLocalization": {
                        "data": {"type": "appStoreVersionLocalizations", "id": vloc["id"]}
                    }
                },
            }
        })["data"]
    # Replace, so a re-run after a re-capture does not append a second copy.
    for old in every(f"/v1/appScreenshotSets/{target['id']}/appScreenshots"):
        call("DELETE", f"/v1/appScreenshots/{old['id']}")

    for path in files:
        blob = path.read_bytes()
        shot = call("POST", "/v1/appScreenshots", {
            "data": {
                "type": "appScreenshots",
                "attributes": {"fileName": path.name, "fileSize": len(blob)},
                "relationships": {
                    "appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": target["id"]}}
                },
            }
        })["data"]
        for op in shot["attributes"]["uploadOperations"]:
            chunk = blob[op["offset"]: op["offset"] + op["length"]]
            req = urllib.request.Request(op["url"], data=chunk, method=op["method"])
            for h in op.get("requestHeaders", []):
                req.add_header(h["name"], h["value"])
            urllib.request.urlopen(req, timeout=120).read()
        call("PATCH", f"/v1/appScreenshots/{shot['id']}", {
            "data": {
                "type": "appScreenshots",
                "id": shot["id"],
                "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(blob).hexdigest()},
            }
        })
        print("uploaded", path.name)

    # Wait for Apple to process them; a failed asset is reported, not hidden.
    for _ in range(30):
        states = [
            s["attributes"].get("assetDeliveryState", {}).get("state")
            for s in every(f"/v1/appScreenshotSets/{target['id']}/appScreenshots")
        ]
        if all(st == "COMPLETE" for st in states):
            print(f"{len(states)} screenshots processed")
            return
        if "FAILED" in states:
            sys.exit(f"A screenshot failed processing: {states}")
        time.sleep(5)
    print("screenshots still processing:", states)


def cmd_build(args: argparse.Namespace) -> None:
    a = app()
    version = editable_version(a["id"])
    number = str(args.number)
    deadline = time.time() + (args.wait * 60 if args.wait else 0)
    while True:
        builds = get(
            f"/v1/builds?filter[app]={a['id']}&filter[version]={number}"
            f"&filter[preReleaseVersion.version]={_app_version()}"
        )["data"]
        state = builds[0]["attributes"]["processingState"] if builds else "NOT_UPLOADED"
        if state == "VALID":
            break
        if state in ("FAILED", "INVALID"):
            sys.exit(f"Build {number} is {state}.")
        if time.time() > deadline:
            sys.exit(f"Build {number} is {state}; try again with --wait.")
        print(f"build {number}: {state}, waiting")
        time.sleep(30)
    build = builds[0]
    call("PATCH", f"/v1/appStoreVersions/{version['id']}/relationships/build", {
        "data": {"type": "builds", "id": build["id"]}
    })
    print(f"build {number} attached to {_app_version()}")


def cmd_submit(_: argparse.Namespace) -> None:
    a = app()
    version = editable_version(a["id"])
    # A rejection leaves its submission UNRESOLVED_ISSUES rather than closing it;
    # resubmitting is submitting that one again, and Apple refuses a second.
    open_subs = [
        s for s in get(f"/v1/reviewSubmissions?filter[app]={a['id']}&filter[platform]=IOS")["data"]
        if s["attributes"].get("state") in ("READY_FOR_REVIEW", "UNRESOLVED_ISSUES")
    ]
    if open_subs:
        sub = open_subs[0]
    else:
        sub = call("POST", "/v1/reviewSubmissions", {
            "data": {
                "type": "reviewSubmissions",
                "attributes": {"platform": "IOS"},
                "relationships": {"app": {"data": {"type": "apps", "id": a["id"]}}},
            }
        })["data"]
    # A draft left by an earlier attempt can be empty — the item is what Apple
    # refuses when something is missing — so the version is attached either way.
    items = get(f"/v1/reviewSubmissions/{sub['id']}/items")["data"]
    # A rejected item blocks the whole submission (409 ENTITY_STATE_INVALID) until it
    # is marked resolved — which is what the web UI's "Resubmit" does first.
    for item in items:
        if item["attributes"].get("state") == "REJECTED":
            call("PATCH", f"/v1/reviewSubmissionItems/{item['id']}", {
                "data": {"type": "reviewSubmissionItems", "id": item["id"],
                         "attributes": {"resolved": True}}
            })
    if not items:
        call("POST", "/v1/reviewSubmissionItems", {
            "data": {
                "type": "reviewSubmissionItems",
                "relationships": {
                    "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                    "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}},
                },
            }
        })
    res = call("PATCH", f"/v1/reviewSubmissions/{sub['id']}", {
        "data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}
    })
    print("submitted:", res["data"]["attributes"].get("state"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--store", required=True, help="the app's store/ folder (holds store.json)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("metadata").set_defaults(fn=cmd_metadata)
    sub.add_parser("age-rating").set_defaults(fn=cmd_age_rating)
    sub.add_parser("pricing").set_defaults(fn=cmd_pricing)
    review = sub.add_parser("review")
    review.add_argument("--first", required=True)
    review.add_argument("--last", required=True)
    review.add_argument("--phone", required=True)
    review.add_argument("--email", required=True)
    review.set_defaults(fn=cmd_review)
    shots = sub.add_parser("screenshots")
    shots.add_argument("display_type")
    shots.add_argument("folder")
    shots.set_defaults(fn=cmd_screenshots)
    build = sub.add_parser("build")
    build.add_argument("number", type=int)
    build.add_argument("--wait", type=int, default=0, help="minutes to wait for processing")
    build.set_defaults(fn=cmd_build)
    sub.add_parser("submit").set_defaults(fn=cmd_submit)
    args = parser.parse_args()
    global STORE, CONF
    STORE = Path(args.store).resolve()
    CONF = json.loads((STORE / "store.json").read_text())
    args.fn(args)


if __name__ == "__main__":
    main()
