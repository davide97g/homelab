# local-ai

Ollama on the mini PC, set up 2026-09-24. Since 2026-09-25 it is a Dokploy compose app
(`local-ai-uurnqn`) that deploys on push to `main`; `~/local-ai` on the box is a stale copy.

| | |
|---|---|
| API | `http://$LAN_HOST:11434` (LAN), `http://$TAILNET_HOST:11434` (tailnet) |
| OpenAI-compatible | `http://$LAN_HOST:11434/v1` — any string as API key |
| Model | `qwen3.6:35b-a3b-q4_K_M` — [Qwen/Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B), Apache-2.0 |
| Image | `ollama/ollama:0.40.18`, pinned |
| Models volume | `ollama` (Docker named volume, root fs) |

Hostnames, IPs and record ids below are placeholders like `$LAN_HOST`: the values live in
`.env` on the box (template: [`.env.example`](.env.example)), which compose also reads.

**Ollama is LAN and tailnet only.** It has no auth. It is not on the Cloudflare tunnel and
must not be: anyone who can reach `:11434` can run the model and pull or delete models.
Open WebUI and SearXNG were removed for good on 2026-11-23, the LiteLLM gateway on 2026-11-25.

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

## API gateway — removed

A LiteLLM gateway (`litellm`, `llm-keepalive`, Postgres `litellm-db`) published the model
at `llm.davideghiotto.it` with per-user keys from 2026-09-24. It was removed for good on
2026-11-25, with its tunnel rules, CNAME and database volume. The model is LAN-only
again (above). The history is in git if it ever comes back.

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
at q8_0. Resident with the model loaded: ~23 GB.

## Upgrading

Change the image tag in `compose.yaml` and push to `main`.
Check `docker logs ollama | grep "inference compute"` still says `library=Vulkan` and `ollama ps`
still says `100% GPU`.
