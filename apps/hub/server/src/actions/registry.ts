import { config } from "../config.js";
import { containerCommand, dockerConfigured } from "../docker/client.js";
import { resolveManaged } from "../collect/containers.js";
import { arrCommand, arrConfigured, dokployDeploy, qbitAll, qbitConfigured } from "../media/clients.js";
import { setTunnel, vpnConfigured } from "../media/vpn.js";
import type { ActionDef, ActionRisk, ActionTargetKind } from "../wire.js";
import { Denied } from "./denied.js";

// Every write the hub can perform, in one file, in the same spirit as the series
// registry: the browser sends an id and a target, never a command.
//
// `run` is the only place anything happens. Everything around it -- auth, rate
// limit, confirmation, idempotency, audit, error shaping -- lives once in
// dispatch.ts, because twelve routes means twelve chances to forget one of them
// and the twelfth is the one that matters.

export type Definition = {
  id: string;
  label: string;
  description: string;
  risk: ActionRisk;
  confirm: boolean;
  target: ActionTargetKind;
  /** Non-idempotent upstream: a second call queues a second search or a second
   *  deploy. The idempotency key is what makes a double-click safe for these. */
  replayable: boolean;
  available: () => { ok: true } | { ok: false; why: string };
  choices?: () => { value: string; label: string }[];
  /** Returns the sentence that goes to both the caller and the audit. */
  run: (target: string) => Promise<string>;
};

/** `label=composeId` pairs from the environment. Dokploy has no scoped tokens,
 *  so the key the hub holds can delete every service on the box; the only thing
 *  standing between a bug here and that is this list. */
function dokployApps(): { value: string; label: string }[] {
  return config.dokployAllow.map((entry) => {
    const [label, id] = entry.includes("=") ? entry.split("=", 2) : [entry, entry];
    return { value: (id ?? entry).trim(), label: (label ?? entry).trim() };
  });
}

const dockerAvailable = () =>
  dockerConfigured() ? ({ ok: true } as const) : ({ ok: false, why: "the Docker socket proxy is not configured" } as const);

const arrAvailable = (app: "radarr" | "sonarr") => () =>
  arrConfigured(app)
    ? ({ ok: true } as const)
    : ({ ok: false, why: `${app}'s API key has not been collected on the box — run scripts/collect-env.sh there` } as const);

async function container(target: string, command: "start" | "stop" | "restart"): Promise<string> {
  // Resolved against the live list, so a name the browser invented cannot reach
  // Docker, and the deny-list is applied here rather than trusted from the UI.
  const found = await resolveManaged(target);
  // A name that does not resolve, a container on the NAS and a deny-listed one
  // are all refusals rather than failures — nothing was attempted.
  if ("error" in found) throw new Denied(found.error);
  await containerCommand(found.id, command);
  return `${command}ed ${found.name}`;
}

