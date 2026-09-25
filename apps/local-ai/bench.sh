#!/usr/bin/env bash
# Rough speed check against the local Ollama: prompt eval and generation tok/s.
#   ./bench.sh qwen3.6:35b-a3b-q4_K_M [host]
set -euo pipefail
model=${1:?model}
host=${2:-http://localhost:11434}

prompt='Explain, in about 300 words, how a Docker overlay network routes packets between two containers on different Swarm nodes.'

curl -s "$host/api/generate" -d "$(jq -n --arg m "$model" --arg p "$prompt" \
  '{model:$m, prompt:$p, stream:false, think:false, options:{num_predict:300}}')" |
  jq -r '"load \(.load_duration/1e9|floor)s  prompt \(.prompt_eval_count) tok @ \((.prompt_eval_count/(.prompt_eval_duration/1e9))*10|floor/10) tok/s  gen \(.eval_count) tok @ \((.eval_count/(.eval_duration/1e9))*10|floor/10) tok/s"'
