import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { Bonjour } from 'bonjour-service';
import { createServer } from 'node:http';
import { snapshot, describe } from './homelab.js';
import { transcribe, chat, systemPrompt, TOOLS } from './openai.js';
import * as jf from './jellyfin.js';
import * as tv from './jointspace.js';

const PORT = Number(process.env.PORT || 8787);
const JELLYFIN_PACKAGE = 'org.jellyfin.androidtv';

const app = express();
const http = createServer(app);

app.use(express.json());
app.use(express.static('public'));

// ── TV clients ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: http, path: '/ws' });
const tvs = new Set();

wss.on('connection', async (ws) => {
  tvs.add(ws);
  ws.on('close', () => tvs.delete(ws));
  ws.on('error', () => tvs.delete(ws));
  // The launcher can hold more than one socket open across a relaunch, so every
  // frame goes to all of them rather than to "the" TV.
  ws.send(JSON.stringify(await snapshot()));
});

function broadcast(frame) {
  const text = JSON.stringify(frame);
  for (const ws of tvs) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
}

// ── tools ──────────────────────────────────────────────────────────────────────

const pick = (items, query) => {
  if (items.length === 0) return null;
  const q = query.toLowerCase();
  // Prefer an exact-ish title match, then a film over an episode: "metti harry
  // potter" means the movie, even when an episode's name also matches.
  const rank = (i) =>
    (i.name.toLowerCase() === q ? 0 : i.name.toLowerCase().startsWith(q) ? 1 : 2) * 10 +
    ({ Movie: 0, Series: 1, Episode: 2 }[i.type] ?? 3);
  return [...items].sort((a, b) => rank(a) - rank(b))[0];
};

const title = (i) => (i.year ? `${i.name} (${i.year})` : i.name);

/**
 * Start an item on the TV, opening Jellyfin first if it is closed.
 *
 * Re-sending PlayNow for whatever is *already* on screen does not restart it: the
 * app stops and falls back to its browse screen. So the already-playing case is
 * handled here instead of being sent to the TV.
 */
async function start(itemId) {
  let session = await jf.tvSession();

  if (session?.NowPlayingItem?.Id === itemId) {
    if (session.PlayState?.IsPaused) {
      await jf.control('resume');
      return { resumed: true };
    }
    return { alreadyPlaying: true };
  }

  if (!session) {
    // Nothing is listening yet. Ask the launcher to open the app, then wait for
    // the session to register before sending anything to it.
    broadcast({ type: 'launch', package: JELLYFIN_PACKAGE });
    session = await jf.waitForSession();
    if (!session) return { error: 'Jellyfin non si è avviato sulla TV in tempo.' };
  }

  await jf.playOnTv(itemId, session.Id);
  return { started: true };
}

async function playMedia({ query }) {
  if (!jf.configured) return { ok: false, error: 'Jellyfin non è configurato.' };

  const hits = await jf.search(query);
  const item = pick(hits, query);
  if (!item) return { ok: false, error: `Nessun risultato per "${query}" nella libreria.` };

  const outcome = await start(item.id);
  if (outcome.error) return { ok: false, error: outcome.error };
  return { ok: true, playing: title(item), type: item.type, ...outcome };
}

async function searchMedia({ query }) {
  if (!jf.configured) return { ok: false, error: 'Jellyfin non è configurato.' };
  const hits = await jf.search(query);
  return { ok: true, count: hits.length, results: hits.slice(0, 5).map(title) };
}

const KEY_MAP = {
  volume_up: 'VolumeUp', volume_down: 'VolumeDown', mute: 'Mute',
  up: 'CursorUp', down: 'CursorDown', left: 'CursorLeft', right: 'CursorRight',
  ok: 'Confirm', back: 'Back', home: 'Home', options: 'Options',
};

async function tvKey({ key, repeat }) {
  if (!tv.configured) return { ok: false, error: 'La TV non è associata.' };
  const mapped = KEY_MAP[key];
  if (!mapped) return { ok: false, error: `tasto sconosciuto: ${key}` };
  const times = Math.min(10, Math.max(1, repeat || 1));
  for (let i = 0; i < times; i++) {
    await tv.sendKey(mapped);
    if (i < times - 1) await new Promise((r) => setTimeout(r, 180));
  }
  return { ok: true, key, repeat: times };
}

async function controlPlayback({ action }) {
  if (!jf.configured) return { ok: false, error: 'Jellyfin non è configurato.' };
  try {
    await jf.control(action);
    return { ok: true, action };
  } catch (err) {
    if (String(err.message).includes('no-session')) {
      return { ok: false, error: 'Non c\'è niente in riproduzione sulla TV.' };
    }
    throw err;
  }
}

const HANDLERS = {
  play_media: playMedia,
  search_media: searchMedia,
  control_playback: controlPlayback,
  tv_key: tvKey,
};

/**
 * Run the model, execute any tools it asks for, feed the results back, and return
 * what it finally says. Two rounds is enough for "search, then confirm"; more than
 * that and it is looping rather than working.
 */
