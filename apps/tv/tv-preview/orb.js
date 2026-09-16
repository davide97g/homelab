/**
 * The JARVIS orb.
 *
 * Modelled on desertcache/samantha-ui, but deliberately *not* ported the way that
 * project builds it. There it is a Three.js sphere whose vertices are pushed around by
 * 3D simplex noise in a vertex shader, with a fresnel term in the fragment shader. This
 * set is a MediaTek MT5887 with 2 GB of RAM on a 32-bit userspace, and Android 12 (API
 * 31) has no RuntimeShader — that landed in API 33 — so neither the shader nor a WebGL
 * canvas in a WebView is a safe bet.
 *
 * What is drawn instead is a single closed curve whose radius is the sum of four sine
 * harmonics, filled with a radial gradient and given a blurred rim. Visually it lands in
 * the same place; mechanically it is a Path, a RadialGradient and a BlurMaskFilter,
 * which is exactly what android.graphics offers. Every number below survives the port.
 */

const ORB_STATES = {
  // amp/freq/phase per harmonic, drift speed, glow radius, and the two fill colours
  IDLE: {
    label: '', primary: '#E8A87C', secondary: '#9A5B3C', rim: '#6FC9FF',
    amps: [.026, .034, .018, .008], speed: .10, glow: .38, scale: .88, pulse: 0,
  },
  LISTENING: {
    label: 'in ascolto', primary: '#F3C7A2', secondary: '#D98A5A', rim: '#7FD4FF',
    amps: [.032, .044, .024, .011], speed: .20, glow: .52, scale: 1, pulse: .05,
  },
  THINKING: {
    label: 'sto pensando', primary: '#C9B6FD', secondary: '#6D28D9', rim: '#22D3EE',
    amps: [.028, .046, .032, .018], speed: .55, glow: .60, scale: .95, pulse: .16,
  },
  SPEAKING: {
    label: 'sto parlando', primary: '#FBBF24', secondary: '#C2410C', rim: '#FFE1A8',
    amps: [.038, .058, .030, .015], speed: .32, glow: .66, scale: 1.04, pulse: .05,
  },
  ERROR: {
    label: 'non ci arrivo', primary: '#F87171', secondary: '#7F1D1D', rim: '#FCA5A5',
    amps: [.020, .026, .014, .007], speed: .14, glow: .40, scale: .86, pulse: .30,
  },
};

const HARMONIC_FREQ  = [2, 3, 5, 7];    // coprime, so the shape never repeats itself
const HARMONIC_DRIFT = [1, -.62, .83, -1.1];

const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a + (b - a) * t;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

class Orb {
  constructor(canvas) {
    this.cv  = canvas;
    this.ctx = canvas.getContext('2d');
    // No blur filter anywhere in the draw: one pegged a desktop CPU here, and this set
    // has four A53s. The glow is a radial gradient instead — soft by construction, and
    // a plain RadialGradient shader when this becomes Android.
    this.state = 'IDLE';
    this.amplitude = 0;            // 0-1, the voice envelope while speaking
    this.t = 0;
    this.running = false;
    // the live values, lerped toward the target state so a change of state is a
    // transition rather than a cut
    this.now = this.snapshot(ORB_STATES.IDLE);
  }

  snapshot(s) {
    return {
      amps: s.amps.slice(), speed: s.speed, glow: s.glow, scale: s.scale, pulse: s.pulse,
      primary: hex2rgb(s.primary), secondary: hex2rgb(s.secondary), rim: hex2rgb(s.rim),
    };
  }

  set(state) { if (ORB_STATES[state]) this.state = state; }
  setAmplitude(a) { this.amplitude = Math.max(0, Math.min(1, a)); }

