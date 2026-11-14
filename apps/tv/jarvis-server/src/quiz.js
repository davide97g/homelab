// Quiz night: the film's questions answered live from everyone's phone.
//
// Cinema (cinema.davideghiotto.it) owns the film and its quiz file. When playback
// reaches a question it pauses and hands the question here as the host; each guest
// answers on their own phone through a personal link, and the scoreboard comes back
// to the big screen. Everything lives under /quiz, the one path of this hostname
// that Cloudflare Access lets through: the personal token in each link is the gate.
//
// Tokens are an HMAC of the player's id under a secret generated on first boot and
// kept on the data volume, so links survive restarts and redeploys, and nothing
// secret is in the repo. The artwork cards are not in the (public) repo either:
// they are uploaded once to the volume through the host token.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import express from 'express';

const DATA = process.env.DATA_DIR || '/data';
const DIR = path.join(DATA, 'quiz');
const STATE_FILE = path.join(DIR, 'state.json');
const SECRET_FILE = path.join(DIR, 'secret');
const CARDS = path.join(DIR, 'cards');
const PUBLIC_URL = process.env.QUIZ_PUBLIC_URL || 'https://jarvis.davideghiotto.it';
const CINEMA_URL = process.env.QUIZ_CINEMA_URL || 'https://cinema.davideghiotto.it';
// Cinema in production, and Cinema's dev server. The key, not the origin, is the gate.
const allowed = (origin) => origin === CINEMA_URL || /^http:\/\/localhost:\d+$/.test(origin);

/** Points for a right answer, plus up to SPEED for answering early in the window. */
const BASE = 100;
const SPEED = 50;
const SPEED_WINDOW_MS = 30_000;
/** The answer shows itself this long after the question opens, unless revealed sooner. */
const REVEAL_AFTER_MS = 30_000;
/** Players who also run the show from their phone: reveal and resume the film. */
const ADMINS = new Set(['davide']);

export const PLAYERS = [
  { id: 'davide', name: 'Davide', title: 'THE SPARK' },
  { id: 'kristina', name: 'Kristina', title: 'THE SNOWCALLER' },
  { id: 'ilario', name: 'Ilario', title: 'THE TIMEKEEPER' },
  { id: 'sebastiano', name: 'Sebastiano', title: 'THE NAVIGATOR' },
  { id: 'marcello', name: 'Marcello', title: 'THE DRAGONKEEPER' },
  { id: 'chiara', name: 'Chiara', title: 'THE CANDLEWITCH' },
];
const byId = new Map(PLAYERS.map((p) => [p.id, p]));

let secret = null;
const tokens = new Map(); // token -> 'host' | player id

/**
 * joined: ids that have opened their link (and seen their card).
 * scores: id -> points. log: one entry per revealed question.
 * current: the question on screen, with its answer kept server side until reveal.
 */
let state = { joined: [], scores: {}, log: [], current: null };

async function loadSecret() {
  await mkdir(CARDS, { recursive: true });
  try {
    secret = (await readFile(SECRET_FILE, 'utf8')).trim();
  } catch {
    secret = randomBytes(32).toString('hex');
    await writeFile(SECRET_FILE, secret, { mode: 0o600 });
  }
  const sign = (what) => createHmac('sha256', secret).update(what).digest('base64url').slice(0, 16);
  tokens.set(sign('host'), 'host');
  for (const p of PLAYERS) tokens.set(sign(`player:${p.id}`), p.id);
}

