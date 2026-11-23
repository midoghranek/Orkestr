# Tool adapters

Every external tool is wrapped by an adapter (`src/server/adapters/*`) implementing:

| Method | Contract |
| --- | --- |
| `discover()` | find the binary/package/credential, read its version; registers the executable in the process allowlist |
| `validateConfig()` | static configuration problems (missing key, missing model) |
| `healthCheck()` | a real, **free** smoke action (encode a 0.5 s lavfi clip, launch Chromium, list voices, read the ElevenLabs subscription…) → `healthy · degraded · unavailable · unconfigured`, plus per-capability `ready`/`blocked` reasons |
| `capabilities()` | the operations this adapter verified, with formats, `paid`, cost model and `verifiedBy` |
| `estimateCost(op, params)` | `{ usd, known, basis, unit, quantity }` — `known:false` when the price is not knowable |
| `execute(op, params, ctx)` | does the work in `ctx.workDir`, reports progress through `ctx.progress`, obeys `ctx.signal` |
| progress | `ctx.progress(fraction, message)` (parsed from ffmpeg `-progress`, whisper `-pp`, Remotion `onProgress`) |
| `cancel` | local processes via `AbortSignal`; remote providers may implement `cancel(providerJobId)` |
| `artifacts` | returned in `ExecResult.artifacts` (file, kind, port, metadata); remote providers may implement `artifacts(jobId)` |
| errors | `AdapterError` with a normalized `code` (`NOT_AVAILABLE, NOT_CONFIGURED, AUTH, INVALID_INPUT, TIMEOUT, CANCELLED, RATE_LIMIT, QUOTA, PROVIDER, TOOL_FAILED, INVALID_OUTPUT, UNSUPPORTED`) and `retryable` |

Executables only run through `runAllowed(name, argv)`: `spawn` with an argv array, `shell:false`, NUL checks,
timeouts, output caps, redacted stderr. Only binaries registered by discovery can run.

## Discovery results (2026-11-23, Windows 11, Node 26.13, GTX 1660 SUPER 6 GB, 41 GB free)

### Verified and used

| Adapter | Version | Operations (verified how) | Notes |
| --- | --- | --- | --- |
| `ffmpeg` | 4.3.1 essentials | probe, encode, concat, mux, subtitles, frames, still, loudnorm, loop, poster — `-version`, `-encoders`, lavfi smoke encode | libx264, aac, libvpx-vp9 present |
| `remotion` | 4.0.545 | render (H.264, AAC track always present), still — TestCard smoke render, demo renders | Output is converted to limited-range `yuv420p` (Remotion tags JPEG-frame encodes `yuvj420p`) |
| `whisper` | whisper.cpp 1.5.5 | transcribe → word JSON + SRT — transcribed a FilmCraft TTS clip | Installed to `data/tools/whisper.cpp` (Remotion's Windows build); models from Hugging Face |
| `playwright` | 1.65.1 | screenshot, record — Chromium launch at health check, live page captures | http(s) only, downloads disabled |
| `claude` | Claude Code 2.1.330 | plan, write, review — `claude -p --json-schema` smoke call returned `structured_output` + `total_cost_usd` | `--tools ""`, no MCP, no session persistence |
| `photocraft` | 0.23.1 | info, convert, grade (imageSize, photoFilter, vibrance, unsharpMask) — `run` on a brand photo | commands mirror a typical brand asset build |
| `filmcraft` | 0.20.1 | probe, **tts (en-US only)** — built-in voice narration exported to WAV | `transcribe` blocked: *“speech-to-text is not available in this build (built without the `whisper` feature)”* — verified by running `sequence.transcribe` |
| `soundcraft` | 0.20.1 | info, convert (resample, bit depth, peak normalize) | **no TTS** in its 483-command registry |
| `effectcraft` | 0.24.1 | render (project/template), renderFrame — rendered its default comp | project/template must be under an import folder |
| `anicraft` | 0.2.1 | renderSequence, gif — rendered the sample | adapter only; no node yet |
| `vectorcraft` | 0.24.1 | rasterize (SVG/PDF → PNG) | |

### Checked, not available

| Tool | Finding |
| --- | --- |
| ElevenLabs | adapter implemented (POST `/v1/text-to-speech/{voice}`, GET `/v1/user/subscription` health, GET `/v1/voices`) — **no API key**, so unconfigured. Billing is per character on the user's plan → USD reported as *unknown* with the exact character count unless a rate is set in Settings |
| ComfyUI | no server on 127.0.0.1:8188 |
| Runway, fal.ai, Higgsfield | no API key (MCP connectors in a chat session are not reachable by the local app) |
| Blender, Real-ESRGAN, MediaInfo | not on PATH |
| WhisperX | needs Python (not installed) |
| DaVinci Resolve | not installed |
| Sharp | intentionally not installed (PhotoCraft/ffmpeg cover verified image ops) |

**Consequence:** there is no AI image, video, music or SFX generation on this machine. Those nodes exist in the
palette as unavailable with the reason, and the AI Director is told so — it plans with brand assets, real UI
captures and motion graphics, and marks anything else as a placeholder.

## Adding an adapter

1. Implement `ToolAdapter` in `src/server/adapters/<tool>.ts`. Verify each operation for real before listing it.
2. Register it in `getAdapters()` (`registry.ts`).
3. Add node type(s) in `engine/node-types.ts` that call `call("<tool>.<op>", params)`; set `paid` through the
   capability so the engine gates spending.
4. Add a credential provider in `credentials.ts` if needed, then `npm run discover`.
5. Add an integration test that runs the operation for free (or skips when the tool is missing).
