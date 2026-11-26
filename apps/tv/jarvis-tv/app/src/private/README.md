# src/private — never committed

Assets bundled into the APK that are fine on our own TV but not ours to publish in a
public repo. Everything here except this file is git-ignored.

- `assets/meadow.jpg` — the screensaver painting (MeadowDream). Same file as
  `tv-preview/assets/private/meadow.jpg`: duna.com's hero painting with its text
  inpainted out, 1920×1080. Missing is fine: the dream draws plain cream.
- `assets/wallpaper.jpg` — the desktop wallpaper (WallpaperView): a lily pond seen from
  under the water, generated with Codex image generation from a reference painting,
  upscaled to 3840×2160 with Real-ESRGAN (x4plus). Decoded at screen size on the set.
  Missing is fine: the desktop falls back to meadow.jpg, then cream.
- `assets/wallpaper/scene.html` — the desktop wallpaper now (PixelWallpaperView): a
  pixel-art castle night with chibi characters, drawn in code on a 480×270 canvas and
  run in the WebView at 15 fps. Edit `tv-preview/assets/private/desktop-hp.html` (the
  browser preview with the menu bar and dock), then `scripts/wallpaper-extract.py`.
  Missing is fine: the desktop is plain night blue. `wallpaper.jpg` above is no longer
  shown; WallpaperView stays in the code for going back.
