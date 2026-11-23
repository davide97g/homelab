# Host metrics: pending reboot and apt upgrades

`unattended-upgrades` installs Debian security fixes every morning, but a new kernel waits for a
reboot, and Docker, cloudflared, Chrome and Tailscale only move with a manual
`sudo apt full-upgrade`. Nothing said so until 2026-11-23, when the box had been waiting for a
reboot since 2026-11-14 with 23 packages pending.

`host-metrics.sh` (user timer, every 30 min, no sudo) writes `~/ops/metrics/host.prom`;
node-exporter's textfile collector reads it, and Prometheus fires:

| Alert | When |
|---|---|
| `RebootRequired` | `/var/run/reboot-required` older than 3 days |
| `AptUpgradesPending` | something upgradable for 7 days |
| `HostMetricsMissing` | the file is not being read |

Clearing them is the manual pass in the root README (*Host*, Patching): `ssh -t homelab`, then
`sudo apt full-upgrade` and `sudo reboot`.

```sh
scp -r hosts/debian/host-metrics homelab:/tmp/ && ssh homelab 'bash /tmp/host-metrics/install.sh'
```
