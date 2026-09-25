# Connecting to the homelab model

A free, OpenAI- and Anthropic-compatible API for **Qwen3.6-35B-A3B**, running on one mini PC.
Replace `llm.example.com` below with the gateway hostname you were given.

1. Sign in at **https://llm.example.com/ui** with the email and password you were given.
2. **Virtual Keys → Create New Key**. Copy the `sk-…` key. It is shown once.
3. Point your tool at the base URL below with that key.

| | |
|---|---|
| Base URL (OpenAI) | `https://llm.example.com/v1` |
| Base URL (Anthropic) | `https://llm.example.com` |
| Models | `qwen3.6` (answers right away), `qwen3.6-thinking` (reasons first, much slower) |
| Context | 64k tokens in, up to 16k out |
| Limits per key | 2 requests in flight, 30 requests/min, 300k tokens/min |
| Price | free. The dashboard's *Usage* page shows your token counts, and spend stays $0 |

**Set your expectations first.** This is one small GPU and one request at a time for
everybody. It writes about 24 tokens/s and reads prompts at about 200 tokens/s. Chat and
scripts feel fine. Coding agents send a 10–30k-token system prompt, so their first reply
takes 1–2 minutes. Later turns are faster while nobody else is using it. If someone else is
mid-request, you wait in line.

## Claude Code

```sh
export ANTHROPIC_BASE_URL=https://llm.example.com
export ANTHROPIC_AUTH_TOKEN=sk-…            # your key
export ANTHROPIC_MODEL=qwen3.6
export ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3.6
export ANTHROPIC_DEFAULT_SONNET_MODEL=qwen3.6
export ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen3.6
export CLAUDE_CODE_SUBAGENT_MODEL=qwen3.6
export API_TIMEOUT_MS=1800000                # first turn can take minutes
claude
```

Set every model variable. Claude Code makes side calls on its "haiku" model, and any
Claude model name it sends here is refused.

## Codex CLI

`~/.codex/config.toml` (or a separate `CODEX_HOME`):

```toml
model = "qwen3.6"
model_provider = "homelab"

[model_providers.homelab]
name = "homelab"
base_url = "https://llm.example.com/v1"
env_key = "HOMELAB_LLM_KEY"
wire_api = "responses"
stream_idle_timeout_ms = 1800000
```

```sh
export HOMELAB_LLM_KEY=sk-…
codex
```

The warning `Model metadata for qwen3.6 not found` is expected and harmless.

## OpenCode

`opencode.json` in the project, or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "homelab": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Homelab",
      "options": {
        "baseURL": "https://llm.example.com/v1",
        "apiKey": "{env:HOMELAB_LLM_KEY}",
        "timeout": 1800000
      },
      "models": {
        "qwen3.6": { "name": "Qwen3.6 35B-A3B", "limit": { "context": 65536, "output": 16384 } }
      }
    }
  },
  "model": "homelab/qwen3.6"
}
```

## Anything else (Cline, Continue, Aider, Zed, SDKs, routers)

Pick "OpenAI-compatible", base URL `https://llm.example.com/v1`, your key, model `qwen3.6`.

```sh
curl https://llm.example.com/v1/chat/completions \
  -H "Authorization: Bearer sk-…" -H 'content-type: application/json' \
  -d '{"model":"qwen3.6","messages":[{"role":"user","content":"hi"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="https://llm.example.com/v1", api_key="sk-…")
print(client.chat.completions.create(model="qwen3.6",
      messages=[{"role": "user", "content": "hi"}]).choices[0].message.content)
```

Tool calling works in both formats. The model also takes images.
