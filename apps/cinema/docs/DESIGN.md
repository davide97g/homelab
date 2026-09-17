# Nebula

Cinema's design language. One palette, one set of rules, three clients.

## The five rules

1. **Deep violet canvas, never flat black.** The page is `--canvas-deep` lit by two fixed
   radial glows — pink from the top left, violet from the top right. Fixed, not scrolled: the
   light stays where the light source is while content moves past it.
2. **Everything lives on a glass panel.** Translucent surface, 1px hairline, generous radius,
   real blur. Nothing is edge-to-edge except artwork, and artwork is still inside a radius.
3. **One action colour.** `--primary` (hot pink) is Play, submit, active nav, progress. If two
   things on a screen are pink, one of them is wrong.
4. **Artwork is the card.** Posters and backdrops carry their own text on a gradient scrim;
   chips and badges float on glass over the image. No captions in boxes below pictures.
5. **Semantic names only in component code.** No hex, no raw token, no one-off colour. If a
   value is missing, it belongs in `tokens.json`.

## Tokens

`packages/design-tokens/tokens.json` is the only place a colour is decided. `bun run tokens`
emits:

| Output | Consumer |
|---|---|
| `apps/web/src/styles/tokens.css` | CSS custom properties, bridged into Tailwind in `src/index.css` |
| `apps/ios/generated/CinemaTokens.swift` | `CinemaTokens.Palette`, `CinemaTokens.Radius` |
| `apps/android/generated/CinemaTokens.kt` | `CinemaTokens`, feeding a Compose `darkColorScheme` |

Colours are authored as hex rather than oklch precisely because three platforms have to agree
on them; Swift and Kotlin have no oklch parser worth carrying.

Radius, shadow and font tokens are emitted with `--rad-*`, `--shad-*` and `--type-*` prefixes so
they cannot collide with Tailwind's own `--radius-*`, `--shadow-*` and `--font-*` theme
namespaces. `apps/web/src/index.css` bridges them into `@theme`, and that one file is also where
the Nebula tokens are mapped onto the shadcn-style names (`--background`, `--card`, `--ring`, …)
that the inherited UI primitives in `src/components/ui` consume. Re-skinning the web app is that
file plus `tokens.json`, not thirty components.

## The reference layout

`apps/web` is the canonical implementation. iOS and Android copy its structure, not its code:

- **Left rail** — brand, navigation built from the server's own libraries, what you left
  half-watched, sign out pinned to the bottom. Below `lg` it becomes a scrolling pill row.
- **Top bar** — search pill (`/` focuses it), a bell that counts what is actually waiting in
  Next Up, account menu.
- **Hero** — a framed backdrop you can page through, badge, logo art where the server has it,
  two actions, a pager counter.
- **Right rail** — "In library": dense, text-first, one click to Play. It exists to get you
  into something without browsing.
- **Rows and grids** — artwork cards with chips; arrows page by a viewport of track, never by
  one card.

## Motion

Transitions use `--ease` and `--duration-*`. Hover lifts a card, it does not spin one. The
`prefers-reduced-motion` block in `index.css` is not optional — it is the reason the glow and
sheen effects are allowed to exist at all.