async function answer(question, context) {
  const messages = [
    { role: 'system', content: systemPrompt(context) },
    { role: 'user', content: question },
  ];

  for (let round = 0; round < 3; round++) {
    const msg = await chat(messages, TOOLS);
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return msg.content?.trim() ?? '';

    for (const call of calls) {
      const handler = HANDLERS[call.function.name];
      let result;
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        console.log('tool:', call.function.name, args);
        result = handler ? await handler(args) : { ok: false, error: 'strumento sconosciuto' };
      } catch (err) {
        console.error('tool failed:', err);
        result = { ok: false, error: String(err.message || err) };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return 'Ho fatto un po\' di confusione, riprova.';
}

// ── the phone asks, the TV answers ─────────────────────────────────────────────
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/api/ask', upload.single('audio'), async (req, res) => {
  try {
    const question = req.file
      ? await transcribe(req.file.buffer, req.file.originalname || 'clip.webm')
      : String(req.body.text || '').trim();

    if (!question) return res.status(400).json({ error: 'empty question' });

    broadcast({ type: 'transcript', text: question });

    const snap = await snapshot();
    let context = describe(snap);
    const playing = await jf.nowPlaying().catch(() => null);
    if (playing) {
      context += ` Sulla TV è ${playing.paused ? 'in pausa' : 'in riproduzione'}: ${playing.name}.`;
    }

    const reply = await answer(question, context);

    broadcast({ type: 'say', text: reply, lang: 'it-IT' });
    res.json({ question, answer: reply });
  } catch (err) {
    console.error(err);
    // Say the failure out loud too: a silent TV is indistinguishable from a TV that
    // did not hear you, and the phone may already be back in a pocket.
    broadcast({ type: 'say', text: 'Scusa, qualcosa non ha funzionato.', lang: 'it-IT' });
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── direct control from the phone ──────────────────────────────────────────────
// Everything here is what the phone can do WITHOUT JointSpace pairing: the Jellyfin
// session covers transport, volume and mute, and our own launcher covers starting
// apps. A D-pad would need the paired HTTPS API on the TV's port 1926.

const guard = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('no-session')) {
      return res.status(409).json({ error: 'La TV non ha Jellyfin aperto.' });
    }
    console.error(err);
    res.status(500).json({ error: msg });
  }
};

app.get('/api/tv', guard(async () => {
  const base = jf.configured ? await jf.tvState() : { session: false, nowPlaying: null };
  return { ...base, remote: tv.configured };
}));

app.post('/api/playback', guard(async (req) => {
  await jf.control(String(req.body.action));
  return { ok: true };
}));

// No volume endpoint on purpose. Jellyfin's Android TV client advertises VolumeUp,
// SetVolume and ToggleMute but acts on none of them, and Philips handles volume
// outside Android entirely -- even a real KEYCODE_VOLUME_DOWN leaves streamVolume
// untouched. Volume needs the paired HTTPS API on the TV's port 1926.

app.post('/api/seek', guard(async (req) => {
  const { position, delta } = req.body;
  if (typeof delta === 'number') {
    const now = await jf.nowPlaying();
    if (!now) throw new Error('no-session');
    await jf.seek(Math.max(0, (now.position ?? 0) + delta));
  } else {
    await jf.seek(Number(position));
  }
  return { ok: true };
}));

app.post('/api/key', guard(async (req) => {
  if (!tv.configured) throw new Error('La TV non è associata (JointSpace).');
  const key = String(req.body.key || '');
  if (!tv.KEYS.has(key)) throw new Error(`tasto non consentito: ${key}`);
  await tv.sendKey(key);
  return { ok: true };
}));

app.post('/api/launch', guard(async (req) => {
  const pkg = String(req.body.package || '');
  if (!/^[a-zA-Z0-9_.]+$/.test(pkg)) throw new Error('bad package name');
  broadcast({ type: 'launch', package: pkg });
  return { ok: true };
}));

app.get('/api/search', guard(async (req) => {
  if (!jf.configured) return { results: [] };
  const q = String(req.query.q || '').trim();
  if (!q) return { results: [] };
  return { results: await jf.search(q, 12) };
}));

app.post('/api/play', guard(async (req) => {
  const itemId = String(req.body.itemId || '');
  if (!/^[a-f0-9-]+$/i.test(itemId)) throw new Error('bad item id');
  const out = await start(itemId);
  if (out.error) throw new Error(out.error);
  return { ok: true, ...out };
}));

app.get('/api/status', async (_req, res) => res.json(await snapshot()));
app.get('/healthz', (_req, res) => res.send('ok'));

// ── status heartbeat ───────────────────────────────────────────────────────────
setInterval(async () => {
  if (tvs.size === 0) return;      // nobody is looking; do not probe nine ports for nothing
  try {
    broadcast(await snapshot());
  } catch (err) {
    console.error('status failed:', err.message);
  }
}, 10_000);

// ── discovery ──────────────────────────────────────────────────────────────────
// The box's LAN address is a DHCP lease that has moved before and broke every config
// with an IP in it. Advertising the service lets other clients follow it.
const bonjour = new Bonjour();
const advert = bonjour.publish({ name: 'JARVIS', type: 'jarvis', protocol: 'tcp', port: PORT });

http.listen(PORT, () => {
  console.log(`jarvis-server on :${PORT}`);
  console.log(`jellyfin ${jf.configured ? 'configured' : 'NOT configured'}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    advert.stop?.();
    bonjour.destroy();
    http.close(() => process.exit(0));
  });
}
