---
name: tool-discovery
description: Probes which creative tools Orkestr can actually use right now, reads the capability matrix, and never claims an operation that discovery did not verify. Use before planning or running anything, when a node reports "not ready", when installing Whisper models, or when adding a new tool adapter.
---

# Tool discovery

Orkestr only offers operations that an adapter has verified. Discovery is free: it runs local probes and read-only calls (the ElevenLabs health check reads `/v1/user/subscription`; no characters are spent; Claude health uses `--help`, no tokens).

## Triggers
- Start of any session or project; "what can Orkestr do / what is installed".
- A validation issue with code `unavailable`, or a node whose `available` is false.
- User installed or removed a tool (FFmpeg, Craft CLIs, Whisper model, API key) or asks to add a new tool.
- Before the `creative-director` plans, so the Director sees current READY tools.

## Inputs
- Nothing for a read. For Whisper: `model` in `tiny|base|small|medium`.
- For a new adapter: the tool's CLI/API docs and a way to verify it for real.

## Outputs
- Capability matrix: per tool `health.status` (`healthy|degraded|unavailable|unconfigured`), per capability `ready` plus `blockedReason`, plus `unavailable[]` optional tools. Persisted to `data/capabilities.json` and the `tool_registry` table.

## Steps
1. **Read cached state** (cheap, no process spawning): `GET /api/system` returns `{registry, settings, credentials, worker, whisperModels}`. `registry` is null if discovery never ran.
2. **Refresh.** Either `npm run discover` (prints the matrix, writes `data/capabilities.json`) or `POST /api/system/discover`. The API route queues the refresh to the worker when `worker.alive` (returns `{queued:true}`; re-read `GET /api/system` a few seconds later) and runs inline otherwise (returns the registry). The worker owns the executable allowlist it runs with, so prefer a refresh through a live worker after installing tools.
3. **Read the matrix**; treat a capability as usable only if `ready: true`. Registered adapters: `ffmpeg`, `remotion`, `whisper`, `playwright`, `elevenlabs`, `claude`, `photocraft`, `filmcraft`, `soundcraft`, `effectcraft`, `anicraft`, `vectorcraft` (+ `mock` only with `ORKESTR_ENABLE_MOCK=1`, tests only).
4. **Map to nodes**: `GET /api/node-types` lists every node with `capability`, `available`, `unavailableReason`, `paid`, `paramsJsonSchema`, `defaults`. A node is available only if its capability **and** `alsoRequires` are ready (`video.capture` needs `playwright.record` + `ffmpeg.encode`; `production.qa` needs `ffmpeg.probe` + `ffmpeg.frames`).
5. **Report honestly**: quote `blockedReason` and `limitations`; list `unavailable[]` (ComfyUI, Blender, WhisperX, Real-ESRGAN, MediaInfo, DaVinci Resolve, Runway, fal.ai, Higgsfield) as "checked, not available" with their reasons. Some may be `present-no-adapter` (found on the machine but Orkestr has no adapter, so still unusable).

### Facts to remember (from the adapters)
- FilmCraft: `filmcraft.tts` English (en-US) only, robotic voices; `filmcraft.transcribe` is **not available** in this build (compiled without the `whisper` feature; permanently blocked in health). Use `whisper.transcribe`.
- Whisper is whisper.cpp (v1.5.5 Windows x64) with ggml models; the `base` model is weak on Arabic dialects. Free, local CPU.
- ElevenLabs `tts` is paid, per-character, USD unknown unless the plan rate is set in Settings (`elevenlabsUsdPerChar`). Unconfigured until a key exists (`PUT /api/credentials/elevenlabs` `{secret}` or `ELEVENLABS_API_KEY`).
- Claude (`claude.plan|write|review`) is paid; uses the local `claude` CLI; cost recorded from `total_cost_usd`.
- SoundCraft only peak-normalizes (no LUFS, no TTS). EffectCraft and AniCraft need pre-authored project files.
- AniCraft, SoundCraft, `photocraft.info/convert`, `effectcraft.renderFrame`, `filmcraft.probe`, `elevenlabs.voices` exist as capabilities but have **no node type** yet; they cannot be used in a workflow until a node is added.
- Remotion fetches Chrome Headless Shell (free) on first render.