  start() { if (!this.running) { this.running = true; this.last = performance.now(); this.loop(); } }
  stop()  { this.running = false; }

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt  = Math.min(.05, (now - this.last) / 1000);   // clamp: a stalled tab must not jump
    this.last = now;
    this.step(dt);
    this.draw();
    requestAnimationFrame(this.loop);
  };

  step(dt) {
    const target = this.snapshot(ORB_STATES[this.state]);
    const k = 1 - Math.pow(.004, dt);        // ~600 ms to settle, frame-rate independent
    const n = this.now;
    n.amps = n.amps.map((v, i) => mix(v, target.amps[i], k));
    ['speed', 'glow', 'scale', 'pulse'].forEach(p => { n[p] = mix(n[p], target[p], k); });
    ['primary', 'secondary', 'rim'].forEach(p => {
      n[p] = n[p].map((v, i) => mix(v, target[p][i], k));
    });
    this.t += dt * n.speed;
  }

  /** radius at one angle: the base circle plus four drifting harmonics and the voice */
  radius(theta, R) {
    const n = this.now;
    let r = 1;
    for (let i = 0; i < 4; i++) {
      r += n.amps[i] * Math.sin(HARMONIC_FREQ[i] * theta + this.t * 6.28 * HARMONIC_DRIFT[i]);
    }
    r += this.amplitude * .16 * Math.sin(2 * theta + this.t * 9);
    return R * r;
  }

  draw() {
    const { ctx, cv } = this;
    const w = cv.width, h = cv.height;
    const cx = w / 2, cy = h / 2;
    const n = this.now;

    // a slow breath under everything, and the faster pulse THINKING and ERROR carry
    const breath = 1 + .012 * Math.sin(this.t * 2.2) + n.pulse * .05 * Math.sin(this.t * 9);
    const R = Math.min(w, h) * .31 * n.scale * breath * (1 + this.amplitude * .05);

    ctx.clearRect(0, 0, w, h);

    // 96 points is plenty at this size and a third of the trigonometry of 160
    const pts = 96;
    const rs = new Float32Array(pts), xs = new Float32Array(pts), ys = new Float32Array(pts);
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      rs[i] = this.radius(a, R);
      xs[i] = cx + Math.cos(a) * rs[i];
      ys[i] = cy + Math.sin(a) * rs[i];
    }
    // through the midpoints with a quadratic each side: a closed curve with no
    // corners, and the exact shape Path.quadTo builds on Android
    const trace = (c2, target) => {
      const mid = (i, j) => [(xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2];
      let [mx, my] = mid(pts - 1, 0);
      (target ? target.moveTo(mx, my) : c2.moveTo(mx, my));
      for (let i = 0; i < pts; i++) {
        const [nx, ny] = mid(i, (i + 1) % pts);
        (target || c2).quadraticCurveTo(xs[i], ys[i], nx, ny);
      }
      (target || c2).closePath();
    };
    const path = new Path2D();
    trace(null, path);

    // the glow, thrown well past the body
    const blend = m => [mix(n.primary[0], n.secondary[0], m),
                        mix(n.primary[1], n.secondary[1], m),
                        mix(n.primary[2], n.secondary[2], m)];
    const halo = ctx.createRadialGradient(cx, cy, R * .5, cx, cy, R * 2.05);
    halo.addColorStop(0,   rgba(blend(.25), .45 * n.glow));
    halo.addColorStop(.30, rgba(n.secondary, .26 * n.glow));
    halo.addColorStop(.62, rgba(n.secondary, .09 * n.glow));
    halo.addColorStop(1,   rgba(n.secondary, 0));
    ctx.fillStyle = halo;
    // only the square the glow actually reaches — filling the whole surface with a
    // gradient is the one thing in this draw that would cost real time at 1080p
    const hb = R * 2.05;
    ctx.fillRect(cx - hb, cy - hb, hb * 2, hb * 2);

    // body
    const g = ctx.createRadialGradient(cx - R * .26, cy - R * .32, R * .05, cx, cy, R * 1.12);
    g.addColorStop(0,   rgba(n.primary, 1));
    g.addColorStop(.58, rgba(n.primary, .97));
    g.addColorStop(.86, rgba(blend(.42), 1));
    g.addColorStop(1,   rgba(blend(.72), 1));
    ctx.fillStyle = g;
    ctx.fill(path);

    // chromatic rim: one cool edge above, one warm edge below, both offset by a pixel
    // or two. It is what stops the shape reading as a flat sticker.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1.5, R * .008);
    ctx.strokeStyle = rgba(n.rim, .30);
    ctx.setTransform(1, 0, 0, 1, -R * .010, -R * .012); ctx.stroke(path);
    ctx.strokeStyle = rgba(n.secondary, .22);
    ctx.setTransform(1, 0, 0, 1, R * .008, R * .014);   ctx.stroke(path);
    ctx.restore();

    // the light sits high and left, so the surface has somewhere to fall away from
    ctx.save();
    ctx.clip(path);
    const hl = ctx.createRadialGradient(cx - R * .34, cy - R * .42, 0, cx - R * .34, cy - R * .42, R * .95);
    hl.addColorStop(0, 'rgba(255,255,255,.26)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
