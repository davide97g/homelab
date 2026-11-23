# Memories

Public door for the NAS's Immich. Live at **<https://memories.davideghiotto.it>** since 2026-11-10.
Before that, Immich was reachable only on the LAN and over Tailscale.

| What | Where |
|---|---|
| Immich web UI | `https://memories.davideghiotto.it` |
| Immich server URL, for the native apps | `https://memories.davideghiotto.it/immich` |
| Immich on the LAN / Tailscale | `http://<nas-ip>:2283` |

Same idea as Cinema's `/jf`: one hostname, the native apps get their own prefix. Unlike Cinema,
the root is Immich's own web UI, not a custom front end.

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

```sh
cd ~/personal/projects/homelab/apps/memories
COPYFILE_DISABLE=1 tar czf - compose.yaml nginx.conf upload-relay/relay.py search/search.py | ssh nas 'mkdir -p ~/memories && tar xzf - -C ~/memories'
ssh nas 'cd ~/memories && docker compose up -d --force-recreate'
```

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
