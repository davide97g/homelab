# tv-preview — the launcher design, in a browser

A pixel-accurate mock of the TV home screen, so a layout change takes seconds to judge
instead of a Gradle build plus an ADB install.

```sh
tv-preview/serve.sh          # http://localhost:4321   (PORT=... to change it)
```

Arrow keys are the D-pad, Enter is OK. The buttons in the grey strip do the same, and
that strip is the only part that does not exist on the TV.

Three screens, stacked, `↓` and `↑` between them:

| | |
|---|---|
| **apps** | the showcase and the rail |
| **JARVIS** | the orb, alone on the screen |
| **homelab** | host gauges and the service probes |

## Why it matches the set

The `.stage` element is **1920×1080**, which is what Android composites on this panel —
the display is 4K but the surface is forced to 1080p. So every number in `app.css` is a
real device pixel, and the TV runs at **320 dpi**, so **1 dp = 2 px**: a 266 px card
here is `133dp` in the layout XML.

The dashed outline behind *safe area* is the 5 % the set can crop (96 px / 54 px,
i.e. `48dp` / `32dp` — the values already in `dimens.xml`).

The glow around the frame is the Ambilight, three-sided exactly like the real one
(left 4, top 9, right 4, bottom 0), tinted with the focused app's accent.

## The design

- **The showcase is a framed picture, not wallpaper.** The photograph sits 32 px inside
  the bezel with a 34 px radius, so the dark margin gives the type a quiet edge to start
  from and keeps the panel's backlight bloom off the image. The focused card's content
  is what fills it — a film backdrop, the album art, a photo memory — crossfaded over
  620 ms with a slow Ken Burns drift.
- **One easing everywhere**: `cubic-bezier(.16,1,.3,1)`, 180/340/620 ms. Nothing
  bounces; on a 65" screen at three metres, overshoot reads as a glitch.
- **Focus, never hover.** The focused card lifts 10 px, scales 1.07, takes a white
  ring and an accent-coloured glow. Everything else stays still.
- **Text swaps in place**: the hero fades down 14 px and back, staggered 30 ms per
  line. It never slides sideways — sideways reads as "the page changed".
- **JARVIS lives one screen down**, not in a box on the home screen. `↓` slides the
  whole reel by 1080 px and blurs the showcase behind it, so the assistant gets the
  full frame: question, answer at 52 px, and the homelab underneath it.
- **Services are a grid, not a row** — nine of them used to clip off the right edge.

## The orb

The JARVIS screen is the orb and nothing else — no panel, no card, the showcase dimmed
to 6 %. It carries five states, each with its own colour, deformation and speed:

| state | colour | reads as |
|---|---|---|
| `IDLE` | peach, almost still | waiting for the phone |
| `LISTENING` | lighter peach, slow swell | the mic is open |
| `THINKING` | violet with a cyan rim, fast and pulsing | the model is working |
| `SPEAKING` | amber to burnt orange, driven by the voice envelope | TTS is talking |
| `ERROR` | red, small, pulsing | the server did not answer |

State changes are lerped, not cut: every number settles over about 600 ms, so violet
arrives *while* the shape is already speeding up. The set's own Ambilight takes the
orb's colour, so the wall behind the TV turns violet while it thinks.

### Why it is not the original

It is modelled on [desertcache/samantha-ui](https://github.com/desertcache/samantha-ui),
but nothing is ported from it. There the orb is a Three.js sphere whose vertices are
displaced by 3D simplex noise in a vertex shader, with a fresnel term in the fragment
shader. Two things rule that out here:

- **API 31.** `RuntimeShader` — Android's route to running AGSL on a view — landed in
  API 33. This set is Android 12.
- **The hardware.** MT5887, four A53s, 2 GB of RAM, 32-bit userspace. A WebGL canvas in
  a WebView is not a bet worth making for the screen the assistant lives on.

So `orb.js` draws the same idea with arithmetic that `android.graphics` already has:

- the outline is one closed curve, `r(θ) = R · (1 + Σ aₖ·sin(fₖθ + drift))` over four
  coprime harmonics, sampled at 96 points and joined through their midpoints with a
  quadratic each side — `Path.quadTo`, exactly;
- the body is a `RadialGradient` with the light off-centre;
- the glow is a second `RadialGradient`, painted only inside the square it reaches;
- the rim is two 1.5 px strokes, one cool and offset up, one warm and offset down;
- the grain on top is a tiled bitmap.

No blur filter anywhere in the loop — the first version blurred the halo per frame and
pegged a desktop CPU, which is exactly the trap to avoid on four A53s. The preview holds
62 fps with the canvas running; the remaining unknown is the TV itself, and the way to
settle it is `deploy-tv.sh` plus `dumpsys gfxinfo`.

The orb's `requestAnimationFrame` only runs while its screen is showing — on the TV the
same rule applies, because the launcher is the home screen and must cost nothing while
someone is watching a film.

## Opening an app

The one place the design spends its boldness. Press OK and:

1. **The border sweeps.** A light runs round the focused card — the same ring that idles
   slowly while a card is focused, now at 0.45 s a turn and at full brightness. It gets
   420 ms alone, so the viewer sees *which* card answered before the screen moves.
2. **That card becomes the screen.** The card grows into the frame in 520 ms, corner
   radius 25 → 34 px, carrying the same photograph. One object travels, so there is
   never a frame showing neither the launcher nor the app. The card fades as the
   takeover passes it, rather than sitting on top of its own copy.
3. **The sweep carries on round the frame** while the app starts, over the app's
   monogram, its name, and an indeterminate bar. The photograph keeps pushing in at
   1.08× so the screen is never frozen.

That third beat is the point: starting an Android TV app takes 300–900 ms on this set,
and the animation *is* the loading state. `prefers-reduced-motion` drops all of it to a
plain crossfade.

Porting it: the sweep is a `SweepGradient` shader on a rounded-rect stroke, rotated by
a `ValueAnimator` — the CSS `@property --angle` here is the same idea. The takeover is a
view, not a transition: draw it, `startActivity`, and let the incoming app cover it.

Colours track `res/values/colors.xml`; the `--accent` token is overridden per focused
app on the home screen, and pinned to JARVIS cyan on the second one.

## The photographs

`assets/backdrops/` holds eight Unsplash stills, downloaded so the preview is offline and
identical on every run — sources and re-fetch commands are in
[`assets/backdrops/CREDITS.md`](assets/backdrops/CREDITS.md). The backdrop is held at
0.82 brightness and 0.92 saturation: it is the background, not the subject. Card art is
pushed the other way (1.12 brightness, 1.2 saturation, 1.12 zoom) because a still is tiny
at 266×150 and has to read as a place rather than a dark rectangle.

Asset URLs carry a `?v=` stamp that is bumped on every edit — without it the browser
keeps serving the previous CSS and the change appears not to have landed.

## Faking the content

`data.js` is the only file to edit for content. Each app carries a three-colour
`palette`, used both for its card face and for the full-screen backdrop gradient; `hero`
is what the showcase says while that app is focused.

On the TV those come from real sources — Jellyfin backdrops and resume positions, the
now-playing item, a photo album — and the palette gradient is the fallback for apps that
expose no art. Dropping a real still into `assets/` and pointing a `bg` at it is the
quickest way to check a layout against a photograph rather than a gradient.
