---
name: creative-director
description: Turns a brief into a validated Orkestr production plan (script, storyboard, shot list) with the AI Director, reviews its questions and risks, and accepts it into an executable workflow graph. Use when the user gives a campaign/video/poster brief, asks to "plan", "storyboard", or "start a project" in Orkestr.
---

# Creative Director

Operates the Orkestr AI Director over the local HTTP API (`http://127.0.0.1:4317`, loopback only; requests with a non-loopback Host or a foreign Origin are rejected with 403). The Director only proposes; Orkestr validates the plan with `DirectorPlanSchema` (`src/shared/schema.ts`) and `planToGraph` builds the graph deterministically.

## Triggers
- "Make a commercial / reel / explainer / loop / poster for X", "plan this brief", "storyboard", "accept the plan".
- Starting a new project, or re-planning after the brief, claims or tool availability changed.
- Not for: executing a workflow (use `cost-optimizer` before `POST /api/workflows/{id}/run`), tuning a single node.

## Inputs
- Project: `GET /api/projects` (id or slug). Create with `POST /api/projects` `{name, slug?, description?, brief?, budgetUsd?, settings}`.
- `settings` (ProjectSettingsSchema): `productUrl`, `brandName`, `brandPronunciation`, `language`, `palette`, `verifiedClaims[]` (max 60), `brandNotes`, `voiceId`. Anything not in `verifiedClaims` must never be claimed.
- Library assets (logos, photos) already imported: `GET /api/assets?projectId=`. Import via `POST /api/projects/{id}/assets/import` (`{paths[], label?, note?}`; paths must sit under Settings `importRoots`) or multipart `.../assets/upload`.
- Brief text, 10-8000 chars. Example in `brief-example.md`; templates guidance in `templates.md`.

## Outputs
- A plan row: `plan` = `{title, logline, language, audience, tone, deliverables[{name, aspect, durationS}], script, scenes[], voiceover{needed, language, direction}, music, questions[<=5], risks[<=10]}`; each scene has `title, durationS, narration, onScreenText, prompt, camera, constraints, references, visualSource, tool`.
- After accept: `{workflowId, notes[], issues[]}` - a stored workflow plus a storyboard (`GET /api/projects/{id}/scenes`).

## Steps
1. **Preflight.** `GET /api/system` - confirm `worker.alive` (plans are processed by the worker; start `npm run dev` or `npm run worker` if not) and read ready capabilities (see `tool-discovery`). Confirm `claude.plan` is ready.
2. **Check project facts.** `verifiedClaims` populated? `brandPronunciation` set for Arabic brands? `productUrl` present if real UI is wanted? Fill via `PATCH /api/projects/{id}` with `{settings:{...}}` (merged).
3. **Queue the plan.** `POST /api/projects/{id}/plans` body `{"brief": "..."}` returns `{planId}`. This spends Claude CLI tokens (capped by Settings `directorMaxUsd`, default 3; model `directorModel`, default `opus`); cost is recorded from the CLI's `total_cost_usd`. Do not queue repeatedly "to see variations" - each call costs money.
4. **Poll** `GET /api/plans/{planId}` every 5-10 s until `status` is `completed` or `failed` (`queued -> running -> ...`; stale `running` plans are re-queued at worker start). Timeout is 15 min.
5. **Review the plan** against the rules below. Surface `questions` to the user (do not invent answers) and every `risks` entry.
6. **Accept.** `POST /api/plans/{planId}/accept` with the options object (see Examples). Read `notes` (placeholders, missing music/VO) and `issues` (validation errors, `level: "error"` means the workflow needs fixing) and relay both honestly.
7. **Hand off.** `GET /api/workflows/{workflowId}` shows `validation`. Do not run until the user approves cost (`cost-optimizer`).