async function loadState() {
  try {
    state = { ...state, ...JSON.parse(await readFile(STATE_FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('quiz state unreadable, starting fresh:', err.message);
  }
}

let saving = Promise.resolve();
function save() {
  saving = saving.then(async () => {
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, STATE_FILE);
  }).catch((err) => console.error('quiz state not saved:', err.message));
}

function who(token) {
  if (typeof token !== 'string' || token.length !== 16) return null;
  for (const [t, role] of tokens) {
    const a = Buffer.from(t);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return role;
  }
  return null;
}

// ── answers ───────────────────────────────────────────────────────────────────
// The same forgiving match as Cinema's own quiz: case, accents and punctuation
// ignored, one typo per six letters.

const normalise = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function isRight(q, value) {
  if (q.type === 'choice') return Number(value) === q.answer;
  if (q.type === 'truefalse') return Boolean(value) === q.answer && typeof value === 'boolean';
  const g = normalise(value);
  if (!g) return false;
  return q.accept.some((a) => {
    const n = normalise(a);
    return distance(g, n) <= Math.floor(n.length / 6);
  });
}

function rightLabel(q) {
  if (q.type === 'choice') return q.options[q.answer] ?? '';
  if (q.type === 'truefalse') return q.answer ? 'Vero' : 'Falso';
  return q.accept[0] ?? '';
}

function answerLabel(q, value) {
  if (q.type === 'choice') return q.options[Number(value)] ?? '?';
  if (q.type === 'truefalse') return value ? 'Vero' : 'Falso';
  return String(value);
}

// ── views ─────────────────────────────────────────────────────────────────────

function standings() {
  return PLAYERS.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    joined: state.joined.includes(p.id),
    score: state.scores[p.id] ?? 0,
    right: state.log.filter((l) => l.results[p.id]?.right).length,
  })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** What one viewer may see: the answer only after the reveal, others' picks only then. */
function view(role) {
  const c = state.current;
  let current = null;
  if (c) {
    const q = c.question;
    current = {
      id: c.id,
      number: c.number,
      total: c.total,
      phase: c.phase,
      openedAt: c.openedAt,
      revealAt: c.openedAt + REVEAL_AFTER_MS,
      question: {
        type: q.type,
        question: q.question,
        options: q.type === 'choice' ? q.options : q.type === 'truefalse' ? ['Vero', 'Falso'] : undefined,
      },
      answered: Object.keys(c.answers),
      mine: role !== 'host' && c.answers[role] ? c.answers[role].label : null,
    };
    if (c.phase === 'revealed') {
      current.right = rightLabel(q);
      current.rightIndex = q.type === 'choice' ? q.answer : q.type === 'truefalse' ? (q.answer ? 0 : 1) : null;
      current.explain = q.explain ?? null;
      current.results = c.results;
    }
  }
  return {
    type: 'state',
    you: role === 'host' ? { host: true, admin: true } : { ...byId.get(role), host: false, admin: ADMINS.has(role) },
    current,
    standings: standings(),
    asked: state.log.length,
  };
}

// ── live push (server-sent events) ────────────────────────────────────────────

const streams = new Set(); // { res, role }

function push() {
  for (const s of streams) {
    s.res.write(`data: ${JSON.stringify(view(s.role))}\n\n`);
  }
}

setInterval(() => {
  for (const s of streams) s.res.write(': ping\n\n');
}, 15_000).unref();

// ── host actions ──────────────────────────────────────────────────────────────

function cleanQuestion(raw) {
  const q = raw ?? {};
  const base = { type: q.type, question: String(q.question ?? '').slice(0, 500), explain: q.explain ? String(q.explain).slice(0, 800) : undefined };
  if (q.type === 'choice' && Array.isArray(q.options) && Number.isInteger(q.answer)) {
    return { ...base, options: q.options.map((o) => String(o).slice(0, 200)).slice(0, 8), answer: q.answer };
  }
  if (q.type === 'truefalse' && typeof q.answer === 'boolean') return { ...base, answer: q.answer };
  if (q.type === 'text' && Array.isArray(q.accept)) return { ...base, accept: q.accept.map(String).slice(0, 30) };
  throw new Error('domanda non valida');
}

let revealTimer = null;

/** Reveal on the clock: everyone gets the same 30 seconds, however many have answered. */
function scheduleReveal() {
  clearTimeout(revealTimer);
  const c = state.current;
  if (!c || c.phase !== 'open') return;
  revealTimer = setTimeout(() => {
    if (state.current?.id !== c.id) return;
    reveal();
    save();
    push();
  }, Math.max(0, c.openedAt + REVEAL_AFTER_MS - Date.now()));
}

function ask({ id, number, total, question }) {
  const key = String(id ?? number);
  // Asking the same question again (the card re-mounted, the page reloaded) keeps
  // the answers already given rather than wiping them.
  if (state.current?.id === key) return;
  state.current = {
    id: key,
    number: Number(number) || state.log.length + 1,
    total: Number(total) || null,
    question: cleanQuestion(question),
    phase: 'open',
    openedAt: Date.now(),
    answers: {},
    results: null,
  };
}

function reveal() {
  const c = state.current;
  if (!c || c.phase === 'revealed') return;
  clearTimeout(revealTimer);
  const results = {};
  for (const [pid, a] of Object.entries(c.answers)) {
    const right = isRight(c.question, a.value);
    const speed = Math.max(0, 1 - (a.at - c.openedAt) / SPEED_WINDOW_MS);
    const points = right ? BASE + Math.round(SPEED * speed) : 0;
    results[pid] = { answer: a.label, right, points, seconds: Math.round((a.at - c.openedAt) / 100) / 10 };
    state.scores[pid] = (state.scores[pid] ?? 0) + points;
  }
  c.phase = 'revealed';
  c.results = results;
  // a re-asked question replaces its earlier entry instead of counting twice
  state.log = state.log.filter((l) => l.id !== c.id);
  state.log.push({ id: c.id, question: c.question.question, results });
}

// ── routes ────────────────────────────────────────────────────────────────────

export async function mount(app) {
  await loadSecret();
  await loadState();
  scheduleReveal(); // a restart mid-question keeps its clock

  const r = express.Router();

  // Cinema calls the host routes from its own origin.
  r.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Quiz-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const role = (req) => who(req.get('x-quiz-key') || req.query.k || req.body?.k);
  const asPlayer = (req, res) => {
    const id = role(req);
    if (!id || id === 'host') { res.status(403).json({ error: 'link non valido' }); return null; }
    return id;
  };
  const asHost = (req, res) => {
    const r0 = role(req);
    if (r0 !== 'host' && !ADMINS.has(r0)) { res.status(403).json({ error: 'solo il presentatore' }); return false; }
    return true;
  };
  const host = (fn) => (req, res) => {
    if (!asHost(req, res)) return;
    try {
      fn(req);
      save();
      push();
      res.json(view('host'));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  r.get('/api/me', (req, res) => {
    const id = role(req);
    if (!id) return res.status(403).json({ error: 'link non valido' });
    res.json(view(id));
  });

  /** The player has opened their link: their card turns face up on every screen. */
  r.post('/api/join', express.json(), (req, res) => {
    const id = asPlayer(req, res);
    if (!id) return;
    if (!state.joined.includes(id)) {
      state.joined.push(id);
      save();
      push();
    }
    res.json(view(id));
  });

  r.get('/api/events', (req, res) => {
    const id = role(req);
    if (!id) return res.status(403).end();
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 2000\n\n');
    const s = { res, role: id };
    streams.add(s);
    res.write(`data: ${JSON.stringify(view(id))}\n\n`);
    req.on('close', () => streams.delete(s));
  });

  r.post('/api/answer', express.json(), (req, res) => {
    const id = asPlayer(req, res);
    if (!id) return;
    const c = state.current;
    if (!c || c.phase !== 'open') return res.status(409).json({ error: 'nessuna domanda aperta' });
    if (c.answers[id]) return res.status(409).json({ error: 'hai già risposto' });
    let value = req.body?.value;
    if (c.question.type === 'choice') {
      value = Number(value);
      if (!Number.isInteger(value) || value < 0 || value >= c.question.options.length) return res.status(400).json({ error: 'scelta non valida' });
    } else if (c.question.type === 'truefalse') {
      if (typeof value !== 'boolean') return res.status(400).json({ error: 'vero o falso' });
    } else {
      value = String(value ?? '').trim().slice(0, 120);
      if (!value) return res.status(400).json({ error: 'risposta vuota' });
    }
    c.answers[id] = { value, label: answerLabel(c.question, value), at: Date.now() };
    if (!state.joined.includes(id)) state.joined.push(id);
    save();
    push();
    res.json(view(id));
  });

  r.post('/api/host/ask', express.json(), host((req) => { ask(req.body); scheduleReveal(); }));
  r.post('/api/host/reveal', express.json(), host(() => reveal()));
  r.post('/api/host/close', express.json(), host(() => { state.current = null; }));
  r.post('/api/host/reset', express.json(), host(() => {
    state = { joined: state.joined, scores: {}, log: [], current: null };
  }));

  /** Upload a player's artwork once (JPEG/PNG/WebP body). */
  r.put('/api/host/card/:id', express.raw({ type: ['image/*'], limit: '8mb' }), async (req, res) => {
    if (!asHost(req, res)) return;
    if (!byId.has(req.params.id)) return res.status(404).json({ error: 'giocatore sconosciuto' });
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.get('content-type')];
    if (!ext || !req.body?.length) return res.status(400).json({ error: 'immagine mancante' });
    await writeFile(path.join(CARDS, `${req.params.id}.img`), req.body);
    await writeFile(path.join(CARDS, `${req.params.id}.type`), req.get('content-type'));
    res.json({ ok: true, bytes: req.body.length });
  });

  // Cards are only served to someone holding a link; they are people's portraits.
  r.get('/card/:id', async (req, res) => {
    if (!role(req)) return res.status(403).end();
    if (!byId.has(req.params.id)) return res.status(404).end();
    try {
      const type = (await readFile(path.join(CARDS, `${req.params.id}.type`), 'utf8')).trim();
      res.set('Content-Type', type);
      res.set('Cache-Control', 'private, max-age=86400');
      res.send(await readFile(path.join(CARDS, `${req.params.id}.img`)));
    } catch {
      res.status(404).end();
    }
  });

  r.use(express.static('public/quiz', { index: 'index.html' }));
  app.use('/quiz', r);

  // Behind Cloudflare Access (the rest of this hostname): the links to hand out.
  app.get('/api/quiz/links', (_req, res) => {
    const out = { host: null, cinema: null, players: [] };
    for (const [t, r2] of tokens) {
      if (r2 === 'host') {
        out.host = t;
        out.cinema = `${CINEMA_URL}/?party=${t}`;
        out.screen = `${PUBLIC_URL}/quiz/?k=${t}`;
      } else {
        const p = byId.get(r2);
        out.players.push({ id: r2, name: p.name, title: p.title, key: t, url: `${PUBLIC_URL}/quiz/?k=${t}` });
      }
    }
    out.players.sort((a, b) => PLAYERS.findIndex((p) => p.id === a.id) - PLAYERS.findIndex((p) => p.id === b.id));
    res.json(out);
  });
}
