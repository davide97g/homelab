/* The "studio" home: a cylinder of apps under a ruled menu.
   Same contract as app.js — focus moves, nothing hovers, the D-pad is the only input —
   and the numbers in SLOTS are the ones CylinderLayout.kt uses on the set. */

const stage = document.getElementById('stage');
const tv    = document.getElementById('tv');
const reel  = document.getElementById('reel');
const flow  = document.getElementById('flow');
const tabs  = [...document.querySelectorAll('.tab')];

/* One slot per step away from the focused card. Chosen as the *projected* centre
   offset and scale on the 1920 surface (what you see), then solved back to 3D:
     z = P·(1 − 1/s),  x = offset / s.
   ry < 0 turns each card's outer edge away: a drum seen from outside. */
const P = 1200;
const SEEN = [            // step: [centre offset px, scale, turn deg]
  [0,   1.00,   0],
  [300, 0.80, -12],
  [540, 0.64, -20],
  [740, 0.52, -26],
  [900, 0.42, -32],       // past the last visible one: where cards wait before coming in
];
const SLOTS = SEEN.map(([off, s, ry]) => ({ x: off / s, z: P * (1 - 1 / s), ry }));
const VISIBLE = 3;        // steps either side that are on screen

let index = 0;
let zone  = 'flow';       // 'flow' | 'tabs' | 'jarvis' | 'homelab'
let tab   = 0;

// ── build ───────────────────────────────────────────────────────────────────
const gradient = ([a, b, c]) =>
  `radial-gradient(120% 90% at 20% 10%, ${a}cc, transparent 60%), linear-gradient(160deg, ${b}, ${c} 75%)`;

/* Which apps actually hand the launcher a cover on the set. Android TV apps ship a
   banner (a logo on a colour), not artwork, so a cover only exists where we can get
   one: Jellyfin's resume item via jarvis-server, whatever is playing via its media
   session (album art), Immich's memories. Everything else gets its own colour. */
const HAS_COVER = new Set(['jellyfin', 'spotify', 'photos']);
const coverOf = app => (HAS_COVER.has(app.id) && app.img) ? app.img : null;

const covers = APPS.map(app => {
  const el = document.createElement('div');
  const img = coverOf(app);
  el.className = 'cover' + (img ? '' : ' cover--none');
  if (img) el.style.backgroundImage = `url("${img}")`;
  else { el.style.background = gradient(app.palette); el.innerHTML = `<b>${app.mark}</b>`; }
  document.getElementById('covers').appendChild(el);
  return el;
});

const cards = APPS.map((app, i) => {
  const el = document.createElement('div');
  el.className = 'flip';
  // on the set: bundled artwork per package, the Jellyfin resume poster when there
  // is one, else the app's banner on its own dominant colour
  const img = coverOf(app);
  el.style.backgroundImage = img ? `url("${img}")` : gradient(app.palette);
  if (!img) el.classList.add('flip--none');
  el.innerHTML = `${img ? '' : `<b>${app.mark}</b>`}<div class="flip__shade"></div>
    ${app.hero.progress ? `<div class="flip__resume"><i style="width:${app.hero.progress * 100}%"></i></div>` : ''}
    <div class="flip__label">${app.label}</div>`;
  el.addEventListener('click', () => { index = i; zone = 'flow'; render(); });
  flow.appendChild(el);
  el._d = 0;
  return el;
});

document.getElementById('services').innerHTML = SERVICES.map(s => `
  <div class="service${s.up ? '' : ' is-down'}"><i></i>
    <div class="service__text"><div class="service__name">${s.name}</div>
    <div class="service__meta">:${s.port} · ${s.up ? `${s.ms} ms` : 'nessuna risposta'}</div></div>
  </div>`).join('');

// ── the hour is the wordmark ────────────────────────────────────────────────
const tick = () => { clock.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); };
tick(); setInterval(tick, 10_000);

// ── render ──────────────────────────────────────────────────────────────────
const n = APPS.length;
const wrap = d => ((d % n) + n + Math.floor(n / 2)) % n - Math.floor(n / 2);  // shortest way round

