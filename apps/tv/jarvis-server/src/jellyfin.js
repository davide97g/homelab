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

/**
 * What the viewer is part-way through, newest first — the launcher's showcase.
 * `Resume` is the same list the Jellyfin app's own "Continue watching" row shows,
 * so the TV is not inventing a shelf of its own.
 */
export async function resume(limit = 6) {
  const qs = new URLSearchParams({
    limit: String(limit),
    mediaTypes: 'Video',
    fields: 'ProductionYear,RunTimeTicks,UserData,Genres',
    enableImageTypes: 'Backdrop,Primary,Thumb',
  });
  const out = await req(`/Users/${USER}/Items/Resume?${qs}`);
  const secs = (t) => (typeof t === 'number' ? Math.round(t / 10_000_000) : null);
  return (out?.Items ?? []).map((i) => ({
    id: i.Id,
    name: i.Name,
    seriesName: i.SeriesName ?? null,
    year: i.ProductionYear ?? null,
    type: i.Type,
    position: secs(i.UserData?.PlaybackPositionTicks),
    duration: secs(i.RunTimeTicks),
    // a backdrop when the item has one, its own poster otherwise, and for an episode
    // the series' backdrop, which is the only image an episode reliably carries
    image: i.BackdropImageTags?.length
      ? { id: i.Id, type: 'Backdrop', tag: i.BackdropImageTags[0] }
      : i.ParentBackdropImageTags?.length
        ? { id: i.ParentBackdropItemId, type: 'Backdrop', tag: i.ParentBackdropImageTags[0] }
        : i.ImageTags?.Primary
          ? { id: i.Id, type: 'Primary', tag: i.ImageTags.Primary }
          : null,
  }));
}

/** The newest thing in the library, for when nothing is part-way watched. */
export async function latest(limit = 6) {
  const qs = new URLSearchParams({
    limit: String(limit),
    includeItemTypes: 'Movie',
    fields: 'ProductionYear,RunTimeTicks',
    enableImageTypes: 'Backdrop,Primary',
  });
  const out = await req(`/Users/${USER}/Items/Latest?${qs}`);
  return (out ?? []).map((i) => ({
    id: i.Id,
    name: i.Name,
    year: i.ProductionYear ?? null,
    type: i.Type,
    position: null,
    duration: typeof i.RunTimeTicks === 'number' ? Math.round(i.RunTimeTicks / 10_000_000) : null,
    image: i.BackdropImageTags?.length
      ? { id: i.Id, type: 'Backdrop', tag: i.BackdropImageTags[0] }
      : i.ImageTags?.Primary
        ? { id: i.Id, type: 'Primary', tag: i.ImageTags.Primary }
        : null,
  }));
}

/**
 * Jellyfin's image bytes, fetched here and handed on.
 *
 * The TV cannot reach this Jellyfin at all: it lives on the NAS and the box gets to it
 * over Tailscale. So the server is the only thing on the LAN that can hand the
 * launcher a picture, and it resizes on the way through — 1280 px is more than a
 * 1920x1080 surface needs behind a scrim, and the set has 2 GB of RAM.
 */
export async function image(id, { type = 'Backdrop', tag, maxWidth = 1280 } = {}) {
  const qs = new URLSearchParams({ maxWidth: String(maxWidth), quality: '82' });
  if (tag) qs.set('tag', tag);
  const res = await fetch(`${BASE}/Items/${id}/Images/${type}?${qs}`, {
    headers: auth,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Jellyfin image ${id} -> ${res.status}`);
  return {
    contentType: res.headers.get('content-type') || 'image/jpeg',
    body: Buffer.from(await res.arrayBuffer()),
  };
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
