import { Cache } from "../cache.js";
import { config } from "../config.js";
import { dockerConfigured, inspectContainer } from "../docker/client.js";
import { getJson, request, ServiceError, soft } from "../http.js";
import type { Status, VpnSnapshot, VpnTunnel } from "../wire.js";
import { qbitConfigured, qbitGet } from "./clients.js";

// The ProtonVPN tunnel qBittorrent lives inside, as gluetun reports it.
//
// qBittorrent runs in gluetun's network namespace (stacks/mediarr), so it has no
// route out except the tunnel. That makes gluetun's own state the kill switch:
// `PUT /v1/vpn/status {"status":"stopped"}` takes the tunnel down and leaves the
// firewall up, so torrents stop dead instead of falling back to the home line.
// Measured on the box before any of this was written: 90 s held down, zero
// bytes out, gluetun still healthy (so heal.sh leaves it alone), and back with
// a fresh forwarded port 5 s after `running`.
//
// Two sources, on purpose. gluetun says what the tunnel *is*; qBittorrent says
// what peers *see* -- `last_external_address_v4` is the address trackers told it
// they saw. The leak check compares the second against the box's own egress,
// which is read here and never leaves the server.

const cache = new Cache(config.cacheMs);

/** The box's own address changes rarely and costs a request to someone else to
 *  learn, so it is asked for once every ten minutes. */
const HOME_TTL_MS = 10 * 60_000;

export function vpnConfigured(): boolean {
  return Boolean(config.gluetun.key);
}

function gluetun<T>(path: string): Promise<T> {
  return getJson<T>(`${config.gluetun.url}${path}`, {
    headers: { "x-api-key": config.gluetun.key },
    timeoutMs: 5000,
  });
}

/** The kill switch. Stopping the tunnel keeps gluetun's firewall in place,
 *  which is the whole point: qBittorrent keeps running and has nowhere to send
 *  a byte. Starting it reconnects to Proton, and gluetun's port-forward hook
 *  rebinds qBittorrent to tun0 on the new port by itself. */
export async function setTunnel(status: "running" | "stopped"): Promise<string> {
  if (!vpnConfigured()) throw new ServiceError("GLUETUN_API_KEY has not been collected on the box");
  const res = await request(`${config.gluetun.url}/v1/vpn/status`, {
    method: "PUT",
    headers: { "x-api-key": config.gluetun.key, "content-type": "application/json" },
    body: JSON.stringify({ status }),
    // Stopping is quick; starting waits on the WireGuard handshake.
    timeoutMs: 30_000,
  });
  const body = (await res.json().catch(() => null)) as { outcome?: string } | null;
  cache.delete("vpn");
  return status === "stopped"
    ? `kill switch engaged: tunnel ${body?.outcome ?? "stopped"}, torrents have no route out`
    : `kill switch released: tunnel ${body?.outcome ?? "running"}, reconnecting to Proton`;
}

/** What the box looks like from outside when it is *not* in the tunnel -- the
 *  hub's own egress. Cloudflare's trace endpoint, because it is plain text,
 *  tiny, and already the network every public hostname here sits on. */
async function homeEgress(): Promise<string | null> {
  const res = await request("https://www.cloudflare.com/cdn-cgi/trace", { timeoutMs: 5000 });
  const ip = /^ip=(.+)$/m.exec(await res.text())?.[1]?.trim();
  return ip || null;
}

type PublicIp = {
  public_ip?: string;
  city?: string;
  country?: string;
  hostname?: string;
  organization?: string;
};
type Transfer = {
  last_external_address_v4?: string;
  connection_status?: string;
  dl_info_speed?: number;
  up_info_speed?: number;
};
type Prefs = { listen_port?: number; current_network_interface?: string };

