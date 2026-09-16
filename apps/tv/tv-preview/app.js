/* Drives the preview: D-pad focus, showcase swap, the two vertical screens.
   The interaction model here is the one the Android launcher has to copy —
   focus moves, nothing hovers, and every state change is one animation. */

const stage    = document.getElementById('stage');
const tv       = document.getElementById('tv');
const reel     = document.getElementById('reel');
const backdrop = document.getElementById('backdrop');
const track    = document.getElementById('railTrack');
const rail     = document.getElementById('rail');
const gear     = document.getElementById('gear');
const hero     = document.getElementById('hero');

const CARD_W = 266, GAP = 24;   // keep in sync with app.css
const LEAD   = 2;               // focused card never scrolls past the third slot

let index = 0;          // focused app
let zone  = 'rail';     // 'rail' | 'gear' | 'jarvis' | 'homelab'

// ── build ───────────────────────────────────────────────────────────────────
const gradient = ([a, b, c]) => `
  radial-gradient(120% 95% at 18% 8%,  ${a}cc 0%, transparent 58%),
  radial-gradient(95% 85% at 82% 28%,  ${b}b3 0%, transparent 55%),
  radial-gradient(70% 60% at 60% 100%, ${a}55 0%, transparent 60%),
  linear-gradient(155deg, ${b} 0%, ${c} 72%)`;

const layers = APPS.map((app, i) => {
  const el = document.createElement('div');
  el.className = 'backdrop__layer';
  // the photograph, with the palette gradient underneath it as the fallback an app
  // with no artwork gets on the TV
  el.style.background = app.img
    ? `url("${app.img}") center/cover no-repeat, ${gradient(app.palette)}`
    : gradient(app.palette);
  el.style.animationDelay = `${-i * 3}s`;   // stop every backdrop panning in lockstep
  backdrop.appendChild(el);
  return el;
});

const cards = APPS.map((app, i) => {
  const el = document.createElement('div');
  el.className = 'card';
  el.style.setProperty('--card-accent', app.accent);
  el.innerHTML = `
    <div class="card__art" style="background:${app.img ? `url('${app.img}') center/cover no-repeat` : gradient(app.palette)}"></div>
    <div class="card__tint" style="background:${gradient(app.palette)}"></div>
    <div class="card__ring"></div>
    <div class="card__gloss"></div>
    <div class="card__mark">${app.mark}</div>
    <div class="card__label">${app.label}</div>
    ${app.hero.progress ? `<div class="card__badge">RIPRENDI</div>
      <div class="card__resume"><i style="width:${app.hero.progress * 100}%"></i></div>` : ''}`;
  el.addEventListener('click', () => { focusRail(i); });
  track.appendChild(el);
  return el;
});

document.getElementById('services').innerHTML = SERVICES.map(s => `
  <div class="service${s.up ? '' : ' is-down'}">
    <i></i>
    <div class="service__text">
      <div class="service__name">${s.name}</div>
      <div class="service__meta">:${s.port} · ${s.up ? `${s.ms} ms` : 'nessuna risposta'}</div>
    </div>
  </div>`).join('');

// ── render ──────────────────────────────────────────────────────────────────
function render() {
  const app = APPS[index];

  layers.forEach((l, i) => l.classList.toggle('is-on', i === index));
  cards.forEach((c, i) => c.classList.toggle('is-focused', i === index));
  rail.classList.toggle('is-active', zone === 'rail');
  gear.classList.toggle('is-focused', zone === 'gear');

  track.style.transform = `translateX(${-Math.max(0, index - LEAD) * (CARD_W + GAP)}px)`;

  tv.style.setProperty('--ambi', app.accent);
  stage.style.setProperty('--accent', app.accent);

  // fade the hero out, swap text at the bottom of the fade, fade it back in
  hero.classList.add('is-swapping');
  clearTimeout(render._t);
  render._t = setTimeout(() => {
    const h = app.hero;
    heroKicker.textContent = h.kicker;
    heroTitle.textContent  = h.title;
    heroMeta.innerHTML     = h.meta.map(m => `<span>${m}</span>`).join('');
    heroCta.textContent    = h.cta;
    heroProgress.hidden    = !h.progress;
    if (h.progress) {
      heroProgress.querySelector('i').style.width = `${h.progress * 100}%`;
      heroProgressText.textContent = h.progressText || '';
    }
    hero.classList.remove('is-swapping');
  }, 170);
}

function focusRail(i) {
  index = Math.max(0, Math.min(APPS.length - 1, i));
  if (zone !== 'rail' && zone !== 'gear') goHome();
  render();
}

