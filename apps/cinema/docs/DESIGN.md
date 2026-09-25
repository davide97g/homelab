# Reel

Cinema's design language. One palette, one set of rules, three clients.

## The five rules

1. **Near-black neutral surfaces.** `--canvas` is almost black and very slightly cool. Artwork
   supplies every colour on screen; the interface never competes with it.
2. **Space separates things, not borders and not glass.** One hairline exists for the rare case
   where two dark surfaces touch. No blur, no glow, no panel outlines.
3. **One action colour.** `--primary` (red) is Play, the active nav marker, and progress.
   Nothing else is red. `--match` (green) is the single positive signal, used for the community
   rating; `--amber` flags status. That is the whole colour budget.
4. **Type carries the hierarchy** — size and weight, not boxes. Titles are tight and semibold;
   metadata is small, muted, and dot-separated. Chips are for interactive filters only, never
   for facts: a card that lists its genres in pills reads like a form.
5. **Semantic names only in component code.** No hex, no raw token. If a value is missing, it
   belongs in `tokens.json`.

## Tokens

`packages/design-tokens/tokens.json` is the only place a colour is decided. `bun run tokens`
emits:

| Output | Consumer |
|---|---|
| `apps/web/src/styles/tokens.css` | CSS custom properties, bridged into Tailwind in `src/index.css` |
| `apps/ios/Swiftfin/Shared/Cinema/CinemaTokens.swift` | `CinemaTokens.Palette`, `CinemaTokens.Radius` |
| `apps/android/findroid/core/…/design/CinemaTokens.kt` | `CinemaTokens`, feeding a Compose `darkColorScheme` |
| `apps/android/findroid/core/…/values/cinema_tokens.xml` | `@color/cinema_*`, for Findroid's XML theme and its View-based player chrome |

Each file is written straight into the app that consumes it — the forks are vendored in this
repository, so there is nowhere to copy it on to. A palette that has to be carried across by hand
is a palette that drifts.

Android needs two outputs because Findroid is not all Compose: `core/res/values/themes.xml` and
the ExoPlayer control layouts are Views resolving `?attr/colorPrimary` and `?attr/colorSurface`,
and the launcher and TV banner backgrounds are `@color` resources.

Colours are authored as hex rather than oklch precisely because three platforms have to agree on
them; Swift and Kotlin have no oklch parser worth carrying.

Radius, shadow and font tokens are emitted with `--rad-*`, `--shad-*` and `--type-*` prefixes so
they cannot collide with Tailwind's own `--radius-*`, `--shadow-*` and `--font-*` theme
namespaces. `apps/web/src/index.css` bridges them into `@theme`, and that one file is also where
the Reel tokens are mapped onto the shadcn-style names (`--background`, `--card`, `--ring`, …)
that the inherited UI primitives in `src/components/ui` consume. Re-skinning the web app is that
file plus `tokens.json`, not thirty components.

## Scrims

Text on artwork is the one place this design can fail badly, so both gradients are utilities in
`index.css` rather than per-component guesses:

- `.art-scrim` — vertical, for a poster. Near-opaque in the bottom fifth, gone by 62%.
- `.hero-scrim` — horizontal plus a bottom wash, for copy set against a wide backdrop.

A title sitting on a bright frame without one of these is a bug, not a style choice.

## The reference layout

`apps/web` is the canonical implementation. iOS and Android copy its structure, not its code:

- **Left rail** — brand, search field, then navigation grouped under quiet uppercase labels. The
  active item is a filled row with a red marker at its left edge. No panel; space separates the
  rail from the content.
- **Feature band** — the top of the home screen is one row: a large paging card plus two cards
  beside it, sharing a height so it reads as a single band of artwork. The pager is dots.
- **Rows** — heading, then a snapping track. Arrows appear on hover and page by a viewport.
  A heading that leads somewhere carries a chevron.
- **Cards** — artwork with a kind tag, title and a dot-separated fact line on a scrim. Progress
  is a red hairline across the bottom, and only when playback is genuinely part-way through.
- **Player** — two gradient washes, top and bottom, so the middle of the frame is never covered.
  The scrub bar is a native range input with three spans drawn behind it.

## Motion

Transitions use `--ease` and `--duration-*`. Artwork scales slightly on hover; nothing rotates,
tilts or glows. The `prefers-reduced-motion` block in `index.css` is not optional.