function place(el, d) {
  const step = Math.min(Math.abs(d), SLOTS.length - 1);
  const s = SLOTS[step];
  const sign = Math.sign(d) || 1;
  // a card that wraps from one edge to the other must not fly across the screen
  el.classList.toggle('no-anim', Math.abs(d - el._d) > 1);
  el._d = d;
  el.style.setProperty('--x', `${sign * s.x}px`);
  el.style.setProperty('--z', `${s.z}px`);
  el.style.setProperty('--ry', `${-sign * s.ry}deg`);
  el.style.zIndex = String(20 - step);          // the centre is nearest: it draws on top
  el.classList.toggle('is-out', Math.abs(d) > VISIBLE);
  el.classList.toggle('is-focused', d === 0);
}

function render() {
  const app = APPS[index];
  cards.forEach((el, i) => place(el, wrap(i - index)));
  // re-enable transitions on the next frame for any card that jumped
  requestAnimationFrame(() => cards.forEach(el => el.classList.remove('no-anim')));

  stage.style.setProperty('--accent', app.accent);
  covers.forEach((c, i) => c.classList.toggle('is-on', i === index));
  if (zone === 'flow' || zone === 'tabs') tv.style.setProperty('--ambi', app.accent);

  tabs.forEach((t, i) => {
    t.classList.toggle('is-focused', zone === 'tabs' && i === tab);
    t.classList.toggle('is-current', t.dataset.to === ({ jarvis: 'jarvis', homelab: 'homelab' }[zone] || 'home'));
  });

  const brand = document.getElementById('brand');
  const blurb = document.getElementById('blurb');
  brand.classList.add('is-swapping');
  blurb.classList.add('is-swapping');
  clearTimeout(render._t);
  render._t = setTimeout(() => {
    const h = app.hero;
    brandMark.textContent = app.mark;
    brandName.textContent = app.label;
    blurb.innerHTML = `${h.kicker.replace(` · ${app.label}`, '')} — <b>${h.title}</b>. ${h.meta.join(' · ')}${h.progressText ? `<br>${h.progressText}` : ''}`;
    ctaText.textContent = h.cta;
    brand.classList.remove('is-swapping');
    blurb.classList.remove('is-swapping');
  }, 170);
}

// ── screens ─────────────────────────────────────────────────────────────────
const SCREENS = { flow: 0, tabs: 0, jarvis: -1080, homelab: -2160 };
function goto(next) {
  zone = next;
  reel.style.transform = `translateY(${SCREENS[next]}px)`;
  stage.classList.toggle('at-jarvis', next === 'jarvis');
  stage.classList.toggle('at-homelab', next === 'homelab');
  if (next === 'jarvis') orb.start(); else orb.stop();
  render();
}

function key(k) {
  if (saverOn()) { wake(); return; }      // the first key only wakes the set
  armSaver();
  if (zone === 'homelab') {
    if (k === 'ArrowUp') goto('jarvis');
    if (k === 'Escape') goto('flow');
    return;
  }
  if (zone === 'jarvis') {
    if (k === 'ArrowUp') goto('flow');
    if (k === 'ArrowDown') goto('homelab');
    if (k === 'Escape') goto('flow');
    return;
  }
  if (zone === 'tabs') {
    if (k === 'ArrowLeft')  { tab = Math.max(0, tab - 1); render(); }
    if (k === 'ArrowRight') { tab = Math.min(tabs.length - 1, tab + 1); render(); }
    if (k === 'ArrowDown' || k === 'Escape') { zone = 'flow'; render(); }
    if (k === 'Enter') {
      const to = tabs[tab].dataset.to;
      if (to === 'settings') flash('→ SettingsActivity');
      else goto(to === 'home' ? 'flow' : to);
    }
    return;
  }
  if (k === 'ArrowRight') { index = (index + 1) % n; render(); }
  if (k === 'ArrowLeft')  { index = (index - 1 + n) % n; render(); }
  if (k === 'ArrowUp')    { zone = 'tabs'; tab = 0; render(); }
  if (k === 'ArrowDown')  goto('jarvis');
  if (k === 'Enter')      launch();
}

addEventListener('keydown', e => {
  const k = e.key === 'Backspace' ? 'Escape' : e.key;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(k)) { e.preventDefault(); key(k); }
});
document.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => key(b.dataset.key)));
tabs.forEach((t, i) => t.addEventListener('click', () => { zone = 'tabs'; tab = i; key('Enter'); }));

