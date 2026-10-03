# adguard

AdGuard Home on the mini PC. It blocks ads and trackers at the DNS level for every device in
the house: TVs, phones, apps and the guest Wi-Fi. A Dokploy compose app since 2026-10-03.

| | |
|---|---|
| DNS | `:53` udp/tcp on the box. LAN and trusted tailnet devices only, through homelab-firewall |
| Web UI | `http://debian:3053` (LAN, tailnet). Not on the tunnel |
| Image | `adguard/adguardhome:v0.107.79`, pinned. Renovate bumps it |
| Volumes | `adguard_conf` (AdGuardHome.yaml, the admin's password hash), `adguard_work` (query log, stats, lists) |
| Admin login | `~/.config/homelab/adguard.env` on the box, mode 600 |

## How DNS flows

```
device ──▶ FRITZ!Box (DHCP DNS, unchanged) ──▶ AdGuard on the mini PC ──▶ Quad9 / Cloudflare over DoH
                 │                                    │
                 └ answers fritz.box names itself     └ PTR for 192.168.15.x goes back to the FRITZ!Box
```

Devices keep the FRITZ!Box as their DNS server, which is what DHCP hands out. Only the
FRITZ!Box's own upstream points at AdGuard. That choice decides everything else:

- **Switching is instant.** Changing the FRITZ!Box upstream applies to the next query from
  every device. Changing the DHCP DNS server would not: leases here are 13 days, so devices
  only pick up a new DNS server after about 6.5 days or when they reconnect.
- **Nothing gets around it.** IPv6 clients, the guest network and `fritz.box` names all go
  through the FRITZ!Box anyway. The line has no public IPv6, so the FRITZ!Box has no IPv6
  upstream to leak through. If the ISP ever enables IPv6, set the IPv6 upstream as well.
- **The cost:** AdGuard sees every query as coming from the FRITZ!Box (`192.168.15.1`). There
  are no per-device stats and no per-device rules.
- **Both upstream fields point at AdGuard.** The FRITZ!Box queries its preferred and alternative
  servers in parallel, not as a fallback, so a public resolver in the second field would let
  ads through.

## Settings

Set through AdGuard's API on first install. The UI can change them afterwards, and
`AdGuardHome.yaml` in `adguard_conf` then holds the result.

- Upstreams: `https://dns.quad9.net/dns-query`, `https://cloudflare-dns.com/dns-query`, load balanced.
  Bootstrap: `9.9.9.10`, `1.1.1.1`.
- Private reverse DNS: `192.168.15.1`, so the query log can name LAN addresses.
- `[/fritz.box/]192.168.15.1`, in case something asks AdGuard for a local name directly.
  **Never** add the FRITZ!Box as a general upstream: the FRITZ!Box already forwards to AdGuard,
  so that would be a DNS loop.
- Blocklists: AdGuard DNS filter and HaGeZi Multi Pro.
- Blocked answers carry a 10 s TTL, so unblocking something takes effect quickly.

## FRITZ!Box

Internet › Account Information › DNS Server › **Use other DNSv4 servers**. Set both
*Preferred* and *Alternative* to `192.168.15.126`, then Apply. The FRITZ!Box asks for a
confirmation for this change: press a button on the box, use an authenticator code, or dial
the code it shows on a connected phone.

### Emergency: the mini PC is down

When the box is off, nothing in the house resolves. Switch back by hand. This takes about
30 s and needs no DNS:

1. On a phone on the home Wi-Fi, open `http://192.168.15.1`. Use the address, not `fritz.box`.
2. Internet › Account Information › DNS Server › **Use DNSv4 servers assigned by the
   Internet service provider** › Apply.
3. Once the mini PC is back, set it to AdGuard again as above, with the button press.

The hub will do step 2 by itself while the box is up and only AdGuard has failed. Whether the
FRITZ!Box asks for a confirmation when switching *to* the provider decides how much of that
can be automatic. See [Hub switch](#hub-switch).

## Hub switch

The FRITZ!Box exposes DNS servers read-only over TR-064 on FRITZ!OS 8.25, so the hub drives the
same form the web UI posts (`data.lua`, page `dnsSrv`, each IPv4 address as four octet fields
`ipv4_user_firstdns0..3`). It logs in as the FRITZ!Box user `hub-dns`, whose login is in
`~/.config/homelab/fritzbox-hub.env` on the box (mode 600). The same `FRITZ_*` values go into
the hub's Dokploy Environment tab.

Measured 2026-10-03: pointing the upstream at a custom server comes back with
`"apply": "twofactor"` (button, authenticator or phone). The FRITZ!Box confirmation stays on.
It protects every sensitive router setting, not just this one.

## Deploying

Push to `main` (`.github/workflows/adguard.yml`, Dokploy app `adguard`). A redeploy restarts
the container. Devices retry, and the FRITZ!Box caches recent answers, so the gap is seconds.

```sh
ssh homelab
docker logs -f adguard
dig @192.168.15.126 example.com            # straight at AdGuard
dig @192.168.15.126 doubleclick.net        # 0.0.0.0 when blocking works
dig @192.168.15.1 doubleclick.net          # the same through the FRITZ!Box, once it points here
```
