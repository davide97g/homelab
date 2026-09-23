# CLAUDE.md

Suwayomi + Kavita manga stack with Yomu, our reader. `README.md` is how it works and how it's
deployed; this file is where the work stands and what comes next.

## Rules

- **Only Yomu is public** (`manga.davideghiotto.it`). Suwayomi has no auth and stays on
  `debian:4567`; Kavita's own UI stays on `debian:5000`. Never add a tunnel rule or port for
  either, and never widen Yomu's `/api` allowlist beyond what `web/src/lib/kavita/` calls.
- **Don't stop or recreate Kavita or Suwayomi** unless asked. The volumes hold the user's Kavita
  admin account and reading progress. `docker compose up -d <service>` recreates only that one.
- This folder is a git repository (`davide97g/manga`, private). `homelab/` around it is not.
- Commits: conventional, with a scope (`yomu`, `compose`, `docs`), lowercase.

## State (2026-09-23)

Running on the mini PC in `~/manga` (see README § Where it runs), state moved from the Mac:
both named volumes restored, `data/` rsynced. Extensions MangaDex 1.6.0 and MANGA Plus 1.6.66.

- Kavita folder watching was turned on server-wide (it was off, and the per-library flag alone
  does nothing). A download now shows up in Kavita about 6 minutes later, unscanned by hand. The DB from before the
  change is `backups/kavita.db.before-folder-watching` in the `manga_kavita-config` volume.
- Test downloads on the box: One Piece (Official Colored) ch. 2 and 3, MangaDex.
- **The Mac copy is still running** (Docker Desktop, Yomu dev on :4571). It's now stale. Stop it
  only when the user says so, and ask before deleting its volumes (`manga_suwayomi-data`,
  `manga_kavita-config` on the Mac).
- The ISP (Axera) DNS-blocks mangadex.org, which is why `suwayomi` has `dns:` 1.1.1.1/9.9.9.9 in
  `compose.yml`. MangaDex downloads work on the mini PC with it (same router).

## Open

- Scripted Kavita access works through `POST /api/account/login` with `{"apiKey": <auth key>}`
  (keys live in the `AppUserAuthKey` table). `/api/Plugin/authenticate` fails on 0.9.1.4.
- Suwayomi Library still holds the dead MangaDex B&W One Piece (id 81).
- Candidate extensions the user hasn't chosen yet: Webtoons.com, VIZ, Comikey.
- No CI: deploy is `git pull` + `docker compose up -d --build` on the box.
