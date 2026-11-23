# local-ai

Ollama on the mini PC, set up 2026-09-24. Since 2026-09-25 it is a Dokploy compose app
(`local-ai-uurnqn`) that deploys on push to `main`; `~/local-ai` on the box is a stale copy.

| | |
|---|---|
| API | `http://$LAN_HOST:11434` (LAN), `http://$TAILNET_HOST:11434` (tailnet) |
| OpenAI-compatible | `http://$LAN_HOST:11434/v1` — any string as API key |
| Model | `qwen3.6:35b-a3b-q4_K_M` — [Qwen/Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B), Apache-2.0 |
| Image | `ollama/ollama:0.34.4`, pinned |
| Models volume | `ollama` (Docker named volume, root fs) |

Hostnames, IPs and record ids below are placeholders like `$LAN_HOST`: the values live in
`.env` on the box (template: [`.env.example`](.env.example)), which compose also reads.

**Ollama is LAN and tailnet only.** It has no auth. It is not on the Cloudflare tunnel and
must not be: anyone who can reach `:11434` can run the model and pull or delete models. The
only public door is LiteLLM (below), which needs a per-user key. Open WebUI and SearXNG were
removed for good on 2026-11-23.

```sh
# deploy: push to main -- see ../../README.md#deploying (Dokploy app `local-ai`)
ssh homelab
docker exec -it ollama ollama run qwen3.6:35b-a3b-q4_K_M
docker exec ollama ollama ps              # what is loaded, CPU vs GPU
docker logs -f ollama
./bench.sh qwen3.6:35b-a3b-q4_K_M         # speed check
```

From the Mac:

```sh
curl http://$LAN_HOST:11434/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"qwen3.6:35b-a3b-q4_K_M","messages":[{"role":"user","content":"hi"}]}'
```

Thinking is on by default. Turn it off per request with `"think": false` (native
`/api/chat`, `/api/generate`) or `"reasoning_effort": "none"` (`/v1`).

## API gateway — LiteLLM