/* three screens stacked in one reel: apps, the orb, the homelab. Down is deeper in,
   up is back out, and the reel is the only thing that moves. */
const SCREENS = { rail: 0, gear: 0, jarvis: -1080, homelab: -2160 };

function goto(next) {
  zone = next;
  reel.style.transform = `translateY(${SCREENS[next]}px)`;
  stage.classList.toggle('at-jarvis',  next === 'jarvis');
  stage.classList.toggle('at-homelab', next === 'homelab');
  // the orb costs a frame of canvas work, so it only runs while it is on screen
  if (next === 'jarvis') orb.start(); else orb.stop();
  render();
}
const goJarvis = () => goto('jarvis');
const goHome   = () => goto('rail');

// ── D-pad ───────────────────────────────────────────────────────────────────
function key(k) {
  if (zone === 'homelab') {
    if (k === 'ArrowUp') goJarvis();
    if (k === 'Escape' || k === 'Backspace') goHome();
    return;
  }
  if (zone === 'jarvis') {
    if (k === 'ArrowUp') goHome();
    if (k === 'ArrowDown') goto('homelab');
    if (k === 'Escape' || k === 'Backspace') goHome();
    return;
  }
  if (zone === 'gear') {
    if (k === 'ArrowDown') { zone = 'rail'; render(); }
    if (k === 'Enter') flash('→ SettingsActivity');
    return;
  }
  if (k === 'ArrowRight') focusRail(index + 1);
  if (k === 'ArrowLeft')  focusRail(index - 1);
  if (k === 'ArrowUp')    { zone = 'gear'; render(); }
  if (k === 'ArrowDown')  goJarvis();
  if (k === 'Enter')      launch();
}

/**
 * Opening an app, in one move: the border sweep charges up on the card the viewer
 * chose, then that same card grows into the frame and the app takes over. One object
 * travels, so there is never a moment where the screen is showing neither.
 *
 * On the TV the takeover is what covers the 300-900 ms the system needs to start the
 * activity — the animation is the loading state, not decoration.
 */
let launching = false;

function launch() {
  if (launching) return;
  launching = true;

  const app  = APPS[index];
  const card = cards[index];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  card.classList.add('is-launching');
  stage.classList.add('is-launching');

  // where the card is right now, in stage coordinates
  const c = card.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const x = (c.left - s.left) / SCALE, y = (c.top - s.top) / SCALE;
  const w = c.width / SCALE,          h = c.height / SCALE;

  const FRAME = { x: 32, y: 32, w: 1856, h: 1016 };

  const over = document.createElement('div');
  over.className = 'takeover';
  over.style.setProperty('--take-accent', app.accent);
  over.innerHTML = `
    <div class="takeover__img" style="background-image:${app.img ? `url('${app.img}')` : 'none'};background-color:${app.palette[2]}"></div>
    <div class="takeover__veil"></div>
    <div class="takeover__ring"></div>
    <div class="takeover__content">
      <div class="takeover__mark">${app.mark}</div>
      <div class="takeover__name">${app.label}</div>
      <div class="takeover__hint">apertura in corso</div>
      <div class="takeover__bar"><i></i></div>
    </div>`;

  const from = `translate(${x - FRAME.x}px, ${y - FRAME.y}px) scale(${w / FRAME.w}, ${h / FRAME.h})`;
  over.style.transform = from;
  over.style.opacity = '0';
  stage.appendChild(over);

  // the sweep gets one full turn to itself before the card starts growing: the
  // viewer sees which card answered before the screen changes under them
  const charge = reduce ? 0 : 420;

  setTimeout(() => {
    over.style.opacity = '1';
    card.classList.add('is-handed-off');
    over.animate(
      [{ transform: from, borderRadius: '25px' }, { transform: 'none', borderRadius: '34px' }],
      { duration: reduce ? 1 : 520, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' },
    );
    setTimeout(() => over.classList.add('is-open'), reduce ? 0 : 420);
  }, charge);

  // nothing actually starts here, so come back — exit at ~60 % of the entrance,
  // which is what makes a reversal feel responsive rather than sluggish
  setTimeout(() => {
    over.classList.remove('is-open');
    const back = over.animate(
      [{ transform: 'none', borderRadius: '34px' }, { transform: from, borderRadius: '25px', opacity: 0 }],
      { duration: reduce ? 1 : 320, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
    );
    back.onfinish = () => {
      over.remove();
      card.classList.remove('is-handed-off');
      card.classList.remove('is-launching');
      stage.classList.remove('is-launching');
      launching = false;
    };
  }, charge + 1600);

  flash(`launch ${app.pkg}`);
}

function flash(text) {
  let el = document.querySelector('.flash');
  if (!el) {
    el = document.createElement('div');
    el.className = 'flash';
    el.style.cssText = 'position:absolute;left:96px;bottom:26px;font:400 15px Roboto;letter-spacing:.06em;color:#4DE8F4;opacity:0;transition:opacity .3s';
    stage.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => (el.style.opacity = '0'), 1400);
}

addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Backspace'].includes(e.key)) {
    e.preventDefault(); key(e.key);
  }
});
document.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => key(b.dataset.key)));
gear.addEventListener('click', () => { zone = 'gear'; render(); });

