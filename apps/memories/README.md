# Memories

Public door for the NAS's Immich. Live at **<https://memories.davideghiotto.it>** since 2026-11-10.
Before that, Immich was reachable only on the LAN and over Tailscale.

| What | Where |
|---|---|
| Our web app (`web/`, iOS Photos style) | `https://memories.davideghiotto.it` |
| Immich server URL, for the native apps | `https://memories.davideghiotto.it/immich` |
| Immich on the LAN / Tailscale | `http://<nas-ip>:2283` |

Same idea as Cinema's `/jf`: one hostname, the native apps get their own prefix. The root is our
own web app (`web/dist`); only `/api`, `/.well-known`, `/share`, `/s` and `/_app` (public share
links) go to Immich. Immich's stock web UI stays on the LAN / Tailscale at `:2283`.

Our own clients on top of it: [`ios/`](ios/) (iPhone, with backup), [`web/`](web/) and [`tv/`](tv/)
(Android TV, signed in with a code the iPhone approves). Shared look: [`DESIGN.md`](DESIGN.md).

## The shape of it

| | |
|---|---|
| Host | UGREEN NAS, `ssh nas` |
| Immich | stock compose in `/volume1/docker/immich-app` (project `immich`), `immich_server` on `:2283` — untouched |
| Proxy | `memories-proxy` (nginx), from `compose.yaml` here, on `127.0.0.1:2284`, joined to `immich_default` |
| Tunnel | `nas-ilario` (the NAS's own, same as Cinema), ingress `memories.davideghiotto.it` -> `http://localhost:2284` |
| DNS | proxied CNAME `memories` -> `<nas-tunnel-uuid>.cfargotunnel.com` |

**Why an nginx at all.** Immich has no base-path setting, and cloudflared cannot rewrite paths,
so `/immich/` is stripped here. The mobile app copes: it reads `<server>/.well-known/immich`,
gets `{"api":{"endpoint":"/api"}}`, appends it to the URL it was given, and opens its websocket
under the same prefix.

**Loopback only.** cloudflared runs on the host, so the proxy binds `127.0.0.1`. The LAN keeps
`:2283`.

## Deploying a change

**Push to `main`.** The mini PC's NAS deploy loop ([`hosts/debian/nas-deploy`](../../hosts/debian/nas-deploy/))
builds `web/` with bun on the box, sends `compose.yaml`, `nginx.conf`, `upload-relay/relay.py`,
`search/search.py` and `web/dist` to `/volume1/docker/memories` on the NAS, strips the share's ACL
(nginx's worker cannot read through it) and runs `docker compose up -d --force-recreate`.
Redeploy by hand: `ssh homelab '~/ops/nas-deploy/nas-deploy.sh --force memories'`.

Verify on the box, then from outside:

```sh
ssh nas 'curl -s http://127.0.0.1:2284/immich/api/server/ping'   # {"res":"pong"}
ssh nas 'curl -s http://127.0.0.1:2284/immich/api/memories/upload/config'   # {"version": 1, ...}
curl -s https://memories.davideghiotto.it/immich/.well-known/immich
```

`~/memories` lives in `/home/davide`, which a UGOS update can wipe (it did on 2026-11-08). If
`memories-proxy` is gone after an update, redeploy with the commands above.

## Search with a sentence

`memories-search` (`search/search.py`, routed at `/immich/api/memories/search` and
`/api/memories/search`) turns "tutte le foto di marci che mangia a roma l'estate scorsa" into an
Immich search:

- **Rules** (no LLM): dates ("2024", "l'anno scorso", "a giugno 2022", "l'estate scorsa", "ultimo
  mese", "ieri"), videos vs photos, favourites. A month or season without a year can't be one
  date range, so it becomes a hint for the visual search instead.
- **LLM**: who (names, matched to the caller's *named* people in Immich), what is visible
  (short English, for CLIP), which town/country (matched to Immich's own city/country names,
  with Italian aliases). Whatever the LLM says is kept only if the words are in the sentence.
- Something to look at -> `/search/smart`; only filters -> `/search/metadata`, newest first.
- **Fallback**: LLM slow (`LLM_TIMEOUT`, 15 s), down or nonsensical -> rules + the sentence as
  typed to smart search. Search always answers. Plans are cached an hour per user + sentence.
- The answer is Immich's own search response plus `memories` (how it was read); the iPhone app
  shows it as chips above the results, and says when a name matches nobody.

**The LLM is swappable.** Default is local: `memories-llm` (Ollama 0.40.17, CPU only) with
`qwen3:4b`, ~3-5 s per new sentence on the NAS's i3-1315U (benchmarked 2026-11-23:
qwen3:1.7b ~1.5 s but translates badly, gemma3:4b slightly better but ~12 s, gemma3:1b
unusable). Any OpenAI-compatible endpoint works: put the overrides in `~/memories/search.env`
on the NAS (git-ignored) and `docker compose up -d memories-search`:

```sh
# DeepSeek (JSON mode without schema)
LLM_URL=https://api.deepseek.com/v1
LLM_KEY=sk-...
LLM_MODEL=deepseek-chat
LLM_JSON=object
LLM_EXTRA={}
```

Other local models: `ssh nas docker exec memories-llm ollama pull <model>` and set `LLM_MODEL`.
Qwen3 needs `LLM_EXTRA={"reasoning_effort": "none"}` (the default), or it spends the whole
answer thinking.

## Similar Photos (iPhone)

Collections > Utilities > **Similar Photos**: a card stack per set of look-alike photos. Swipe
right keeps, left deletes; hold the compare button to flip the card to the photo you're keeping.
Code in `ios/Memories/Cleanup/`.

- **Immich does the finding.** Sets come from `GET /duplicates` (CLIP distance under
  `machineLearning.duplicateDetection.maxDistance`), ordered with Immich's `suggestedKeepAssetIds`
  first. Ending a set calls `POST /duplicates/resolve` (copies albums, favourite, rating onto the
  kept ones), then `DELETE /assets` with `force: true`: no Immich trash. "Not similar" is
  `DELETE /duplicates/{id}`.
- **Threshold.** Immich's default 0.01 catches only near-identical files. Measured 2026-11-25 on
  the main library (7,877 assets), photos with a neighbour within: 0.02 = 350, 0.03 = 773,
  0.05 = 1,686. Chosen: **0.03** (bursts, same pose). It is server-wide (both users); after changing
  it, run *Recheck Whole Library* in the app (or the Duplicate Detection job on *All*).
- **Search by hand**: the game's "…" menu, the session summary and Settings > Similar Photos start
  Immich's duplicate detection (`PUT /jobs/duplicateDetection`, admin token) and wait for the queue
  to drain (`GET /queues/duplicateDetection`). *Search New Photos* checks only unchecked assets;
  *Recheck Whole Library* is `force: true`, the one to use after changing the threshold.
  Non-admins get the latest results only.
- **Undo** lasts 4 s after a set's last swipe; then the delete is final.
- **iPhone copies** of deleted photos are listed and removed at the end of the session with one iOS
  prompt (Recently Deleted keeps them 30 days). Until then Free Up Space won't treat them as
  "missing on the server" and re-upload them.
- **Gamification**: a daily ring (goal 3/5/10/20 sets, Settings), space freed, a day streak. One
  local notification a day at most, from the background refresh, only for new sets or after two
  idle days.

## Things to know

- **100 MB per request.** Cloudflare's free plan rejects any single upload above 100 MB with a
  413. The Memories iPhone app sends bigger files in 90 MB pieces to `memories-upload`
  (`upload-relay/relay.py`, routed by nginx at `/immich/api/memories/upload/`), which checks the
  caller's Immich token, reassembles the pieces in `/volume1/docker/memories-upload` and posts
  the body to Immich itself. Unfinished uploads are dropped after 48 h. Immich's own app has no
  such path: there, use *Automatic URL switching* (home Wi-Fi -> `http://<nas-ip>:2283`).
- **Share links.** *Administration > Settings > Server > External domain* =
  `https://memories.davideghiotto.it`, or links point at the LAN address.
- **It is on the Internet now.** Only Immich's login stands in front. Strong passwords, no
  public sign-up (Immich has none unless OAuth auto-register is on).

## Undo

Remove the ingress rule from `nas-ilario` (read the config, drop the rule, PUT it back — the
API replaces the whole list), delete the `memories` CNAME, then
`ssh nas 'cd ~/memories && docker compose down'`.
