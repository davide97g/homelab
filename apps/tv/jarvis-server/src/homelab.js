import { readFile } from 'node:fs/promises';
import net from 'node:net';

// The container sees the host's /proc at this path (see docker-compose.yml). Falling
// back to its own /proc keeps `npm start` on a laptop useful for development.
const PROC = process.env.HOST_PROC || '/proc';

// Ports, not the Docker API: the box runs Dokploy/Swarm services, plain compose
// projects in ~/mediarr, and cloudflared as a systemd unit. A TCP connect is the one
// check that treats all three the same and needs no socket mounted into this container.
const SERVICES = [
  { name: 'dokploy', port: 3000 },
  { name: 'traefik', port: 443 },
  { name: 'grafana', port: 3001 },
  { name: 'dashboard', port: 3002 },
  { name: 'jellyfin', port: 8096 },
  { name: 'jellyseerr', port: 5055 },
  { name: 'radarr', port: 7878 },
  { name: 'sonarr', port: 8989 },
  { name: 'qbit', port: 8080 },   // short: the TV prints these on one line
];

const HOST = process.env.HOMELAB_HOST || '127.0.0.1';

function probe(port, timeout = 1200) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (up) => { sock.destroy(); resolve(up); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, HOST);
  });
}

async function cpuTotals() {
  const line = (await readFile(`${PROC}/stat`, 'utf8')).split('\n')[0];
  const v = line.split(/\s+/).slice(1).map(Number);
  const idle = v[3] + v[4];                       // idle + iowait
  const total = v.reduce((a, b) => a + b, 0);
  return { idle, total };
}

let prev = null;

async function cpuPercent() {
  const now = await cpuTotals();
  if (!prev) { prev = now; return 0; }
  const dTotal = now.total - prev.total;
  const dIdle = now.idle - prev.idle;
  prev = now;
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - dIdle / dTotal))));
}

async function memory() {
  const text = await readFile(`${PROC}/meminfo`, 'utf8');
  const kb = (key) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
  const total = kb('MemTotal');
  // MemAvailable, not MemFree: page cache is not "used" in any sense a person means.
  const used = total - kb('MemAvailable');
  return { usedGb: Math.round(used / 1048576), totalGb: Math.round(total / 1048576) };
}

async function uptime() {
  const secs = Number((await readFile(`${PROC}/uptime`, 'utf8')).split(' ')[0]);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((secs % 3600) / 60)}m`;
}

export async function snapshot() {
  const [cpu, mem, up, services] = await Promise.all([
    cpuPercent(),
    memory(),
    uptime(),
    Promise.all(SERVICES.map(async (s) => ({ name: s.name, up: await probe(s.port) }))),
  ]);

  return {
    type: 'status',
    host: {
      name: process.env.HOMELAB_NAME || 'debian',
      cpu,
      memUsed: mem.usedGb,
      memTotal: mem.totalGb,
      uptime: up,
    },
    services,
  };
}

/** A compact plain-text rendering, for the model to read as context. */
export function describe(snap) {
  const h = snap.host;
  const down = snap.services.filter((s) => !s.up).map((s) => s.name);
  const up = snap.services.filter((s) => s.up).map((s) => s.name);
  return [
    `Host ${h.name}: CPU ${h.cpu}%, RAM ${h.memUsed}/${h.memTotal} GB used, uptime ${h.uptime}.`,
    `Services responding: ${up.join(', ') || 'none'}.`,
    `Services not responding: ${down.join(', ') || 'none'}.`,
  ].join(' ');
}
