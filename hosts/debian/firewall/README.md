# Mini PC firewall: who reaches the published ports

UFW is on with default-deny, and until 2026-09-27 that meant nothing for containers:
Docker's `-p` publishing DNATs in `PREROUTING`, so the traffic goes through `FORWARD`
and never meets UFW's `INPUT` rules. About 30 container ports were open to the whole
LAN and to every tailnet peer, including the NAS owner's devices (the tailnet belongs
to them). See `docs/security/audit-2026-09-25.md`.

## What gets in now

| From | Container ports | Host services (SSH, Swarm 2377/7946) |
|---|---|---|
| The box itself, incl. cloudflared | everything | everything |
| Other containers (Docker bridges) | everything | everything (UFW allows `172.16.0.0/12`) |
| Home LAN `192.168.15.0/24` | everything | SSH only |
| Your own tailnet devices (`TRUSTED_*`) | everything | everything |
| Any other tailnet peer, anything else | **dropped** | SSH only |

Every public hostname keeps working: cloudflared runs on the host and dials
`localhost:<port>`, which never crosses `FORWARD`. Ollama, LiteLLM and Open WebUI are
bound to `127.0.0.1` in `apps/local-ai/compose.yaml` on top of this, so not even the
LAN reaches them directly.

## How

- `homelab-firewall apply` loads a `HOMELAB-EXT` chain (replies, `LAN_*`, `TRUSTED_*`,
  then `DROP`) and jumps to it from the top of `DOCKER-USER` for everything that does
  not come in from a Docker bridge. Its rules carry the comment `homelab-firewall`, so
  re-applying replaces them rather than stacking copies.
- `homelab-firewall.service` runs that on every Docker start (`BindsTo=docker.service`).
- Tailscale runs with `--netfilter-mode=nodivert`. In the default mode its `ts-input`
  chain comes first in `INPUT` and accepts all of `tailscale0`, so no UFW rule ever
  applied to tailnet peers. `41641/udp` (WireGuard) is allowed explicitly instead.
- UFW's blanket `allow in on tailscale0` is replaced by one rule per trusted device.
  Besides SSH and Swarm, that also covers IPv6: Docker's userland proxy answers `[::]`
  on the host, so IPv6 reaches published ports through `INPUT`, not `FORWARD`.

The addresses live in `/etc/default/homelab-firewall` on the box, never in the repo;
`homelab-firewall.conf.example` shows the shape.

## Install or change

```sh
scp -r hosts/debian/firewall homelab:homelab-firewall
# put the real values in ~/homelab-firewall/homelab-firewall.conf on the box, then:
ssh -t homelab 'sudo ~/homelab-firewall/install.sh'   # quoted, or ~ expands on your laptop
```

A new trusted device: add it to `/etc/default/homelab-firewall`, then
`sudo systemctl reload homelab-firewall` and
`sudo ufw allow in on tailscale0 from <ip> comment 'homelab-firewall: trusted tailnet device'`.

## Undo

```sh
sudo systemctl disable --now homelab-firewall   # removes the DOCKER-USER rules
sudo ufw allow in on tailscale0
sudo tailscale set --netfilter-mode=on
```

## Check

From an allowed machine, `nc -z debian 7878` connects. From the NAS, which is a
tailnet peer but not a trusted one, `nc -z <box tailnet ip> 7878` times out.
