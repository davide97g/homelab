const BASE = (process.env.JELLYFIN_URL || '').replace(/\/$/, '');
const TOKEN = process.env.JELLYFIN_TOKEN || '';
const USER = process.env.JELLYFIN_USER_ID || '';

// The TV's Jellyfin client registers under this name. Sessions are matched on it
// rather than on a session id, because the id changes every time the app restarts.
const DEVICE = process.env.JELLYFIN_DEVICE || 'TV Davide';

export const configured = Boolean(BASE && TOKEN && USER);

// Jellyfin 12 dropped X-Emby-Token and answers 401 to it. Only the MediaBrowser
// scheme works; the mini PC's 10.11 accepts both, so this is safe for either.
const auth = { Authorization: `MediaBrowser Token="${TOKEN}"` };

async function req(path, { method = 'GET' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: method === 'POST' ? { ...auth, 'Content-Length': '0' } : auth,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Jellyfin ${method} ${path} -> ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function search(query, limit = 8) {
  const qs = new URLSearchParams({
    searchTerm: query,
    recursive: 'true',
    includeItemTypes: 'Movie,Series,Episode',
    limit: String(limit),
    fields: 'ProductionYear,Overview',
  });
  const out = await req(`/Users/${USER}/Items?${qs}`);
  return (out?.Items ?? []).map((i) => ({
    id: i.Id,
    name: i.Name,
    year: i.ProductionYear ?? null,
    type: i.Type,
  }));
}

/** The TV's session, or null when the Jellyfin app is not open on it. */
export async function tvSession() {
  const sessions = await req('/Sessions');
  return (sessions ?? []).find(
    (s) => s.DeviceName === DEVICE && s.SupportsRemoteControl,
  ) ?? null;
}

export async function nowPlaying() {
  const s = await tvSession();
  const item = s?.NowPlayingItem;
  if (!item) return null;
  const state = s.PlayState ?? {};
  // Ticks are 100-nanosecond units. Seconds are what a progress bar wants.
  const secs = (t) => (typeof t === 'number' ? Math.round(t / 10_000_000) : null);
  return {
    name: item.Name,
    year: item.ProductionYear ?? null,
    type: item.Type,
    paused: Boolean(state.IsPaused),
    position: secs(state.PositionTicks),
    duration: secs(item.RunTimeTicks),
    volume: state.VolumeLevel ?? null,
    muted: Boolean(state.IsMuted),
  };
}

/** Everything the phone needs to draw its controls in one round trip. */
export async function tvState() {
  const s = await tvSession();
  if (!s) return { session: false, nowPlaying: null };
  const item = s.NowPlayingItem;
  const state = s.PlayState ?? {};
  const secs = (t) => (typeof t === 'number' ? Math.round(t / 10_000_000) : null);
  return {
    session: true,
    volume: state.VolumeLevel ?? null,
    muted: Boolean(state.IsMuted),
    nowPlaying: item
      ? {
          id: item.Id,
          name: item.Name,
          year: item.ProductionYear ?? null,
          type: item.Type,
          paused: Boolean(state.IsPaused),
          position: secs(state.PositionTicks),
          duration: secs(item.RunTimeTicks),
        }
      : null,
  };
}

/**
 * General session command. The TV's Jellyfin client advertises VolumeUp, VolumeDown,
 * SetVolume, Mute, Unmute and ToggleMute among its SupportedCommands, which is how
 * the phone changes volume without JointSpace pairing.
 */
export async function command(name, args) {
  const s = await tvSession();
  if (!s) throw new Error('no-session');
  const qs = args ? '?' + new URLSearchParams(args) : '';
  await req(`/Sessions/${s.Id}/Command/${name}${qs}`, { method: 'POST' });
}

export async function seek(positionSeconds) {
  const s = await tvSession();
  if (!s) throw new Error('no-session');
  const ticks = Math.max(0, Math.round(positionSeconds)) * 10_000_000;
  await req(`/Sessions/${s.Id}/Playing/Seek?seekPositionTicks=${ticks}`, { method: 'POST' });
}

/** Start an item on the TV, launching the app first when nothing is listening. */
export async function ensureSession() {
  return (await tvSession()) ?? null;
}

export async function playOnTv(itemId, sessionId) {
  await req(`/Sessions/${sessionId}/Playing?playCommand=PlayNow&itemIds=${itemId}`, { method: 'POST' });
}

const COMMANDS = {
  pause: 'Pause',
  resume: 'Unpause',
  stop: 'Stop',
  next: 'NextTrack',
  previous: 'PreviousTrack',
};

export async function control(action) {
  const cmd = COMMANDS[action];
  if (!cmd) throw new Error(`unknown playback action: ${action}`);
  const s = await tvSession();
  if (!s) throw new Error('no-session');
  // Stop has its own route; the rest go through the generic command endpoint.
  const path = cmd === 'Stop'
    ? `/Sessions/${s.Id}/Playing/Stop`
    : `/Sessions/${s.Id}/Playing/${cmd}`;
  await req(path, { method: 'POST' });
}

/**
 * Poll until the TV's Jellyfin app has registered a session. It takes a few seconds
 * to start and sign in, and a PlayNow sent before then is simply dropped.
 */
export async function waitForSession(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await tvSession().catch(() => null);
    if (s) return s;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
