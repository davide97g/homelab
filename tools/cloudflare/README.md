# Cloudflare tunnels as code

[`cloudflare/tunnels.json`](../../cloudflare/tunnels.json) holds the ingress of both tunnels:
`mini-pc` (the box's `cloudflared`) and `nas` (`nas-ilario`). It is the source of truth since
2026-11-23; before that the rules lived only in the Zero Trust dashboard, and every change was a
hand-made GET, edit, PUT.

```sh
tools/cloudflare/tunnels.py diff    # repo vs live
tools/cloudflare/tunnels.py apply   # repo -> live; backs up live first, creates CNAMEs for new hosts
tools/cloudflare/tunnels.py audit   # CNAMEs without a rule, rules without a CNAME
tools/cloudflare/tunnels.py pull    # live -> repo, after a change made in the dashboard
```

Keep the catch-all (`http_status:404`) last; `apply` refuses a file where it is not. Removing a
hostname takes two steps: drop the rule and `apply`, then delete its CNAME (`audit` lists it).
Access applications and policies are still managed in the dashboard: they hold email addresses,
and this repository is public.
