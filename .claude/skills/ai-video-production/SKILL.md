---
name: ai-video-production
description: Builds, assembles and selectively re-renders video in Orkestr using verified tools only - Playwright UI recordings, Ken Burns stills, Remotion compositions, FFmpeg concat/encode/loop - and states plainly that AI text-to-video is unavailable. Use for commercials, reels, homepage loops, UI walkthroughs, aspect variants, or re-making a single scene.
---

# AI video production (what is really possible)

## Triggers
- "Make the video / cut / reel / loop", "re-do scene 3", "add a 9:16 version", "assemble these clips".
- Any request for generated footage or image-to-video (answer: unavailable; use alternatives below).

## Inputs
- Scene visuals (library images/videos), a storyboard (from `creative-director`) or a scene list, optional voiceover, music, captions, logos.
- Target aspect (`16:9`, `9:16`, `1:1`, `4:5`), fps (12-60, default 30), duration.

## Outputs
- MP4 (H.264/AAC, yuv420p, faststart) and for loops a muted MP4 + WebM; exported to the project's exports folder (`GET /api/exports?projectId=`, download `GET /api/exports/file?projectId=&name=`).

## Steps
1. **Confirm tools** (`tool-discovery`): `remotion.render`, `ffmpeg.*`, `playwright.record` as needed.
2. **Choose the building blocks** (all free, local):
   - `video.capture` (`playwright.record` + `ffmpeg.encode`): real scroll walkthrough of a page, WebM encoded to MP4. Params `url`, `width` 1920, `height` 1080, `locale`, `durationS` 1-60 (8), `scrollTo`, `mobile`, `hideSelectors`. Recording runs about 25 fps and depends on machine load; encode step normalizes to 30 fps.
   - `video.still` (`ffmpeg.still`): image -> clip with slow push-in (Ken Burns). `durationS` 0.2-120 (4), `aspect`, `fps`, `pushIn`. This is **not** AI image-to-video.
   - `production.compose` (`remotion.render`, composition `Commercial`): the main assembler. Inputs: `visuals[]` (in scene order), `storyboard`, `voiceover`, `music`, `subtitles`, `logo[]` (first = light, second = reversed). Params: `aspect`, `fps`, `direction`, `palette`, `scenes[]`, `voiceoverDelayS` (0.4), `musicVolume` (0.22), `showCaptions`, `draftBanner`, `maxDurationS` (hard fail if scenes exceed it). Details in `remotion-composition`.
   - `production.loop` -> `video.loop`: text-free seamless homepage loop from stills (`images` max 12), then crossfade tail into head (`crossfadeS` 0.1-5, `webm`). Loop composition takes stills only.
   - `production.concat` (`ffmpeg.concat`): join clips at one size/fps; silent clips get silent audio.
   - `video.encode` (`ffmpeg.encode`): resize/re-encode (`aspect`, `fps`, `crf` 0-51 (20), `format` mp4|webm, `audio`, `maxBitrateK`).
   - `production.mix` (`ffmpeg.mux`): put voiceover/music under a video (see `audio-production`). `production.subtitles`: soft SRT track (`language` 3 letters, `ara`). `production.poster_frame`: still frame at `timeS`.
   - `video.vfx` (EffectCraft) for authored motion graphics; see `animation-and-vfx`.
3. **Aspect variants**: add one branch per deliverable with the same upstream nodes; only compose/encode re-run. Do not reuse a full-length VO on a shorter cut (it will not fit).
4. **Gate and QA**: finish every cut with `production.qa` (`production.qa` skill) -> `logic.approval` -> `production.export`.
5. **Selective regeneration of one scene**: after a run, change only that scene's node (e.g. new capture params, replaced asset id, new `scenes[i]` copy) via `PUT /api/workflows/{id}` (send `expectedVersion`), then `POST /api/runs/{runId}/rerun` `{"nodeIds":["scene3"]}`. That creates a child run where those nodes bypass the cache and every unaffected node is reused (ledger shows `reused`). Edited params also change the signature, so edited nodes re-run automatically; use `rerun` to force an unchanged node (e.g. a flaky capture). Failed nodes in an existing run: `POST /api/runs/{runId}/retry` (completed nodes are kept).

### Not possible now
`video.generate`, `video.image_to_video` are permanent `available:false` (no ComfyUI, fal, Runway or Higgsfield key). Alternatives: real UI capture, Ken Burns on brand stills, Remotion motion layouts, authored EffectCraft/AniCraft projects, imported licensed footage (`production.import`). Mark stand-in visuals `placeholder` so the draft banner stays on; never present them as final footage. To enable generation later: provider adapter + credential per `tool-discovery`.

## Tool dependencies
`remotion.render`, `ffmpeg.encode/still/concat/loop/mux/poster/probe/frames`, `playwright.record`; optional `effectcraft.render`.

## Errors & recovery
- `scenes total Xs exceeds maxDurationS`: fix scene durations (sum must match the target).
- `no scenes`: connect `visuals` or a storyboard.
- `render input missing`: an upstream asset file was deleted; re-run the producer node.
- Transient `TOOL_FAILED`/`TIMEOUT`: engine retries (default 3 attempts, exponential backoff from 2 s, max 10 min); after exhaustion `POST .../retry`.
- Worker crash mid-render: running nodes with stale heartbeat (30 s) are re-queued on restart; nothing to do.
- Cancel a run: `POST /api/runs/{id}/cancel`.

## Acceptance criteria
- Output has expected resolution, fps, duration, audio stream, `yuv420p`, no black segments (QA passes).
- Scene durations sum to the target; placeholders are flagged on screen; no AI-generated claim.
- Human approval gate was decided (`GET /api/approvals?status=pending`).

## Examples
Re-make scene 3 only: edit `scene3` params in the workflow, then
`curl.exe -s -H "Content-Type: application/json" -d "{\"nodeIds\":[\"scene3\",\"compose\"]}" http://127.0.0.1:4317/api/runs/run_xxx/rerun` (include downstream nodes you want rebuilt; `compose` re-runs anyway because its input bytes changed).
Loop: `production.import x4 -> production.loop(aspect "16:9", durationS 12, scrim 0.15) -> video.loop(crossfadeS 1, webm true) -> production.qa(requireAudio false) -> logic.approval -> production.export`.
