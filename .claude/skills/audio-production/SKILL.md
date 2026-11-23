---
name: audio-production
description: Produces voiceover, scratch narration, loudness-normalized audio, mixes, and Whisper captions in Orkestr, with the paid ElevenLabs approval and pronunciation gates and honest limits (FilmCraft TTS English-only, no AI music/SFX). Use for narration, Egyptian Arabic voiceover, captions/subtitles, music beds, or audio levels.
---

# Audio production

## Triggers
- "Add voiceover / narration / captions / music", "fix pronunciation of the brand", "normalize loudness", "mix audio under the video".
- Requests for generated music or SFX (unavailable: import licensed tracks instead).

## Inputs
- Script text (from the plan's `scene.narration`, or `logic.text`). Egyptian Arabic pacing about 2.3 words/s; the total word count must fit the cut.
- Project `brandPronunciation` (e.g. the demo project's "Acme Café") and `defaultVoiceId`/`voiceId`.
- ElevenLabs voice id from `elevenlabs.voices` (list is read-only and free, but has no node: query it from the ElevenLabs dashboard or a one-off authenticated call, never invent an id).
- Licensed music file under `importRoots` (import it; keep the licence note in asset `note`).

## Outputs
- Audio assets (`mp3` from ElevenLabs, `wav` from FilmCraft, `m4a`/`wav` from normalize), SRT subtitles + `words.json` from Whisper, mixed MP4.

## Steps
1. **Pick the voice route**
   - **ElevenLabs `audio.voiceover`** (paid, requires key and approval): params `text` (or connect `script`), `voiceId` (falls back to Settings `defaultVoiceId`), `modelId` one of `eleven_multilingual_v2` (default), `eleven_v3`, `eleven_flash_v2_5`, `eleven_turbo_v2_5`, `languageCode` (2 letters, e.g. `ar`), `stability` 0.45, `similarityBoost` 0.8, `style` 0.2, `speed` 0.7-1.2, `seed`. Text max 10,000 chars. Output MP3 44.1 kHz. Cost: per character against the plan; USD is **unknown** unless `elevenlabsUsdPerChar` is set in Settings, so Orkestr shows the exact character count and always asks. Check status first: ElevenLabs is unconfigured until `PUT /api/credentials/elevenlabs`.
   - **FilmCraft `audio.tts_local`**: free scratch track for timing only. English (en-US) only, robotic; cannot voice Arabic. Params `text`, `voice` (`basic-female`), `pace` 0.5-2.
   - Import an approved take: `production.import` with `assetId`.
2. **Pronunciation review gate (mandatory for Arabic).** Always follow `audio.voiceover` with a `logic.approval` ("Listen: Egyptian Arabic pronunciation"; the Director generates it). A human must listen: dialect, brand name, numbers. If the brand is mispronounced, respell phonetically in the script (e.g. write the brand name as it sounds in Arabic letters), change `seed`/`stability`, and re-run that node: this spends money again, so ask first. Use `languageCode: "ar"` and a short test line before the full script when budget is tight.
3. **Loudness**: `audio.normalize` (`ffmpeg.loudnorm`): EBU R128 to -16 LUFS, -1.5 dBTP, LRA 11, `format` m4a|wav. `production.mix` (`ffmpeg.mux`) already loudnorms the mix by default (`loudnorm:true`). Avoid SoundCraft for loudness (peak-normalizes only, and has no node).
4. **Mix** with `production.mix`: inputs `video`, `tracks[]`; params `volumes[]` and `delaysS[]` by track order, `keepVideoAudio` (false), `loudnorm` (true). Typical: VO volume 1.0 delay 0.4 s, music 0.22 (`musicVolume` in compose, which also fades music in/out). For Remotion cuts prefer passing `voiceover`/`music` into `production.compose` (it mixes them itself).
5. **Captions** with `audio.transcribe` (`whisper.transcribe`, free, local): params `language` (`auto` or 2-letter, e.g. `ar`), `model` `tiny|base|small|medium`, `maxChars` 10-80 (42; use 32 for 9:16), `prompt` (<=400 chars of vocabulary: brand spelling, product terms). Model choice: `base` is weak on Arabic dialects; use `small` minimum, `medium` for best Arabic (install via `POST /api/system/install-whisper`, see `tool-discovery`). Defaults to `small` if installed. Outputs `subtitles` (SRT) and `words` (JSON; low-confidence words are logged).
6. **Caption review gate (mandatory).** Whisper output is always proofread by a human (dialect words, brand name, punctuation) via `logic.approval`, then fed to `production.compose.subtitles` (burned in, offset by `voiceoverDelayS`) or `production.subtitles` (soft track).
7. **Music**: `audio.music` and `audio.sfx` are unavailable (no verified provider). Import a licensed track with `production.import` and connect to compose `music`. No music is acceptable; say so.

## Tool dependencies
`elevenlabs.tts` (paid), `filmcraft.tts` (free), `ffmpeg.loudnorm/mux`, `whisper.transcribe` + ffmpeg. `filmcraft.transcribe` is **not** available (build lacks the whisper feature).

## Errors & recovery
- `NOT_CONFIGURED` / node unavailable: no ElevenLabs key; fall back to scratch (English) or an imported VO.
- `AUTH` (401/403): bad key; update the credential. `QUOTA` (402): credits exhausted - not retryable, tell the user. `RATE_LIMIT`, `PROVIDER`: retried automatically (<=3 attempts).
- `INVALID_OUTPUT` (audio < 1 KB): provider returned junk; retry once.
- `whisper model ... not downloaded` (`NOT_CONFIGURED`): install a model.
- Captions drift or overlap: QA reports `subtitle overlaps` / `within duration`; fix SRT or regenerate with different `maxChars`.
- Loudness out of range: re-run `audio.normalize`/mix with `loudnorm:true`.

## Acceptance criteria
- A human listened to every ElevenLabs output and recorded the approval; brand pronounced correctly.
- Integrated loudness within -20 to -12 LUFS (target -16), true peak <= -0.5 dBFS (QA checks).
- Captions proofread; cues in order, inside the duration, <= 84 chars each.
- Music is licensed and imported, or absent; no claim of generated music/SFX.
- Cost shown to the user before any ElevenLabs call (characters = `text.length`).

## Examples
Chain: `logic.text(script) -> audio.voiceover(voiceId, languageCode "ar") -> logic.approval(listen) -> audio.transcribe(language "ar", model "small", prompt "Acme Café صباحك على مزاجك") -> logic.approval(proofread) -> production.compose`.
Check ledger after: `curl.exe -s "http://127.0.0.1:4317/api/costs?runId=run_xxx"` (look for `unit: character`, `known: false`).