### Plan review rules (mirror `DIRECTOR_SYSTEM` in `src/server/prompts.ts`)
- Only verified claims; no invented features, prices, numbers, customers. Pricing marked "do not state" stays unstated.
- Only READY tools. Generated image/video/music/SFX are unavailable here; a scene wanting them must be `brand-asset`, `ui-capture`, `motion-graphics`, or an honest `placeholder` with a matching `risks` entry.
- Real product UI comes only from `ui-capture` scenes (Playwright of `productUrl`), never imagined screens.
- Scene `durationS` sum equals the main (first) deliverable's `durationS` within 0.5 s.
- Narration fits scene durations: Egyptian Arabic about 2.3 words/s (a 4 s scene holds about 9 words; a 32 s cut about 70 words).
- Pacing: hook scene at most 2.5 s, later scenes 1.5-6 s (ui-capture up to 7 s), end card 2.5-5 s; on-screen text about 6 words, at most 40 characters a line (32 in Arabic) and 17 characters per second.
- Any digit on screen appears in a verified claim.
- At most 3 questions, only if essential.

### How accept builds the graph (`planToGraph`)
- Main deliverable = `deliverables[0]`. Other deliverables become extra branches that reuse upstream nodes (aspect variants).
- Deliverable kind comes from its **name**: contains "poster"/"still" or `durationS <= 1` -> poster (`image.poster`); contains "loop" -> loop (`production.loop` -> `video.loop`, stills only); otherwise a cut (`production.compose`). Name deliverables accordingly.
- A cut whose duration differs from the main one is built without voiceover/captions (the VO would not fit) and says so in `notes`.
- Every cut/loop gets `production.qa` -> `logic.approval` -> `production.export`; voiceover adds a pronunciation approval, captions add a caption review approval.

## Tool dependencies
`claude.plan` (paid, cost unknown until the call returns), worker process, Playwright (`ui-capture` scenes), ElevenLabs (only if `voiceover.kind = "elevenlabs"`), Whisper (captions), Remotion + FFmpeg (compose/QA).

## Errors & recovery
- `plan.status = failed`: read `error`. `AUTH` -> Claude CLI not logged in; `QUOTA` "budget cap" -> raise `directorMaxUsd` in `PUT /api/settings` (ask first); `INVALID_OUTPUT` -> schema failure, re-queue once, then simplify the brief.
- Plan stuck `queued`: worker is down.
- 400 on plans POST: brief shorter than 10 chars.
- Accept returns `issues` with `unavailable`: a node needs a tool that is not ready - run `tool-discovery`, then re-accept or edit the workflow (`PUT /api/workflows/{id}` with `expectedVersion`).
- `plan not ready` on accept: plan is not `completed`.

## Acceptance criteria
- Plan parsed with no `failed` status; every `visualSource` is producible with a READY tool or is an explicit placeholder with a risk entry.
- Scene durations sum to the main deliverable +-0.5 s; narration word count fits (about 2.3 words/s).
- No claim outside `verifiedClaims`; no price stated unless verified.
- Accept returned a `workflowId`, zero `error` issues (or the user was told each one), and all `notes` were reported.

## Examples
Create plan (PowerShell-safe, JSON from a file):
```
curl.exe -s -H "Content-Type: application/json" -d "{\"brief\":\"20 s 16:9 spot for the fictional Acme Café demo brand ...\"}" http://127.0.0.1:4317/api/projects/acme-cafe/plans
curl.exe -s http://127.0.0.1:4317/api/plans/pln_xxxx
```
Accept body (acme-cafe demo style, no paid voiceover; ids come from `GET /api/assets`):
```json
{
  "imagePool": ["ast_photo1", "ast_photo2", "ast_photo3", "ast_photo4"],
  "logoAssetId": "ast_logo_light",
  "logoReversedAssetId": "ast_logo_dark",
  "voiceover": { "kind": "none" },
  "whisperLanguage": "en",
  "direction": "ltr",
  "palette": { "bg": "#F4EFE4", "fg": "#17140F", "accent": "#FFD23F", "accent2": "#8C6CFF", "surface": "#17140F", "onSurface": "#F4EFE4" }
}
```
With paid VO: `"voiceover": {"kind":"elevenlabs","voiceId":"<from elevenlabs.voices>","modelId":"eleven_multilingual_v2","languageCode":"ar"}` (adds a paid node + approval gates; see `audio-production`). Existing take: `{"kind":"asset","assetId":"ast_..."}`. `musicAssetId` must be a licensed imported track.
