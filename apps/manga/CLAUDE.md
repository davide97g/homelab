# CLAUDE.md

Suwayomi + Kavita manga stack, LAN only. `README.md` is how it works; this file is where the
work stands and what comes next.

## Rules

- **LAN only.** No Cloudflare tunnel, no public hostname, no Access app. Suwayomi has no auth.
- **Don't stop or recreate the local containers** unless asked. They hold the user's Kavita
  admin account and reading progress. `docker compose up -d <service>` after a compose change
  only recreates that one service, and the named volumes survive it.
- Nothing here is in git (neither `homelab/` nor this folder is a repository).

## State (2026-09-23)

Running on the Mac as a test, via Docker Desktop:

- Suwayomi on <http://localhost:4567>: extensions MangaDex 1.6.0 and MANGA Plus 1.6.66, download
  queue empty.
- Kavita on <http://localhost:5001> (5000 is taken by macOS AirPlay): admin account created by the
  user, library `/manga` scanned.
- **Yomu** (`web/`, the custom reader over Kavita) on <http://localhost:4571> via `bun run dev`.
  It's not a container yet. The user reviewed it and approved the design. See README § Yomu.
- `data/mangas/` is about 116 MB: One Piece ch. 1 + 1193 (MANGA Plus), Official Colored ch. 763
  (MangaDex), and the Kudan ch. 1 test.

- The ISP (Axera) DNS-blocks mangadex.org: the router's resolver returns a block page at
  `193.238.136.139`, and its certificate makes Java fail with `PKIX path building failed`. The
  `dns:` entry on `suwayomi` in `compose.yml` sends that container to 1.1.1.1 and 9.9.9.9. Only
  DNS is blocked: the real IPs connect fine. The mini PC sits behind the same router, so it needs
  that entry too.

## Next: move it to the mini PC

The user asked for this: test here, then move it to the mini PC.

- SSH: `ssh homelab`. Its `HostName` is the LAN IP `192.168.15.126`, which timed out from the Mac
  this session, so use Tailscale: `ssh -o HostName=${BOX_TAILNET_IP} homelab`.
- Disk: 131 GB free of 875 GB on `/`. Ports 4567 and 5000 are free there (qBittorrent has 8080,
  cinema-web 8898, Jellyfin 8097/8096).
- Make it its own compose project (e.g. `~/manga`), not part of `~/mediarr/compose.yml`. Nothing
  in mediarr needs to talk to it.
- `.env` on the box: `MANGA_ROOT=/home/davide/manga` (or wherever), default ports, and create
  `$MANGA_ROOT/mangas` owned by `1000:1000` first, because both images run as non-root.
- Moving the state or starting fresh is the **user's decision**, so ask. Moving it means tarring
  both named volumes (`manga_suwayomi-data`, `manga_kavita-config`) and restoring them on the
  box, then rsyncing `data/`. Starting fresh means redoing the Kavita admin account and library
  (`/manga`, type Manga) and reinstalling the extensions.
- After the move, check that Kavita's folder watching picks up a new Suwayomi download without a
  manual scan. It doesn't on the Mac.
- Then add one line for the stack to `../README.md` § Services (the homelab host notes), stop the
  Mac copy only when the user says so, and ask before deleting the local volumes.

## Open

- Yomu needs a production image: a Bun build stage plus nginx serving `dist/`, with `/api`
  proxied to `kavita:5000` and an SPA fallback. Add it as a third service in `compose.yml` so it
  moves to the mini PC with the rest. Once Yomu is running, Kavita's own port can stay LAN-only
  for admin work.
- Scripted Kavita access works through `POST /api/account/login` with `{"apiKey": <auth key>}`
  (keys live in the `AppUserAuthKey` table). `/api/Plugin/authenticate` fails on 0.9.1.4.
- Suwayomi Library still holds the dead MangaDex B&W One Piece (id 81).
- Candidate extensions the user hasn't chosen yet: Webtoons.com, VIZ, Comikey.
