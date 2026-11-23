# Orkestr

**Local-first AI creative production studio.** Ask for a commercial, a social cut, a homepage loop or a poster; an
AI Director plans it, a durable visual workflow engine runs the *verified* tools on your machine, and you review,
approve and export finished assets. AI decides. The workflow engine executes. You stay in control.

- Single user, runs on `127.0.0.1`, no cloud backend. State lives in SQLite + a content-addressed asset store.
- Every tool is wrapped by an adapter that only exposes operations verified on this machine (see
  [TOOL_ADAPTERS.md](TOOL_ADAPTERS.md)). Missing tools are shown as unavailable with the reason — never faked.
- Nothing paid runs without your approval (or a bounded budget you preauthorize). Unknown prices are labelled unknown.

## Quick start

Requirements: Windows 10/11 (macOS/Linux work for everything except the ArtCraft adapters and the automatic
whisper.cpp install), **Node 22.13+** (built with Node 26), FFmpeg/FFprobe on `PATH`.

```bash
npm install
npx playwright install chromium     # real UI captures (free)
npm run discover                    # probe tools, write data/capabilities.json (spends nothing)
npm run dev                         # web UI + worker → http://127.0.0.1:4317
```

`npm run dev` starts two processes with one command: the Next.js studio (UI + local API) and the **worker**, the
only process that executes jobs. Stop with Ctrl+C; running jobs are re-queued and resume on the next start.

Production-style local start:

```bash
npm run build && npm run start      # same two processes, optimized build, still bound to 127.0.0.1
```

Optional, free downloads (from the Settings page or the API):

- Whisper captions: Settings → Whisper models → `base` (142 MB) or `small`/`medium` for Egyptian Arabic.
- Remotion fetches Chrome Headless Shell (~100 MB) on the first render.

Optional, paid providers: Settings → Credentials → ElevenLabs API key (Arabic voiceover). Keys are encrypted at
rest (AES-256-GCM, `data/secret.key`) and never returned by the API.

## The studio

| Screen | What it does |
| --- | --- |
| Dashboard | Worker/tool health, approvals waiting for you, projects, recent runs and renders |
| AI Director | Brief → schema-validated plan (script, storyboard, shot list, risks, questions) → accepted into a storyboard + workflow |
| Flow editor | Typed drag-and-drop DAG (React Flow): live validation, auto-layout, save with version check, run with a preauthorized budget, live node status/progress/previews, logs, retry, selective rerun |
| Storyboard | Scenes with prompts, narration, on-screen text, durations, versions; approve/reject; regenerate a single scene |
| Assets | Library with previews, metadata, provenance, lineage, upload/import |
| Preview | Player with subtitle overlay, scene timeline, audio takes, QA reports, exports |
| Render queue | Approvals (spend + creative), all runs with progress, cancel/retry/rerun, live log |
| Settings | Capability matrix, environment, optional tools, Whisper models, credentials, budgets, import folders |

## Capability matrix (this machine, verified 2026-11-23)

| Tool | Status | Verified operations |
| --- | --- | --- |
| FFmpeg 4.3.1 / FFprobe | ✔ healthy | probe, encode (H.264/VP9), concat, mux/mix (loudnorm), subtitles (mov_text), frames, still→motion, loudnorm, seamless loop, poster frame |
| Remotion 4.0.545 | ✔ healthy | Commercial / Loop / TestCard render (H.264), Poster still |
| whisper.cpp 1.5.5 | ✔ healthy | multilingual transcription with word timestamps → SRT (model `base` installed) |
| Playwright 1.65 (Chromium) | ✔ healthy | real UI screenshot, scroll-recording |
| Claude Code CLI 2.1 | ✔ healthy | AI Director plan, copywriting, frame review — schema-validated JSON, no tools |
| PhotoCraft 0.23 | ✔ healthy | info, convert, resize + photographic grade |
| FilmCraft 0.20 | ⚠ degraded | probe; **TTS English only**; transcription **not in this build** |
| SoundCraft 0.20 | ✔ healthy | info, convert/peak-normalize (**no TTS**) |
| EffectCraft 0.24 | ✔ healthy | render project/template, render frame |
| AniCraft 0.2 | ✔ healthy | render sequence, GIF |
| VectorCraft 0.24 | ✔ healthy | rasterize SVG/PDF |
| ElevenLabs | ✘ unconfigured | TTS (paid) — needs an API key |
| ComfyUI, Runway, fal, Higgsfield | ✘ | no local server / no API key → **no AI image/video/music generation** |
| Blender, Real-ESRGAN, WhisperX, MediaInfo, DaVinci | ✘ | not installed |

`npm run discover` regenerates this from real checks; the Settings page shows the live version.

## First acceptance project: kafeeh

`npm run seed:kafeeh` creates the **kafeeh** project from the real brand system in `../CafeOS` (official logos,
graded photography, the claims on the live landing page) and the brief «كافيهك تحت سيطرتك». See
[PRODUCTION_GUIDE.md](PRODUCTION_GUIDE.md) for what was produced, how it was verified and the remaining blockers.

## Documentation

[ARCHITECTURE](ARCHITECTURE.md) · [WORKFLOW_ENGINE](WORKFLOW_ENGINE.md) · [TOOL_ADAPTERS](TOOL_ADAPTERS.md) ·
[AI_ORCHESTRATION](AI_ORCHESTRATION.md) · [SKILLS](SKILLS.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) ·
[PRODUCTION_GUIDE](PRODUCTION_GUIDE.md)

## Scripts

| Command | |
| --- | --- |
| `npm run dev` / `npm start` | studio + worker |
| `npm run worker` | worker only |
| `npm run discover` | tool discovery + capability matrix |
| `npm run seed:kafeeh` | create/refresh the kafeeh project |
| `npm test` | unit + integration tests (integration tests use real, free local tools) |
| `npm run test:e2e` | Playwright browser tests of the UI (needs `npm run dev`) |
| `npm run typecheck` | TypeScript |
| `npm run remotion:studio` | open the compositions in Remotion Studio |

## Limitations

- No AI image/video/music generation is available on this machine; scenes that would need it use marked
  placeholders (a burned-in “DRAFT · placeholder visuals” banner) until a provider adapter + credential is added.
- Arabic voiceover needs ElevenLabs (or a recorded human take imported as an asset).
- Whisper captions must be proofread; `base` is weak on Egyptian dialect — install `small`/`medium`.
- Single user, single machine. The API trusts any local process that talks to `127.0.0.1` (see SECURITY.md).
- Remotion is free for individuals and small teams; larger companies need a Remotion company licence.
