---
name: remotion-composition
description: Configures and extends Orkestr's Remotion compositions (Commercial, Poster, Loop, TestCard) - scene layouts, captions, placeholder draft banners, aspect variants - and explains how to preview with Remotion Studio and add a new composition. Use for layout/typography/caption tweaks, aspect variants, or building a new composition.
---

# Remotion composition

Compositions live in `remotion/` (`Root.tsx`, `schema.ts`, `compositions/*.tsx`, `fonts.ts`, `public/`). Props contracts are Zod schemas in `remotion/schema.ts`, shared with the production nodes. Orkestr bundles Remotion once per source hash (changes under `remotion/` trigger a rebuild) and renders H.264/AAC MP4 (`remotion.render`) or stills (`remotion.still`). Local files are passed as `orkestr-file:<abs path>` strings and served over a loopback server during the render.

## Triggers
- "Change the layout / captions / banner", "make a 9:16 / 1:1 / 4:5 version", "add a new composition", "preview in Remotion".

## Inputs
- Node params on `production.compose` (usually), or raw props via adapter. Palette keys: `bg`, `fg`, `accent`, `accent2`, `surface`, `onSurface` (defaults forest/cream/terracotta `#F7F1E8 #22412D #C97A55 #4F7D5A #1A3324 #F7F1E8`).

## Outputs
- MP4 with brand overlays, captions, audio; or PNG/JPEG poster.

## Steps
1. **Commercial props** (`CommercialPropsSchema`): `width`, `height`, `fps` (1-60), `direction` rtl|ltr, `palette`, `scenes[]` (>=1), `logo`, `logoReversed`, `voiceover`, `voiceoverDelayS` (0.4), `voiceoverVolume` (1), `music`, `musicVolume` (0.25; fades in 1 s, out 1.5 s), `captions[{text,startMs,endMs}]`, `showCaptions`, `draftBanner`. Total duration = sum of scene `durationS` x fps.
2. **Scene** (`CommercialSceneSchema`): `id`, `durationS` 0.3-120, `layout`, `visual{src,type image|video,fit cover|contain,kenBurns,frame none|browser|phone,scroll,startFromS}` or null, `kicker`, `headline`, `body`, `transition` fade|slide|none, `placeholder`.
3. **Layouts**: `full-bleed` (visual + scrim, text bottom-start, logo bug top-end), `ui-showcase` (headline small, UI in browser frame on desktop or phone frame in portrait), `split` (50/50, column in portrait), `title` (dark surface, accent bar, text), `end-card` (reversed logo + text on radial forest gradient). Defaults from `production.compose`: last scene = `end-card`, others `full-bleed`; the Director picks `ui-showcase` for `ui-capture` scenes and `title` for motion-graphics scenes. Typography uses a unit = 1% of the short side, so layouts scale across aspects; keep headlines short (about 6-9 words).
4. **Captions**: connect an SRT to `subtitles`; cues are burned into a bottom pill, shifted by `voiceoverDelayS`. Whisper output needs human review first (`audio-production`).
5. **Placeholder honesty**: any scene with `placeholder:true` makes the node set `draftBanner` to `DRAFT · placeholder visuals` (or your text) as a burned-in orange top bar. Leave it on until real footage replaces stand-ins. Never clear it to hide placeholders.
6. **Aspect variants**: `aspect` -> `ASPECT_SIZES`: `16:9` 1920x1080, `9:16` 1080x1920, `1:1` 1080x1080, `4:5` 1080x1350. Add a deliverable branch per aspect (same inputs, new `aspect`; for 9:16 use `maxChars` 32 captions and consider `mobile` UI captures). Shorter variants need their own VO.
7. **Poster** (`PosterPropsSchema`): `background`, `kicker`, `headline`, `sub`, `cta`, `logo`, `direction`, `palette`, `width`/`height` (via `image.poster` `aspect`). **Loop** (`LoopPropsSchema`): `images` 1-12, `durationS` 2-60, `scrim` 0-0.9, `logo`; text-free and seamless (sine drift + wraparound dissolve). **TestCard**: 640x360 smoke test only.
8. **Preview/edit**: `npm run remotion:studio` (Remotion Studio on `remotion/index.ts`; this starts a dev server, so only run it when asked). Edit TSX, then any compose run rebundles automatically.
9. **Add a composition**: (a) add a props schema + type in `remotion/schema.ts`; (b) create `remotion/compositions/MyComp.tsx` using `useVideoConfig` and the shared unit pattern; (c) register `<Composition id="MyComp" schema=... defaultProps=... calculateMetadata=...>` in `remotion/Root.tsx` (derive width/height/fps/duration from props); (d) add `"MyComp"` to `COMPOSITIONS` in `src/server/adapters/remotion.ts` (the adapter's Zod enum rejects unknown ids); (e) add a node in `src/server/engine/node-types.ts` that builds the props and calls `remotion.render`/`remotion.still`; (f) add a test, run `npm run typecheck` and `npm test`. Arabic needs `ensureFonts()` and `direction` support.

## Tool dependencies
`remotion.render`, `remotion.still` (free; Chrome Headless Shell auto-downloaded once), ffmpeg only downstream. Remotion licence terms apply to companies (remotion.dev/license): mention it if the user is a company.

## Errors & recovery
- Zod parse error in `CommercialPropsSchema`: fix the field named in the message (e.g. missing scenes, `fit`).
- `render input missing: <path>`: referenced file deleted.
- Selected composition unknown: add it to `COMPOSITIONS`.
- Slow first render: bundling + browser download; later renders reuse the bundle.
- Text overflow: shorten copy or switch layout (`split`/`title`), do not shrink below legibility.

## Acceptance criteria
- Output resolution equals the aspect size; duration equals the sum of scenes; fps as set.
- Placeholders carry the draft banner; no unverified claims in copy; logos undistorted.
- Frames extracted from start, middle of each scene and end look correct in RTL.

## Examples
```json
{ "id": "compose", "type": "production.compose",
  "params": { "aspect": "9:16", "direction": "rtl", "maxDurationS": 15.5, "showCaptions": false,
    "scenes": [ { "id": "s1", "durationS": 3, "layout": "full-bleed", "visualIndex": 0, "headline": "..." },
                { "id": "s5", "durationS": 3, "layout": "end-card", "headline": "..." } ] } }
```