### Installing Whisper models
`POST /api/system/install-whisper` body `{"model":"small"}` (default `base`) starts a free background download of whisper.cpp (Windows only automatic) and `ggml-<model>.bin` from huggingface. Progress arrives as `tools.install` events (`GET /api/events`). Then run discovery. Transcribe defaults to `small` if installed, else the first installed model. For Egyptian Arabic install `small` (minimum) or `medium` (slower, better). Ask before multi-hundred-MB downloads.

### Adding an adapter
1. Read `src/server/adapters/types.ts`: implement `ToolAdapter` (`id`, `name`, `kind`, `discover`, `validateConfig`, `healthCheck`, `capabilities`, `estimateCost`, `execute`, optional `cancel`/`artifacts`).
2. `capabilities()` must list only operations you **ran**: each `CapabilitySpec` needs `id` = `<adapter>.<operation>`, formats, `paid`, `cost` (`free` | `per_unit` with `source`+`asOf` | `unknown`), `verifiedBy` (what you actually executed), `requires`, `limitations`.
3. `healthCheck()` returns `readyCapabilities` and `blocked{capId: reason}`; never spend money in it.
4. `execute` throws `AdapterError(code, ...)` (retryable codes: `TIMEOUT`, `RATE_LIMIT`, `PROVIDER`, `TOOL_FAILED`, `INVALID_OUTPUT`) and writes artifacts into `ctx.workDir`.
5. Register it in the `list` in `getAdapters()` (`registry.ts`); add a node in `src/server/engine/node-types.ts` that names the capability, add tests, run `npm run discover`, `npm run typecheck`, `npm test`.
6. Replace an `unavailable(...)` placeholder node (e.g. `image.generate`) only when a real provider adapter is verified.

## Tool dependencies
`npm run discover`, a running web+worker (`npm run dev`) for the API, `ffmpeg`/`ffprobe` on PATH (or `ORKESTR_FFMPEG`/`ORKESTR_FFPROBE`).

## Errors & recovery
- `registry: null`: run discovery. Stale matrix: re-run; the registry is a snapshot.
- `POST /api/system/discover` returns `queued:true` but nothing changes: worker not consuming; check `worker` in `GET /api/system`.
- FFmpeg missing: no `ffmpeg.*`; install it and re-discover. `ffmpeg.loop` blocked alone means no `libvpx-vp9` (MP4 still works).
- Whisper install fails: HTTP/network error in events; non-Windows needs a manual build and `ORKESTR_WHISPER_DIR`.
- 403 from the API: Host not loopback or foreign Origin; call `127.0.0.1:4317` directly.

## Acceptance criteria
- Every statement about a tool is backed by `ready`, `limitations` or `unavailable` from a discovery result no older than the current task.
- No operation is proposed that is not in the matrix; blocked and `unavailable` items are reported with reasons.
- After installing something, a fresh discovery shows it before any plan relies on it.

## Examples
```
npm run discover
curl.exe -s http://127.0.0.1:4317/api/system
curl.exe -s -X POST http://127.0.0.1:4317/api/system/discover
curl.exe -s -H "Content-Type: application/json" -d "{\"model\":\"small\"}" http://127.0.0.1:4317/api/system/install-whisper
curl.exe -s http://127.0.0.1:4317/api/node-types
```
Reply style: "Ready: ffmpeg x10, remotion render/still, playwright, whisper (base only). Blocked: elevenlabs.tts (no key), filmcraft.transcribe (no whisper feature). Not available: ComfyUI, fal, Runway, Higgsfield."
