// Web apps: sites the TV opens full screen, as icons in its dock.
//
// The list lives in one JSON file on a pinned volume (see docker-compose.yml) and is
// edited from the phone page. Every change is pushed to the TV over the socket, so a
// new site appears in the dock without touching the set.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'sites.json');

let sites = null;

async function load() {
  if (sites) return sites;
  try {
    sites = JSON.parse(await readFile(FILE, 'utf8')).sites ?? [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('sites.json unreadable, starting empty:', err.message);
    sites = [];
  }
  return sites;
}

async function save() {
  await mkdir(DATA, { recursive: true });
  // write-then-rename: a crash mid-write never leaves half a file behind
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify({ sites }, null, 2));
  await rename(tmp, FILE);
}

/** Only http(s), and always an absolute URL: this is what a WebView will be pointed at. */
function clean(input) {
  const name = String(input.name ?? '').trim().slice(0, 40);
  let raw = String(input.url ?? '').trim();
  if (raw && !/^[a-z]+:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new Error('indirizzo non valido'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('solo indirizzi http o https');
  return { name: name || url.hostname.replace(/^www\./, ''), url: url.toString() };
}

export async function list() {
  return (await load()).map((s) => ({ ...s }));
}

export async function add(input) {
  await load();
  const site = { id: randomUUID().slice(0, 8), ...clean(input) };
  sites.push(site);
  await save();
  icons.delete(site.id);
  return site;
}

export async function update(id, input) {
  await load();
  const site = sites.find((s) => s.id === id);
  if (!site) throw new Error('sito non trovato');
  Object.assign(site, clean({ name: input.name ?? site.name, url: input.url ?? site.url }));
  await save();
  icons.delete(id);
  return site;
}

export async function remove(id) {
  await load();
  const before = sites.length;
  sites = sites.filter((s) => s.id !== id);
  if (sites.length === before) throw new Error('sito non trovato');
  await save();
  icons.delete(id);
}

export async function move(id, by) {
  await load();
  const i = sites.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= sites.length) return;
  [sites[i], sites[j]] = [sites[j], sites[i]];
  await save();
}

export async function get(id) {
  return (await load()).find((s) => s.id === id) ?? null;
}

// ── icons ──────────────────────────────────────────────────────────────────────
// The site's own artwork: apple-touch-icon first (a square PNG made for exactly
// this), then the largest raster <link rel=icon>, then /favicon.ico. SVG is skipped:
// the TV decodes it with BitmapFactory, which cannot. Cached in memory per site.

const icons = new Map();
const UA = 'Mozilla/5.0 (Linux; Android 12; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchWithin(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA } });
  } finally {
    clearTimeout(t);
  }
}

function candidates(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /rel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    const href = /href\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || !rel.includes('icon')) continue;
    if (/\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag)) continue;
    const size = Number(/sizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 0);
    const score = (rel.includes('apple-touch-icon') ? 1000 : 0) + (size || 32);
    try { out.push({ url: new URL(href, base).toString(), score }); } catch { /* bad href */ }
  }
  out.sort((a, b) => b.score - a.score);
  out.push({ url: new URL('/apple-touch-icon.png', base).toString(), score: 0 });
  out.push({ url: new URL('/favicon.ico', base).toString(), score: 0 });
  return out;
}

export async function icon(id) {
  if (icons.has(id)) return icons.get(id);
  const site = await get(id);
  if (!site) return null;
  let found = null;
  try {
    const page = await fetchWithin(site.url);
    const html = page.ok ? await page.text() : '';
    for (const c of candidates(html, page.url || site.url)) {
      const res = await fetchWithin(c.url).catch(() => null);
      const type = res?.headers.get('content-type') ?? '';
      if (!res?.ok || !/^image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon|gif)/i.test(type)) continue;
      found = { type, body: Buffer.from(await res.arrayBuffer()) };
      break;
    }
  } catch (err) {
    console.error(`icon for ${site.url} failed:`, err.message);
  }
  icons.set(id, found);
  return found;
}
