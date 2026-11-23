# Workflow templates (`templates/*.json`)

Editable JSON, listed by `GET /api/templates`, instantiated by `POST /api/projects/{id}/workflows` with `{name, templateId, vars}`. `"{{var}}"` strings are replaced by typed values; nodes marked `"$each": "<var>"` fan out one `production.import` per asset id. A missing required var throws "template variable ... is required". Templates skip the AI Director plan: use them when the structure is already known; use a plan when the story must be designed.

| Template id | Aspect / length | Use when | Paid? |
|---|---|---|---|
| `cinematic-commercial` | 16:9, about 32 s | Brand commercial with VO, captions, UI capture, brand photos | Yes: `ai.director` (Claude) and `audio.voiceover` (ElevenLabs) |
| `product-demo` | 16:9, 20 s | Honest real-UI walkthrough, no VO | No |
| `social-reel` | 9:16, 15 s | Short vertical cut from existing visuals with punchy lines | No |
| `explainer-video` | 16:9, 24 s, LTR English | English explainer with local scratch narration | `ai.write` only (Claude) |

## Variables
- **cinematic-commercial**: `brief` (text), `productUrl` (url), `heroAssetIds` (assetIds, scene order), `logoAssetId`, `logoReversedAssetId`, `voiceId` (ElevenLabs id from `elevenlabs.voices`), `language` (default `ar`), `slug` (default `commercial`). Graph: brief -> `ai.director`, heroes + `image.capture` -> `production.compose`; `audio.voiceover` -> pronunciation approval -> `audio.transcribe` -> caption approval; QA -> approval -> export; plus a `production.poster_frame` at 2 s. Voiceover model fixed to `eleven_multilingual_v2`.
- **product-demo**: `productUrl`, `title`, `cta`, `logoReversedAssetId`, `locale` (default `ar-EG`), `slug` (default `demo`). Three `image.capture` at scroll 0/900/1800 plus `video.capture` 6 s at scroll 2400; QA with `requireAudio:false`.
- **social-reel**: `visualAssetIds` (4, in order), `line1..line4`, `cta`, `logoReversedAssetId`, `slug` (default `reel`). Silent; QA `requireAudio:false`.
- **explainer-video**: `topic` (facts only), `t1`, `t2`, `t3`, `cta`, `slug` (default `explainer`). `ai.write` -> `audio.tts_local` (FilmCraft, English only) -> `audio.normalize` -> `audio.transcribe` (`en`). Swap the scratch voice for ElevenLabs before release.

## Rules
- Every template ends in `production.qa` -> `logic.approval` -> `production.export`; keep those gates when editing.
- Edit the JSON (or the instantiated workflow via `PUT /api/workflows/{id}`) rather than hand-building graphs from scratch. Validate with `POST /api/workflows/validate` (body = graph) before running.
- Arabic default direction is `rtl`; the explainer is `ltr`. Do not reuse the explainer for Arabic: FilmCraft TTS is English-only.
- Templates carry no verified-claims check: you must supply only verified text in `brief`, `title`, `line1..4`, `cta`.