// ── clock, in Italian, like the launcher ────────────────────────────────────
function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  dateLine.textContent = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = now.getHours();
  greeting.textContent = `${h < 13 ? (h < 5 ? 'Buonanotte' : 'Buongiorno') : h < 18 ? 'Buon pomeriggio' : 'Buonasera'}, Davide`;
}
tick(); setInterval(tick, 10_000);

// ── the orb ─────────────────────────────────────────────────────────────────
const orb = new Orb(document.getElementById('orb'));

const STATE_TEXT = {
  IDLE:      { label: 'pronto',        prompt: 'tieni premuto sul telefono per parlare', reply: '' },
  LISTENING: { label: 'in ascolto',    prompt: 'ti ascolto…',                            reply: '' },
  THINKING:  { label: 'sto pensando',  prompt: '“ok fai partire jellyfin con harry potter”', reply: '' },
  SPEAKING:  { label: 'sto parlando',  prompt: '“ok fai partire jellyfin con harry potter”',
               reply: 'È partito Harry Potter e la Pietra Filosofale. Buona visione!' },
  ERROR:     { label: 'non ci arrivo', prompt: '“quanto spazio è rimasto sul NAS?”',
               reply: 'Il server non risponde. Riprovo tra poco.' },
};

let voiceJob = null;

function setJarvisState(state) {
  orb.set(state);
  const txt = STATE_TEXT[state];
  orbState.textContent = txt.label;
  jarvisPrompt.textContent = txt.prompt;
  jarvisReply.textContent  = txt.reply;
  jarvisReply.style.opacity = txt.reply ? '1' : '0';

  // the set's own Ambilight follows the orb, which is the whole point of doing this
  // on a Philips: the wall behind the TV turns violet while it thinks
  const c = ORB_STATES[state];
  tv.style.setProperty('--ambi', c.primary);
  tv.classList.toggle('ambi-pulse', state === 'THINKING' || state === 'SPEAKING');

  clearInterval(voiceJob);
  voiceJob = null;
  if (state === 'SPEAKING' || state === 'LISTENING') {
    // stand-in for the real envelope: on the TV this is the TTS/utterance level
    const base = state === 'SPEAKING' ? .55 : .25;
    voiceJob = setInterval(() => orb.setAmplitude(base * (.4 + Math.random() * .8)), 90);
  } else {
    orb.setAmplitude(0);
  }
}

/** the whole turn, as it happens on the TV: listen, think, answer, settle. */
function jarvisDemo() {
  goJarvis();
  setJarvisState('LISTENING');
  setTimeout(() => setJarvisState('THINKING'), 2600);
  setTimeout(() => setJarvisState('SPEAKING'), 4800);
  setTimeout(() => setJarvisState('IDLE'),    10200);
}

btnSay.addEventListener('click', jarvisDemo);
document.querySelectorAll('[data-state]').forEach(b =>
  b.addEventListener('click', () => { goJarvis(); setJarvisState(b.dataset.state); }));
setJarvisState('IDLE');

// ── chrome toggles + fit the 1920x1080 stage to the window ──────────────────
tglSafe.addEventListener('change', e => stage.classList.toggle('show-safe', e.target.checked));
tglAmbi.addEventListener('change', e => tv.classList.toggle('no-ambi', !e.target.checked));
tglBezel.addEventListener('change', e => tv.classList.toggle('no-bezel', !e.target.checked));

let SCALE = 1;
function fit() {
  const panel = stage.parentElement;
  const availW = innerWidth  - 110;   // 90 breathing room + the 20 px of side bezel
  const availH = innerHeight - 226;   // toolbar, caption, and the 36 px of bezel
  const scale  = Math.min(availW / 1920, availH / 1080);
  SCALE = scale;
  stage.style.transform = `scale(${scale})`;
  panel.style.width  = `${1920 * scale}px`;
  panel.style.height = `${1080 * scale}px`;
}
addEventListener('resize', fit);
fit();
render();
