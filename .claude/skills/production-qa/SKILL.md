---
name: production-qa
description: Verifies finished Orkestr video with the production.qa technical checks, extracted frames, optional advisory AI review and ffprobe commands, then drives human approval and bounded retries. Use before any export or delivery, when a render looks wrong, or when asked "is this ready to ship?".
---

# Production QA

## Triggers
- A cut/loop/poster finished and needs checking; before approving or exporting.
- QA failed, captions look off, audio is quiet/clipping, wrong size/duration.

## Inputs
- The video asset (via a graph edge into `production.qa`) and optionally the SRT (`subtitles` input).
- Expectations: `expectWidth`, `expectHeight`, `expectFps`, `minDurationS`, `maxDurationS`, `requireAudio` (default true; set false for silent reels/loops), `frames` 1-24 (6), `maxBytes`.

## Outputs
- `report` JSON (`QaReport`: `pass`, `checks[{name,pass,expected,actual,severity}]`, `facts{...}`) and extracted PNG `frames`. Asset label `QA PASS` / `QA FAIL`; failed checks are logged as warnings.

## Steps
1. **Run `production.qa`** (needs `ffmpeg.probe` + `ffmpeg.frames`). The Director wires it into every cut and loop, followed by `logic.approval`. Pass is `true` when every check passes except `minor` ones.
2. **Know the checks** (`src/server/qa.ts`):
   | Check | Pass condition | Severity |
   |---|---|---|
   | readable | ffprobe can open the file (else the report ends with this critical fail) | critical |
   | video stream | exists | critical |
   | resolution | equals `expectWidth`x`expectHeight` | critical |
   | frame rate | within 0.01 of `expectFps` | major |
   | duration | within `[min-0.05, max+0.05]` s | critical |
   | audio stream | at least 1 (skipped when `requireAudio:false`) | critical |
   | web-safe pixel format | `yuv420p` | major |
   | codec | h264, vp9, hevc or av1 | major |
   | file size | `<= maxBytes` (if set) | minor |
   | loudness | integrated -20...-12 LUFS (target -16), if audio | minor |
   | true peak | <= -0.5 dBFS, if audio | minor |
   | black segments | none lasting >= 0.5 s (`blackdetect d=0.5 pix_th=0.06`) | major |
   | subtitles (with SRT) | parse, no overlaps (minor), none past the end (major), cue <= 84 chars (minor) | mixed |
3. **Read the report**: `GET /api/runs/{runId}` (node outputs) or the report asset via `GET /api/assets/{id}/file`. `minor` failures do not set `pass:false` but must still be reported.
4. **Look at the frames** yourself (they are image assets): check text clipping, RTL order, logo placement, banner, placeholders, UI correctness against the live product.
5. **Optional AI review**: `ai.review` (`claude.review`, paid, cost unknown so it needs approval) takes up to 24 `frames`, `brief`, `checklist[]`, returns `{verdict pass|needs_changes|fail, summary, issues[]}`. It is advisory; it never replaces the human gate. Only run it if the user accepts the cost.
6. **Independent verification** with ffprobe (read-only):
   - `ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,channels:format=duration,bit_rate -of json <file>`
   - `ffmpeg -hide_banner -nostats -i <file> -af ebur128=peak=true -f null -` (loudness)
   - `ffmpeg -i <file> -vf blackdetect=d=0.5:pix_th=0.06 -f null -` (black frames)
   - `ffmpeg -ss 5 -i <file> -frames:v 1 frame.png` (one frame)
7. **Human approval gate**: `GET /api/approvals?status=pending&projectId=`; present QA + frames + the video; the person decides `POST /api/approvals/{id}` `{"decision":"approved"|"rejected","note":"..."}`. Rejection fails that branch (`REJECTED`, not retryable). Only `approved` unlocks `production.export`. Never approve on the user's behalf.
8. **Bounded fix loop**: on failure, diagnose by check name, change the responsible node, `POST /api/runs/{id}/rerun` `{nodeIds:[...]}` (or `retry` for failed nodes). Allow at most 3 fix iterations per defect; then stop and report what is blocking (each loop may cost render time or money). Never loosen `expect*` thresholds just to pass.

## Tool dependencies
`ffmpeg.probe`, `ffmpeg.frames` (free); `claude.review` optional (paid).

## Errors & recovery
- `resolution` fail: wrong `aspect` on compose/encode; fix and rerun the producer.
- `duration` fail: scene durations or VO length; align scenes to target (+-0.5 s).
- `audio stream` fail on a silent loop/reel: set `requireAudio:false`, or add VO/music.
- `black segments`: a missing visual or a gap; check scene visuals/`startFromS`.
- `loudness`/`true peak`: run `audio.normalize`, or `production.mix` with `loudnorm`.
- `subtitles within duration`: SRT longer than video; regenerate captions or trim.
- Report says `readable` false: corrupt/partial render; rerun the render node.

## Acceptance criteria
- `report.pass === true` and every minor failure acknowledged in writing.
- Frames inspected; human approval recorded as `approved` (not just QA).
- Facts (size, fps, duration, loudness) quoted from the report, not assumed.
- At most 3 bounded retries per defect, documented.

## Examples
Qa node for a 16:9, 32 s commercial: `{"type":"production.qa","params":{"expectWidth":1920,"expectHeight":1080,"expectFps":30,"minDurationS":29,"maxDurationS":36,"requireAudio":true,"frames":6}}`.
Silent homepage loop: `{"expectWidth":1920,"expectHeight":1080,"expectFps":30,"minDurationS":11.4,"maxDurationS":12.6,"requireAudio":false}`.
Approve: `curl.exe -s -H "Content-Type: application/json" -d "{\"decision\":\"approved\",\"note\":\"QA pass, frames ok\"}" http://127.0.0.1:4317/api/approvals/apv_xxx` (only after the human says so).
