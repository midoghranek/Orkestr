# Orkestr project skills

Nine Claude Code skills for operating Orkestr (local-first creative production studio: Next.js + durable DAG engine + verified tool adapters) through its loopback HTTP API (`http://127.0.0.1:4317`) and npm scripts. They only describe what the code verifies today (`src/server/engine/node-types.ts`, `src/server/adapters/*`, `src/server/director.ts`, `src/server/qa.ts`, `remotion/`).

## How Claude Code finds them
Project skills live in `.claude/skills/<name>/SKILL.md`. Claude Code scans that folder when a session starts in this repo (and watches it for edits), reads only each skill's `name` and `description` frontmatter, and loads the full `SKILL.md` body when a request matches the description (or when you invoke `/<name>`). Supporting files next to a `SKILL.md` (e.g. `creative-director/templates.md`, `brief-example.md`) are read on demand through relative links. Commit `.claude/skills/` to share them with the team.

## Index

| Skill | Purpose | Trigger |
|---|---|---|
| `creative-director` | Brief -> validated plan (`DirectorPlanSchema`) -> accepted workflow; review rules (verified claims, ready tools, durations, Egyptian Arabic pacing) | New brief, "plan/storyboard", accepting a plan |
| `tool-discovery` | `npm run discover`, `/api/system`, capability matrix, Whisper model install, adding adapters | Session start, "not ready" errors, new tool installed |
| `ai-image-production` | Stills with verified tools (Playwright capture, PhotoCraft grade, VectorCraft rasterize, Remotion poster); generation unavailable and how to enable | Posters, screenshots, logo prep, "generate an image" |
| `ai-video-production` | Build/assemble video (capture, Ken Burns, compose, concat, encode, loop); selective scene regeneration; generation unavailable | Cuts, reels, loops, aspect variants, redo one scene |
| `animation-and-vfx` | EffectCraft renders, AniCraft status, Remotion layouts and transitions | Motion graphics, lower thirds, GIFs, transitions |
| `audio-production` | ElevenLabs VO (paid, gated), FilmCraft scratch TTS (English only), loudness, mix, Whisper captions, licensed music | Narration, captions, music, audio levels |
| `remotion-composition` | Commercial/Poster/Loop/TestCard props and layouts, draft banner, aspect sizes, Studio, adding a composition | Layout/caption changes, new compositions |
| `production-qa` | `production.qa` checks, frames, ffprobe, advisory `ai.review`, human approvals, bounded retries | Before export, failed render, "ready to ship?" |
| `cost-optimizer` | Approvals, `preauthorizedUsd`, `autoApproveUnderUsd`, cache reuse, rerun vs retry, `/api/costs` | Any run with paid nodes, cost questions |

## Mapping to Orkestr node families

| Node family (`NodeTypeInfo.family`) | Node types | Skills |
|---|---|---|
| `ai` | `ai.director`, `ai.write`, `ai.review` (paid, Claude CLI) | `creative-director`, `production-qa` (review), `cost-optimizer` |
| `image` | `image.capture`, `image.grade`, `image.rasterize`, `image.poster`; unavailable: `image.generate`, `image.edit`, `image.upscale` | `ai-image-production`, `remotion-composition` |
| `video` | `video.capture`, `video.still`, `video.vfx`, `video.loop`; unavailable: `video.generate`, `video.image_to_video` | `ai-video-production`, `animation-and-vfx` |
| `audio` | `audio.voiceover` (paid), `audio.tts_local`, `audio.normalize`, `audio.transcribe`, `production.mix`; unavailable: `audio.music`, `audio.sfx` | `audio-production` |
| `production` | `production.import`, `production.compose`, `production.loop`, `production.concat`, `video.encode`, `production.subtitles`, `production.poster_frame`, `production.qa`, `production.export` | `ai-video-production`, `remotion-composition`, `production-qa` |
| `logic` | `logic.approval`, `logic.condition`, `logic.select`, `logic.merge`, `logic.text` (`test.mock` only with `ORKESTR_ENABLE_MOCK=1`) | `production-qa` (gates), `cost-optimizer` (approvals) |
| (adapters/registry) | `ffmpeg`, `remotion`, `whisper`, `playwright`, `elevenlabs`, `claude`, `photocraft`, `filmcraft`, `soundcraft`, `effectcraft`, `anicraft`, `vectorcraft` | `tool-discovery` |

Templates (`templates/*.json`: Cinematic Commercial, Product Demo, Social Reel, Explainer Video) are described in `.claude/skills/creative-director/templates.md`.

## Ground rules shared by all skills
1. Discover before you promise: only `ready` capabilities are usable; unavailable nodes stay unavailable.
2. Never invent prices, balances, claims, or generated media; placeholders are labelled (draft banner).
3. Paid steps need approval; unknown prices always ask; humans approve pronunciation, captions and final cuts.
4. API is localhost-only; the web app and the worker must both run (`npm run dev`, or `npm run start`).
