---
name: animation-and-vfx
description: Adds motion graphics, VFX and animation to Orkestr productions using EffectCraft renders, the AniCraft adapter, and Remotion layouts/transitions, with strict limits on what exists today. Use for lower thirds, animated titles, VFX plates, GIFs, transitions, or "animate this".
---

# Animation and VFX

## Triggers
- "Animated intro/lower third/VFX", "render this EffectCraft project/template", "make a GIF", "transitions between scenes", "animate the logo".
- Not for AI-generated animation (unavailable; see `ai-video-production`).

## Inputs
- EffectCraft: an existing `.ecproj` project or `.ectemplate` (+ `values` map) **authored in EffectCraft**; optional `comp` name.
- AniCraft: an existing `.anicraft` file.
- Remotion: scene copy, visuals, `transition`, `layout` choices.
- File paths must be under Settings `importRoots` (`GET/PUT /api/settings`).

## Outputs
- EffectCraft: H.264 MP4 (`h264`), ProRes MOV (`prores`), WebM (`webm`); the adapter also supports `png`, but the `video.vfx` node accepts only `h264|prores|webm`.
- Remotion: finished commercial MP4 with transitions and overlays.

## Steps
1. **Check readiness**: `effectcraft.render` must be `ready` in `GET /api/system` (smoke test opens the headless engine).
2. **EffectCraft via `video.vfx`** (no inputs, output `video`): params `project` or `template` (+ `values` record, `comp`, `format` default `h264`). The node rejects any path not under an import root (`... is outside the allowed import folders`): add the folder to `importRoots` first (ask the user). Without project or template the adapter raises `INVALID_INPUT`. Wire the output video into `production.compose` visuals (a video input becomes `visual.type: "video"`) or `production.concat`.
3. **Transparent/single frames**: `effectcraft.renderFrame` (PNG, optional transparent) and **AniCraft** (`anicraft.renderSequence` -> PNG frames, `anicraft.gif`; params `file`, `from`, `to`, `scale` 0.1-4) are adapter capabilities with **no node type** in `node-types.ts` today. To use them, add nodes (see `tool-discovery` > Adding an adapter; AniCraft PNG sequences would then be encoded by `ffmpeg.encode`). Do not claim a workflow can run them until a node exists and `GET /api/node-types` lists it.
4. **Remotion motion** (free, always available when Remotion is ready), in `production.compose` scenes:
   - `layout`: `full-bleed` (visual + bottom text on scrim), `ui-showcase` (UI capture in a browser/phone frame on a cream gradient), `split` (visual beside text; stacks vertically in portrait), `title` (dark surface, accent bar), `end-card` (logo + text).
   - `transition`: `fade` (0.4 s), `slide` (direction follows `rtl`/`ltr`), `none`. The first scene never transitions.
   - Visual options: `kenBurns` (stills, 1.0 -> 1.08 push-in), `frame` `none|browser|phone`, `scroll` (long UI capture scrolls top to bottom), `startFromS`, `fit`.
   - Text reveals use spring easing (kicker, headline, body staggered).
   - `production.loop`: text-free seamless sine-drift loop for homepage backgrounds.
5. **Review** by extracting frames (see `production-qa`) around transitions; check RTL slide direction and that text never overlaps the logo bug.

## Tool dependencies
`effectcraft.render` (free CLI, needs authored files), `remotion.render` (free), `ffmpeg.encode`/`concat`; AniCraft only after a node is added.

## Errors & recovery
- `outside the allowed import folders`: add the folder to `importRoots` (`PUT /api/settings` with the full `importRoots` array), do not move files around the guard.
- `effectcraft.render needs a project or template file`: supply `project` or `template`.
- Template values wrong: EffectCraft errors surface as `TOOL_FAILED` (retryable up to 3 times); fix `values`, rerun that node only.
- Slide/fade looks wrong in RTL: confirm `direction` param on compose.

## Acceptance criteria
- Only files from allowed roots were rendered; render output plays and matches the compose aspect/fps (re-encode through `video.encode` if not).
- No claim of capabilities lacking a node (AniCraft, renderFrame); motion is tasteful (no overlapping text, transitions consistent).
- QA passed on the final cut.

## Examples
```json
{ "id": "lower3", "type": "video.vfx",
  "params": { "template": "C:\\Brand\\templates\\lower-third.ectemplate", "values": { "name": "..." }, "format": "h264" } }
```
Scene motion in a compose node's `scenes[]`: `{ "id":"s2", "durationS":4, "layout":"ui-showcase", "transition":"slide", "headline":"...", "visual":{"type":"image","src":"placeholder","frame":"browser","scroll":true} }`. The node overwrites `src` (and `type`) from the connected visual, but because `VisualSchema` requires both fields, a `visual` override must still include them (any string; ambiguity noted in the repo review). If you only need defaults, omit `visual` and let the wiring fill it.
