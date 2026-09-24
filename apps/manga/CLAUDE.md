# CLAUDE.md

Suwayomi + Kavita manga stack with Yomu, our reader. `README.md` is how it works and how it's
deployed; this file is where the work stands and what comes next.

## Rules

- **Only Yomu is public** (`manga.davideghiotto.it`). Suwayomi has no auth and stays on
  `debian:4567`; Kavita's own UI stays on `debian:5000`. Never add a tunnel rule or port for
  either, and never widen Yomu's `/api` allowlist beyond what `web/src/lib/kavita/` calls.
  Our own services get their own prefix (`/script/` for `scripts`), never a hole in `/api`.
- **Don't stop or recreate Kavita or Suwayomi** unless asked. The volumes hold the user's Kavita
  admin account and reading progress. `docker compose up -d <service>` recreates only that one.
- This folder is a git repository (`davide97g/manga`, private). `homelab/` around it is not.
- Commits: conventional, with a scope (`yomu`, `compose`, `docs`, `transcribe`), lowercase.
- **Chapter scripts are made on the Mac** (`transcribe/`, Magi v2 + Qwen3-VL through Ollama, MPS).
  The box only serves them. Scripts and banks live in `MANGA_ROOT/scripts`, never inside
  `mangas/`, which Kavita watches. The bank is only ever changed through `review.yaml` and
  `bank --apply`, with the user confirming names.

## State (2026-09-23)

Running on the mini PC in `~/manga` (see README § Where it runs), state moved from the Mac:
both named volumes restored, `data/` rsynced. Extensions MangaDex 1.6.0 and MANGA Plus 1.6.66.

- Kavita folder watching was turned on server-wide (it was off, and the per-library flag alone
  does nothing). A download now shows up in Kavita about 6 minutes later, unscanned by hand. The DB from before the
  change is `backups/kavita.db.before-folder-watching` in the `manga_kavita-config` volume.
- The Mac test copy kept downloading after the first move, so on 2026-09-24 its Suwayomi volume
  replaced the box's (a superset) and `data/` was rsynced again: 89 chapters, One Piece (Official
  Colored) and One Piece in the Suwayomi Library. Then the Mac containers, volumes, images and
  `data/` were deleted at the user's request. The Mac holds only this source tree now.
- The hub's `/media` shows the stack (README § Where it runs, Monitoring).
- The ISP (Axera) DNS-blocks mangadex.org, which is why `suwayomi` has `dns:` 1.1.1.1/9.9.9.9 in
  `compose.yml`. MangaDex downloads work on the mini PC with it (same router).

## Scripts (2026-09-24)

`transcribe/` built and tried on the Mac only, nothing deployed yet: One Piece (Official
Colored) ch. 1-3 (PowerManga) in `work/`, which is gitignored. Qwen3-VL 8B picked over Qwen2.5-VL
7B and magiv3 (README § Scripts). The first character bank (10 characters, 44 crops) was
pre-filled from the crops and confirmed by the user. The Yomu script panel, `/search`, the
`scripts` service and its nginx route are written and build; `serve.py` was tested against a stub
Kavita, not the real one (that needs a user token).

## Open

- Scripted Kavita access works through `POST /api/account/login` with `{"apiKey": <auth key>}`
  (keys live in the `AppUserAuthKey` table). `/api/Plugin/authenticate` fails on 0.9.1.4.
- Suwayomi Library still holds the dead MangaDex B&W One Piece (id 81).
- Candidate extensions the user hasn't chosen yet: Webtoons.com, VIZ, Comikey.
- No CI: deploy is `git pull` + `docker compose up -d --build` on the box.