// ── launch: the focused card grows into the frame (takeover from app.css) ────
let launching = false;
function launch() {
  if (launching) return;
  launching = true;
  const app = APPS[index], card = cards[index];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.classList.add('is-launching');
  stage.classList.add('is-launching');

  const c = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
  const x = (c.left - s.left) / SCALE, y = (c.top - s.top) / SCALE;
  const w = c.width / SCALE, h = c.height / SCALE;
  const F = { x: 32, y: 32, w: 1856, h: 1016 };

  const over = document.createElement('div');
  over.className = 'takeover';
  over.style.setProperty('--take-accent', app.accent);
  over.innerHTML = `
    <div class="takeover__img" style="background-image:url('${app.img}');background-color:${app.palette[2]}"></div>
    <div class="takeover__veil"></div><div class="takeover__ring"></div>
    <div class="takeover__content">
      <div class="takeover__mark">${app.mark}</div>
      <div class="takeover__name" style="font-family:var(--display)">${app.label}</div>
      <div class="takeover__hint">apertura in corso</div>
      <div class="takeover__bar"><i></i></div>
    </div>`;
  const from = `translate(${x - F.x}px, ${y - F.y}px) scale(${w / F.w}, ${h / F.h})`;
  over.style.transform = from;
  stage.appendChild(over);

  over.animate([{ transform: from, borderRadius: '18px' }, { transform: 'none', borderRadius: '34px' }],
    { duration: reduce ? 1 : 520, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
  card.classList.add('is-handed-off');
  setTimeout(() => over.classList.add('is-open'), reduce ? 0 : 420);

  setTimeout(() => {
    over.classList.remove('is-open');
    over.animate([{ transform: 'none', opacity: 1 }, { transform: from, opacity: 0 }],
      { duration: reduce ? 1 : 320, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      .onfinish = () => {
        over.remove();
        card.classList.remove('is-handed-off', 'is-launching');
        stage.classList.remove('is-launching');
        launching = false;
      };
  }, 1700);
  flash(`launch ${app.pkg}`);
}

function flash(text) {
  let el = document.querySelector('.flash');
  if (!el) {
    el = document.createElement('div');
    el.className = 'flash';
    el.style.cssText = 'position:absolute;left:96px;bottom:46px;font:400 15px Roboto;letter-spacing:.06em;color:#F3ECE4;opacity:0;transition:opacity .3s;z-index:9';
    stage.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => (el.style.opacity = '0'), 1400);
}

// ── orb, unchanged ──────────────────────────────────────────────────────────
const orb = new Orb(document.getElementById('orb'));
orb.set('IDLE');

// ── chrome + fit ────────────────────────────────────────────────────────────
tglSafe.addEventListener('change', e => stage.classList.toggle('show-safe', e.target.checked));
tglAmbi.addEventListener('change', e => tv.classList.toggle('no-ambi', !e.target.checked));
tglBezel.addEventListener('change', e => tv.classList.toggle('no-bezel', !e.target.checked));

let SCALE = 1;
function fit() {
  const panel = stage.parentElement;
  SCALE = Math.min((innerWidth - 110) / 1920, (innerHeight - 226) / 1080);
  stage.style.transform = `scale(${SCALE})`;
  panel.style.width  = `${1920 * SCALE}px`;
  panel.style.height = `${1080 * SCALE}px`;
}
addEventListener('resize', fit);
fit();
render();

// ── screensaver: after a quiet spell the painting and the hour take over ─────
// The set's own idle timer starts the DreamService; here it is 60 s, or the button.
const saver = document.getElementById('saver');
const IDLE_MS = 60_000;
const saverOn = () => saver.classList.contains('is-on');
function paintSaver() {
  const now = new Date();
  saverTime.textContent = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  saverDate.textContent = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}
function sleep() { paintSaver(); saver.classList.add('is-on'); orb.stop(); tv.style.setProperty('--ambi', '#F4B98A'); }
function wake()  { saver.classList.remove('is-on'); armSaver(); render(); }
function armSaver() { clearTimeout(armSaver._t); armSaver._t = setTimeout(sleep, IDLE_MS); }
setInterval(() => saverOn() && paintSaver(), 10_000);
btnSaver.addEventListener('click', e => { e.stopPropagation(); sleep(); });
saver.addEventListener('click', wake);
armSaver();
