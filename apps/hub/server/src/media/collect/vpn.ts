import { config } from "../../config.js";
import { duration } from "../../format.js";
import type { MediaActivity, MediaStat, VpnSnapshot } from "../../wire.js";
import { vpnConfigured, vpnSnapshot } from "../vpn.js";
import { type Collected, down, unconfigured } from "./shape.js";

// The tunnel as a pipeline node. The card on /media is drawn from the typed
// `MediaPipeline.vpn` snapshot, because the kill switch acts on its state; these
// stats are the same facts in the generic shape, for the drawer and for anything
// else that renders a node without knowing what it is.

const ROLE = "WireGuard tunnel · qBittorrent's only way out";

export async function collectVpn(): Promise<{ collected: Collected; vpn: VpnSnapshot | null }> {
  const link = config.links.vpn;
  if (!vpnConfigured()) {
    return { collected: unconfigured("vpn", "ProtonVPN", ROLE, link, "GLUETUN_API_KEY"), vpn: null };
  }

  const started = Date.now();
  let vpn: VpnSnapshot;
  try {
    vpn = await vpnSnapshot();
  } catch (err) {
    return { collected: down("vpn", "ProtonVPN", ROLE, link, err), vpn: null };
  }

  const t = vpn.torrent;
  const stats: MediaStat[] = [
    {
      id: "tunnel",
      label: "Tunnel",
      value: vpn.killSwitch ? "held down" : vpn.tunnel === "running" ? "up" : "unknown",
      hint: vpn.killSwitch ? "kill switch engaged" : `${vpn.provider} · ${vpn.protocol}`,
      tone: vpn.killSwitch ? "warn" : vpn.tunnel === "running" ? "good" : "bad",
    },
    {
      id: "exit",
      label: "Exit",
      value: vpn.exit ? [vpn.exit.city, vpn.exit.country].filter(Boolean).join(", ") || vpn.exit.ip : "—",
      ...(vpn.exit ? { hint: vpn.exit.ip } : {}),
      tone: vpn.exit ? "accent" : "default",
    },
    {
      id: "port",
      label: "Forwarded port",
      value: vpn.forwardedPort ? String(vpn.forwardedPort) : "none",
      hint: t?.listenPort ? `qBittorrent listening on ${t.listenPort}` : "qBittorrent not listening",
      tone: t?.portMatches ? "good" : vpn.killSwitch ? "default" : "warn",
    },
    {
      id: "leak",
      label: "Leak check",
      value: vpn.leak.clean === true ? "clean" : vpn.leak.clean === false ? "LEAKING" : "unchecked",
      hint: vpn.leak.detail,
      tone: vpn.leak.clean === true ? "good" : vpn.leak.clean === false ? "bad" : "warn",
    },
  ];
  if (vpn.since) {
    stats.push({
      id: "since",
      label: "gluetun up",
      value: duration((Date.now() - Date.parse(vpn.since)) / 1000),
    });
  }

  const activity: MediaActivity[] = [];
  if (vpn.exit) {
    activity.push({
      id: "server",
      title: vpn.exit.hostname || vpn.exit.ip,
      subtitle: [vpn.exit.org, vpn.exit.ip].filter(Boolean).join(" · "),
      state: "exit",
      tone: "accent",
    });
  }
  if (t) {
    activity.push({
      id: "binding",
      title: `qBittorrent bound to ${t.iface ?? "nothing"}`,
      subtitle: t.externalIp ? `peers report seeing ${t.externalIp}` : "no external address reported yet",
      state: t.bound ? "tun0" : "unbound",
      tone: t.bound ? "good" : vpn.killSwitch ? "default" : "warn",
    });
  }

  return {
    collected: {
      node: {
        id: "vpn",
        label: "ProtonVPN",
        role: ROLE,
        link,
        status: vpn.status,
        ...(vpn.error ? { error: vpn.error } : {}),
        latencyMs: Date.now() - started,
        stats,
        flags: [
          { label: "tunnel up", on: vpn.tunnel === "running" },
          { label: "bound to tun0", on: Boolean(t?.bound) },
          { label: "kill switch", on: vpn.killSwitch },
        ],
        activity,
        activityLabel: "Path",
      },
      flow: { running: vpn.tunnel === "running" ? 1 : 0, killSwitch: vpn.killSwitch ? 1 : 0 },
    },
    vpn,
  };
}
