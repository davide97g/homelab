# Mini PC — network hardening

Fixes the headline finding of `docs/security/audit-2026-09-25.md`: UFW is enabled on the
box but Docker `-p` published ports bypass it, so ~30 container ports (including
unauthenticated **ollama:11434** and the Docker Swarm control plane) are reachable by the
*other* Tailscale user's devices (`ilai5800@gmail.com`: the NAS + an iPhone) and by the LAN.

We gate at the network layer instead of editing every compose file, so no service config
changes and no redeploys.

## Two layers

| Layer | File | Scope | Applied by |
|---|---|---|---|
| Immediate | `docker-user-hardening.sh` + `.service` | Drops `ilai5800`'s tailnet IPs at `DOCKER-USER` — gates *all* published container ports on this box | `sudo` on the box |
| Durable | `tailscale-acl.hujson` | Tailnet ACL: scopes `debian` to the owner's user | Tailscale admin console |

Both are safe to run together. The firewall is per-IP (update it if `ilai5800` adds a
device); the ACL is user-scoped (covers future devices automatically). Keep both.

## Apply — firewall (on the box, over SSH)

```sh
# from the repo, copy the script + unit onto the box (adjust host as needed)
scp hosts/mini-pc/security/docker-user-hardening.sh   homelab:/tmp/
scp hosts/mini-pc/security/docker-user-hardening.service homelab:/tmp/

ssh homelab
sudo install -m 0755 /tmp/docker-user-hardening.sh   /usr/local/sbin/docker-user-hardening.sh
sudo install -m 0644 /tmp/docker-user-hardening.service /etc/systemd/system/docker-user-hardening.service
sudo systemctl daemon-reload
sudo systemctl enable --now docker-user-hardening.service   # applies now + after every docker restart
sudo systemctl status docker-user-hardening.service --no-pager
```

Verify the rules are in place:

```sh
sudo iptables  -L DOCKER-USER -n -v --line-numbers
sudo ip6tables -L DOCKER-USER -n -v --line-numbers
```

Rollback:

```sh
sudo systemctl disable --now docker-user-hardening.service
# flush the rules we added (re-created empty on next docker restart anyway):
for ip in 100.81.127.95 100.69.150.104; do sudo iptables  -D DOCKER-USER -i tailscale0 -s $ip -j DROP; done
for ip in fd7a:115c:a1e0::d131:7f60 fd7a:115c:a1e0::2631:9669; do sudo ip6tables -D DOCKER-USER -i tailscale0 -s $ip -j DROP; done
```

## Apply — Tailscale ACL (admin console)

1. Open the [Access Controls editor](https://login.tailscale.com/admin/acls/file).
2. Paste the contents of `tailscale-acl.hujson`.
3. Use **Preview** to confirm `ghiotto.davidenko@gmail.com` keeps access and
   `ilai5800@gmail.com → debian` is denied, then **Save**.

The console validates before saving and never revokes your own console access, so a bad
rule blocks node traffic at worst, not your ability to fix it.

## Test (from a device on the tailnet)

After applying, the owner's Mac should still reach services and the NAS/iPhone should not:

```sh
# owner device — expect success:
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://debian:11434/api/tags   # ollama
# from a NAS/iPhone (ilai5800) — expect timeout/refused after the firewall or ACL.
```