Added 2026-09-24. [LiteLLM Proxy](https://github.com/BerriAI/litellm) `v1.102.1`, pinned, gives
other people API keys to the local model for their own agents, routers and scripts. A
dashboard at `/ui` lets users sign in and mint their own keys, and it shows usage per key.
Nothing is billed: prices are $0, so the spend pages count tokens.

| | |
|---|---|
| Public | `https://$LLM_HOST`, since 2026-09-24. **Not behind Access**: keys and the `/ui` login are the gate |
| LAN | `http://$LAN_HOST:4000` (`/ui`, `/v1`) |
| Config | [`litellm.yaml`](litellm.yaml), secrets (`LITELLM_*`, `DATABASE_URL`, `POSTGRES_PASSWORD`) in the Dokploy Environment tab |
| Storage | Postgres 17 (`litellm-db`, volume `litellm-db`): users, keys, usage |
| Admin | UI: an admin user (`proxy_admin`), `LITELLM_UI_ADMIN_*`. API: `LITELLM_MASTER_KEY`. Both in [`../../.env`](../../.env) |
| Users | one test user (`internal_user`), `LITELLM_USER_<NAME>_*` |
| For users | [`CONNECT.md`](CONNECT.md): sign in, make a key, paste-ready config per agent |

**APIs**, all tested with real clients on 2026-09-24:

| Client | API | Result |
|---|---|---|
| curl / OpenAI SDK | `/v1/chat/completions` | text, tools, streaming |
| Claude Code 2.1.281 | `/v1/messages` (Anthropic) | wrote a file in 2 turns, **117 s**: 108 s of it was the first turn's 29.8k-token prompt |
| Codex CLI 0.156.1 | `/v1/responses` | ran a shell command, 47 s, 8.7k tokens |
| OpenCode 1.18.30 | `/v1/chat/completions` | issued a `Write` tool call. OpenCode refused it locally over `/tmp` vs `/private/tmp` on macOS, which is not a gateway problem |

**Models.** `qwen3.6` sends `reasoning_effort: none`. `qwen3.6-thinking` leaves thinking on.
Both are the same Ollama model.

**Upstream is `openai/` on Ollama's `/v1`, not LiteLLM's `ollama_chat/`.** In v1.102.1 the
`ollama_chat` adapter crashes on every Codex request: `TypeError: unhashable type: 'dict'` in
`llms/ollama/chat/transformation.py` `map_openai_params`, because the Responses API's
`reasoning` is an object and the adapter does `value in {"low","medium","high"}`. Codex
shows it as "high demand, reconnecting 5/5". Ollama serves `/v1/chat/completions` and
`/v1/responses` itself. LiteLLM translates Anthropic `/v1/messages` onto chat.

**Users and keys.**
- Roles: `internal_user` can sign in, create and delete their own keys, and see their own
  usage. They cannot add users, and a 401 comes back if they try.
- Every key gets `max_parallel_requests: 2`, `rpm_limit: 30`, `tpm_limit: 300000` by default,
  and `upperbound_key_generate_params` refuses anything higher: *"max_parallel_requests is
  over max limit set in config - user_value=50; max_value=2"*.
- Prompts and replies are stored (`store_prompts_in_spend_logs: true`, since 2026-09-25)
  and show under Logs in the admin UI: an admin can read every user's requests. Only
  requests after the change have bodies. Set it back to `false` for token-and-model-only rows.

**Adding a user.** Invitation links do not work with the master key. `/invitation/new`
answers *"User id does not exist in LiteLLM_UserTable"* about the inviter, which is the
master key and has no user row. Set the password directly instead. The password policy
requires a special character.

```sh
M="Authorization: Bearer $LITELLM_MASTER_KEY"
curl -s localhost:4000/user/new -H "$M" -H 'content-type: application/json' \
  -d '{"user_email":"name@example.local","user_alias":"name","user_role":"internal_user","models":["qwen3.6","qwen3.6-thinking"]}'
curl -s localhost:4000/user/update -H "$M" -H 'content-type: application/json' \
  -d '{"user_id":"<id from above>","password":"<random, with a - or similar>"}'
```

Login at `/ui` is the email plus that password. Or do it in the UI: Internal Users → +.

**Concurrency is one request at a time, whatever the settings say.** Ollama logs *"model
architecture does not currently support parallel requests" architecture=qwen35moe* and
runs `n_seq_max = 1` even with `OLLAMA_NUM_PARALLEL=2`. That is why the per-key limit
is 2: an agent's side request queues instead of failing. Everyone shares one queue, and
the chat UI waits behind an agent's long prompt as well.

**Published** as an ingress rule `$LLM_HOST` ->
`http://localhost:4000` before the catch-all, plus a proxied CNAME `llm` (record id
`$CF_RECORD_ID_LLM`). Checked from outside: `/v1/models`, `/key/generate`,
`/user/list`, `/health` and `/metrics` all return 401 without a key. `/health/liveliness`
and `/ui` return 200. `NO_DOCS` removes `/docs`. `openapi.json` still answers, because
LiteLLM's switch does not cover it; it lists endpoints and holds no data. In a browser,
a test user signed in at `/ui`, created a key under Virtual Keys, and that key worked for
`/v1/chat/completions` and streaming `/v1/messages` over the public URL.

**Cloudflare's 100 s cutoff, and the keepalive proxy** (2026-09-25). Cloudflare ends a
proxied request with a 524 when the origin sends nothing for 100 s, and only Enterprise
can raise that, for any path. LiteLLM sends no headers until the model's first token
(`_buffer_first_chunk_honoring_disconnect` in `proxy/common_request_processing.py`), and
an OpenCode turn is 1–3 min of prefill here, more when queued. So agents on the public URL
died at the first big prompt while the LAN was fine. `llm-keepalive`
([`keepalive/server.mjs`](keepalive/server.mjs), Node, no dependencies, `127.0.0.1:4001`)
now takes the streaming paths: a second ingress rule on `$LLM_HOST`, path
`^/(v1/)?(chat/completions|messages|responses)$` -> `http://localhost:4001`, placed before
the `:4000` rule. For a `"stream": true` request it waits 2 s. Auth and rate-limit errors
come back inside that with their own status. Past it, it answers 200 `text/event-stream`
itself and writes `: keepalive` comment lines every 15 s until LiteLLM starts streaming.
SSE clients skip comments. A later LiteLLM error becomes an SSE error event in that API's
shape. Non-streaming requests pass through unchanged and can still hit the 100 s limit.
Every agent in [`CONNECT.md`](CONNECT.md) streams. The LAN `:4000` does not go through it.
Checked over the public URL: a 28k-token streaming prompt got its first token at 160 s
and finished with a 200 (it was a 524 at 100 s before).

After a new hostname, the Mac's resolver can hold a cached NXDOMAIN for a few minutes
(`curl` exit 6 while `dig @1.1.1.1` answers). `curl --doh-url https://1.1.1.1/dns-query`
gets around it. Flushing the cache needs sudo.

**Two dashboard banners, both fixed on 2026-09-24:**
- *Environment-credential login is enabled.* The first admin login was the shared
  `UI_USERNAME`/`UI_PASSWORD` from `litellm.env`, and with those unset the master key works as a
  password. Now the admin is a real `proxy_admin` user with its own password,
  `disable_env_credential_login: true` is in `litellm.yaml`, and the `UI_*` lines are gone
  from `litellm.env`. Logging in as `admin` or with the master key as the password returns 401.
  The master key still works as an API bearer.
- *No Redis configured.* Without Redis each worker keeps its own rate-limit counters, so
  two workers doubled every key's limits. Now `--num_workers 1`, which is ~0.6 GB instead of
  1.35 GB. The banner reads worker heartbeats from Postgres (`LiteLLM_ProxyWorkerHeartbeat`,
  a 60 s beat, live for 180 s). Right after a restart the old workers' rows still count,
  and the banner clears about 3 minutes later. If you ever need more workers, add Redis
  rather than silencing it with `LITELLM_DISABLE_NO_REDIS_WARNING`.

`request_timeout: 1800` in the config. A long agent prompt behind someone else's can exceed
LiteLLM's default. `PROXY_BASE_URL` is the public URL, so a login on `:4000` redirects there.

## Why this model

Picked from what was current on Hugging Face on 2026-09-24, against this box's limits:
~31 GB RAM free with the other ~55 containers running, no discrete GPU, 6 GB VRAM carve-out
on the 760M plus GTT. Everything was measured here, iGPU on, with `bench.sh` and a
2.3k-token prompt:

| Model | Size | Gen tok/s | Prefill tok/s |
|---|---|---|---|
| **Qwen3.6-35B-A3B** Q4_K_M (MoE, 3B active) | 23 GB | **24** | **216** |
| Qwen3.6-35B-A3B MTP Q4_K_M | 22 GB | 24 | — |
| Qwen3.8-27B MTP Q4_K_M (dense) | 17 GB | 5.7 | 54 |

Qwen3.8-27B is the stronger model on paper (newest Qwen, Aug 2026). On this hardware it
writes at ~6 tok/s and makes you wait ~45 s before a 2k-token prompt even starts, and more
once thinking tokens are added. The MoE does 4× that because only 3B parameters are read
per token, and generation speed here is set by memory bandwidth. The MTP build of the MoE
gave nothing extra, so the plain one stays.

Ruled out by size: Qwen3.8-Flash-Next (180B), GLM-5.3-Flash (321B), Qwen3-Next-80B. They
do not fit in 40 GB at any usable quant.

To try the 27B anyway: `docker exec ollama ollama pull qwen3.8:27b-mtp-q4_K_M` (17 GB).
`OLLAMA_MAX_LOADED_MODELS=1` means switching models unloads the other one first.

Both Qwen models are vision-language natively. Text prompts work as normal. The vision
tower is only a small part of the RAM.

**Debugging trap.** Ollama logs a `POST "/api/chat"` line only when the request *finishes*.
A reply stuck on "Thinking…" with nothing in the log is usually still generating. Check
`cat /sys/class/drm/card0/device/gpu_busy_percent` or `docker stats ollama` before deciding
the request never arrived.

## GPU

Vulkan (RADV) on the Radeon 760M, `gfx1103`. There is no ROCm image here: ROCm does not
officially support gfx1103, and Vulkan needs no `HSA_OVERRIDE_GFX_VERSION`. Ollama drops
integrated GPUs by default, so `OLLAMA_IGPU_ENABLE=1` is required. With it, Ollama sees
26.5 GiB (carve-out plus GTT) and puts all 42 layers on the GPU. CPU-only was 19 tok/s,
so the iGPU is worth ~25% on generation. It helps prefill more.

`davide` is not in the `render` group on the host. The container gets `/dev/dri` through
`group_add: "992"` (host `render` gid) instead, so no sudo was needed.

## Memory

With the model loaded the host has ~10 GB available. `OLLAMA_KEEP_ALIVE=15m` unloads it
after 15 idle minutes, and `mem_limit: 30g` caps the container so a big context cannot take
the rest of the box with it. `OLLAMA_NUM_PARALLEL=1`, so a second request queues.
The KV cache is small: this architecture has only 10 of 40 layers with full attention, so
the 64k context (`OLLAMA_CONTEXT_LENGTH`, raised from 32k for coding agents) costs ~680 MB
at q8_0. Resident with everything up: ollama ~23 GB with the model loaded, litellm ~1.4 GB
(two workers, capped at 3 GB), litellm-db ~50 MB.

## Upgrading

Change the image tag in `compose.yaml` and push to `main`.
Check `docker logs ollama | grep "inference compute"` still says `library=Vulkan` and `ollama ps`
still says `100% GPU`.

## Config-file edits need a force-recreate — a push is not enough

`litellm.yaml` is **bind-mounted** into their
containers (e.g. `./litellm.yaml:/app/config.yaml:ro`). A push that changes only one of
these deploys the new file to the box, but `docker compose up` does **not** recreate the
container, because the service definition itself is unchanged. Worse, git replaces the file
with a new inode, so the already-running container keeps its mount pinned to the *old* file
and never sees the edit — the on-disk file and the file inside the container disagree.

Confirm before assuming it applied:

```sh
# on-disk (correct after a push):
grep <key> /etc/dokploy/compose/local-ai-uurnqn/code/apps/local-ai/litellm.yaml
# inside the running container (what actually takes effect):
docker exec litellm grep <key> /app/config.yaml
```

If they disagree, force-recreate just that service:

```sh
cd /etc/dokploy/compose/local-ai-uurnqn/code/apps/local-ai
docker compose -p local-ai-uurnqn --env-file .env up -d --force-recreate litellm
```

(Bitten 2026-09-25: re-enabling the LiteLLM UI's `admin` + master-key login by setting
`disable_env_credential_login: false` deployed fine but did nothing until litellm was
recreated. An image-tag bump does not have this problem — that changes the service
definition, so compose recreates the container on its own.)