export const ACTIONS: Record<string, Definition> = {
  "container.restart": {
    id: "container.restart",
    label: "Restart container",
    description: "Stops the container with a 30 second grace period, then starts it again.",
    risk: "medium",
    confirm: true,
    target: "container",
    replayable: false,
    available: dockerAvailable,
    run: (t) => container(t, "restart"),
  },
  "container.stop": {
    id: "container.stop",
    label: "Stop container",
    description: "Stops the container and leaves it stopped. Nothing here will start it again on its own.",
    risk: "high",
    confirm: true,
    target: "container",
    replayable: false,
    available: dockerAvailable,
    run: (t) => container(t, "stop"),
  },
  "container.start": {
    id: "container.start",
    label: "Start container",
    description: "Starts a stopped container.",
    risk: "low",
    confirm: false,
    target: "container",
    replayable: false,
    available: dockerAvailable,
    run: (t) => container(t, "start"),
  },

  "radarr.search-missing": {
    id: "radarr.search-missing",
    label: "Search for missing films",
    description: "Queues a search across everything Radarr is monitoring and does not have.",
    risk: "low",
    confirm: false,
    target: "none",
    // A second call queues a second search; Radarr runs both.
    replayable: true,
    available: arrAvailable("radarr"),
    run: () => arrCommand("radarr", "MissingMoviesSearch"),
  },
  "sonarr.search-missing": {
    id: "sonarr.search-missing",
    label: "Search for missing episodes",
    description: "Queues a search across everything Sonarr is monitoring and does not have.",
    risk: "low",
    confirm: false,
    target: "none",
    replayable: true,
    available: arrAvailable("sonarr"),
    run: () => arrCommand("sonarr", "MissingEpisodeSearch"),
  },
  "qbittorrent.stop-all": {
    id: "qbittorrent.stop-all",
    label: "Stop all torrents",
    description: "Stops every torrent. Useful when the link is needed for something else; nothing is removed.",
    risk: "medium",
    confirm: true,
    target: "none",
    replayable: false,
    available: () =>
      qbitConfigured()
        ? { ok: true }
        : { ok: false, why: "qBittorrent's login has not been collected on the box" },
    run: () => qbitAll("stop"),
  },
  "qbittorrent.start-all": {
    id: "qbittorrent.start-all",
    label: "Start all torrents",
    description: "Starts every torrent that is stopped.",
    risk: "low",
    confirm: false,
    target: "none",
    replayable: false,
    available: () =>
      qbitConfigured()
        ? { ok: true }
        : { ok: false, why: "qBittorrent's login has not been collected on the box" },
    run: () => qbitAll("start"),
  },

  // The kill switch, as two actions rather than one toggle: a toggle's meaning
  // depends on a state the caller may have read seconds ago, and "stop the
  // tunnel" should never be the thing a stale page sends by accident. Both are
  // idempotent upstream -- stopping a stopped tunnel is a no-op in gluetun.
  "vpn.kill-switch": {
    id: "vpn.kill-switch",
    label: "Engage the VPN kill switch",
    description:
      "Takes the ProtonVPN tunnel down and leaves gluetun's firewall up: qBittorrent keeps running with no route out, so every torrent stops. Nothing else on the box is affected.",
    risk: "high",
    confirm: true,
    target: "none",
    replayable: false,
    available: () =>
      vpnConfigured()
        ? { ok: true }
        : { ok: false, why: "gluetun's API key has not been collected — set GLUETUN_API_KEY" },
    run: () => setTunnel("stopped"),
  },
  "vpn.release": {
    id: "vpn.release",
    label: "Release the VPN kill switch",
    description:
      "Brings the ProtonVPN tunnel back up. gluetun reconnects, takes a new forwarded port and rebinds qBittorrent to it; torrents resume on their own.",
    risk: "medium",
    confirm: true,
    target: "none",
    replayable: false,
    available: () =>
      vpnConfigured()
        ? { ok: true }
        : { ok: false, why: "gluetun's API key has not been collected — set GLUETUN_API_KEY" },
    run: () => setTunnel("running"),
  },

  "dokploy.redeploy": {
    id: "dokploy.redeploy",
    label: "Redeploy a stack",
    description: "Rebuilds and restarts one Dokploy compose app. Only the apps allow-listed in the environment.",
    risk: "high",
    confirm: true,
    target: "dokploy",
    // A second call is a second deploy, which is a second outage window.
    replayable: true,
    available: () =>
      config.dokployKey && dokployApps().length > 0
        ? { ok: true }
        : {
            ok: false,
            why: config.dokployKey
              ? "no compose apps are allow-listed — set DOKPLOY_ALLOW to label=composeId pairs"
              : "DOKPLOY_API_KEY has not been collected on the box",
          },
    choices: dokployApps,
    run: async (target) => {
      const allowed = dokployApps().find((a) => a.value === target);
      if (!allowed) throw new Denied("that compose app is not on the allow-list");
      const message = await dokployDeploy(allowed.value);
      return `${allowed.label}: ${message}`;
    },
  },
};

export function catalog(): ActionDef[] {
  return Object.values(ACTIONS).map((def): ActionDef => {
    const availability = def.available();
    const entry: ActionDef = {
      id: def.id,
      label: def.label,
      description: def.description,
      risk: def.risk,
      confirm: def.confirm,
      target: def.target,
      available: availability.ok,
      replayable: def.replayable,
    };
    if (!availability.ok) entry.unavailable = availability.why;
    if (def.choices) entry.choices = def.choices();
    return entry;
  });
}