async function collect(): Promise<VpnSnapshot> {
  const base = { provider: "ProtonVPN", protocol: "WireGuard" };

  let tunnel: VpnTunnel = "unknown";
  let error: string | undefined;
  try {
    const got = await gluetun<{ status?: string }>("/v1/vpn/status");
    tunnel = got?.status === "running" ? "running" : got?.status === "stopped" ? "stopped" : "unknown";
  } catch (err) {
    error = `gluetun did not answer: ${err instanceof Error ? err.message : String(err)}`;
  }

  const running = tunnel === "running";
  const [ip, pf, transfer, prefs, inspect, home] = await Promise.all([
    running ? soft(gluetun<PublicIp>("/v1/publicip/ip")) : Promise.resolve(null),
    running ? soft(gluetun<{ port?: number }>("/v1/portforward")) : Promise.resolve(null),
    qbitConfigured() ? soft(qbitGet<Transfer>("/api/v2/transfer/info")) : Promise.resolve(null),
    qbitConfigured() ? soft(qbitGet<Prefs>("/api/v2/app/preferences")) : Promise.resolve(null),
    dockerConfigured() ? soft(inspectContainer("gluetun")) : Promise.resolve(null),
    soft(cache.get("home", homeEgress, HOME_TTL_MS)),
  ]);

  const exit =
    running && ip?.public_ip
      ? {
          ip: ip.public_ip,
          city: ip.city ?? "",
          country: ip.country ?? "",
          // "AS212238 Datacamp Limited" -- the AS number is noise on a card.
          org: (ip.organization ?? "").replace(/^AS\d+\s+/, ""),
          hostname: ip.hostname ?? "",
        }
      : null;
  const forwardedPort = pf?.port ? pf.port : null;

  const torrent =
    transfer || prefs
      ? {
          externalIp: transfer?.last_external_address_v4 || null,
          listenPort: prefs?.listen_port ?? null,
          iface: prefs?.current_network_interface || null,
          bound: prefs?.current_network_interface === "tun0",
          portMatches: forwardedPort !== null && prefs?.listen_port === forwardedPort,
          downBytesPerSec: transfer?.dl_info_speed ?? 0,
          upBytesPerSec: transfer?.up_info_speed ?? 0,
        }
      : null;

  const killSwitch = tunnel === "stopped";
  const seen = torrent?.externalIp ?? null;
  let leak: VpnSnapshot["leak"];
  if (killSwitch) {
    leak = { checked: true, clean: true, detail: "Tunnel held down: nothing leaves, so there is nothing to leak." };
  } else if (!home) {
    leak = { checked: false, clean: null, detail: "The box's own address could not be read, so nothing was compared." };
  } else if (seen && seen === home) {
    leak = { checked: true, clean: false, detail: "Peers are seeing the home line. The tunnel is not in the path." };
  } else if (exit && exit.ip === home) {
    leak = { checked: true, clean: false, detail: "gluetun's exit is the home line. The tunnel is not in the path." };
  } else if (seen) {
    leak = { checked: true, clean: true, detail: "Peers see the Proton exit, not the home line." };
  } else if (!torrent) {
    leak = { checked: false, clean: null, detail: "qBittorrent could not be read, so what peers see was not checked." };
  } else {
    leak = { checked: false, clean: null, detail: "qBittorrent has not been told its external address yet." };
  }

  let status: Status;
  if (tunnel === "unknown") status = "down";
  else if (leak.clean === false) status = "down";
  else if (killSwitch) status = "warn";
  else if (!torrent?.bound || !torrent.portMatches) status = "warn";
  else status = "up";

  const snapshot: VpnSnapshot = {
    ...base,
    status,
    tunnel,
    killSwitch,
    exit,
    forwardedPort,
    torrent,
    leak,
    since: inspect?.State.StartedAt ?? null,
  };
  if (error) snapshot.error = error;
  else if (leak.clean === false) snapshot.error = leak.detail;
  return snapshot;
}

/** Shared by /api/media and /api/topology, so the two pages cannot disagree
 *  about whether torrents are in the tunnel. */
export function vpnSnapshot(): Promise<VpnSnapshot> {
  return cache.get("vpn", collect);
}
