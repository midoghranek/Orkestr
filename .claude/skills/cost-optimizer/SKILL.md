---
name: cost-optimizer
description: Controls and minimizes spend in Orkestr - paid-step approvals, preauthorized run budgets, the auto-approve threshold, cache reuse, rerun vs retry, and the cost ledger - without ever inventing prices or balances. Use before running any workflow with a paid node, when asked "how much will this cost", or when reducing cost of iterations.
---

# Cost optimizer

## Triggers
- About to run a workflow containing `ai.director`, `ai.write`, `ai.review`, `audio.voiceover` (the paid nodes).
- "What did this cost", "keep it under $X", "why is it waiting for approval", "redo only one scene cheaply".

## Inputs
- Workflow id; project `budgetUsd`; Settings `autoApproveUnderUsd`, `directorMaxUsd`, `elevenlabsUsdPerChar`; the planned text length for TTS.

## Outputs
- A cost plan (which nodes are paid, estimate or "unknown"), the approvals decided, and ledger totals from `GET /api/costs`.

## Steps
1. **Identify paid nodes.** `GET /api/node-types` -> `paid:true` nodes. Today: `ai.director`, `ai.write`, `ai.review` (Claude CLI, billed to the user's Claude plan/API; price unknown before the call, `total_cost_usd` recorded after) and `audio.voiceover` (ElevenLabs, per character). Everything else (FFmpeg, Remotion, Playwright, Whisper, Craft tools) is free. `POST /api/projects/{id}/plans` is also a paid Claude call, capped per call by `directorMaxUsd` (default 3, range 0.05-20); node-level caps are the `maxBudgetUsd` params (`ai.director` 3, `ai.write` 1, `ai.review` 1).
2. **State estimates honestly.** ElevenLabs: exact characters = length of the text (<= 10,000 per call); USD only if the user set `elevenlabsUsdPerChar`, else "unknown". Claude: unknown until finished. Never quote a price, plan allowance or balance from memory; the only balance Orkestr reads is ElevenLabs characters used/limit in the health message (`GET /api/system` -> registry). Do not call ElevenLabs/Claude to "check".
3. **How approvals work (engine).** Before a paid node runs it computes an estimate and records it in the ledger as `kind: estimate`. It auto-approves only if the estimate is **known** and either (a) `spent + in-flight + estimate <= run.preauthorizedUsd` (run created with `POST /api/workflows/{id}/run` `{"preauthorizedUsd": N}`; 0 = none), or (b) `estimate <= autoApproveUnderUsd` (Settings, default 0 = every paid node needs approval). **Unknown prices always ask** - so Claude nodes and ElevenLabs (without a rate) always create a pending `cost` approval and the run waits (`waiting_approval`). Never raise `autoApproveUnderUsd` or `preauthorizedUsd` without the user explicitly granting a number.
4. **Decide approvals** only on the user's word: `GET /api/approvals?status=pending`, then `POST /api/approvals/{id}` `{"decision":"approved"|"rejected","note":"..."}`. Rejected -> that node fails with `REJECTED` and downstream nodes skip.
5. **Reuse (cache).** Every node has a signature = hash of (engine version, node type, params, input asset bytes via sha256). Same project + same signature + a previous completed result whose files still exist => the node is `completed` with `cached_from`, a `reused` ledger entry with $0. So: keep params and upstream bytes identical; avoid editing text/params of paid nodes unless necessary; put volatile copy in nodes **after** paid ones; do not change an imported asset; keep ElevenLabs `text`, `voiceId`, `modelId`, voice settings and `seed` identical when re-running.
6. **Rerun vs retry.**
   - `POST /api/runs/{id}/retry` `{nodeIds?}`: resets failed/cancelled/skipped nodes **in place** (attempt counter to 0), keeps completed ones. A failed paid node may be charged again if it reaches the provider; its approval may need renewing.
   - `POST /api/runs/{id}/rerun` `{nodeIds:[...]}`: new child run, named nodes bypass the cache (forced), everything else reused. It inherits the parent's `preauthorizedUsd` (spent counter starts fresh). Forcing a paid node costs again; never force `audio.voiceover` or `ai.*` unless the user wants a new take.
   - Auto-retry (<=3 attempts, exponential backoff) applies to retryable errors only; `QUOTA`, `AUTH`, `NOT_CONFIGURED`, `INVALID_INPUT` are not retried.
7. **Cut cost structurally.** Test the pipeline with free nodes first (scratch `audio.tts_local` English, imports, placeholders); put a pronunciation test line before the full VO; one voiceover per script, reuse for all aspect variants of equal length; keep brief short to cap Director tokens; run one plan, not several.
8. **Report spend.** `GET /api/costs?projectId=` or `?runId=` -> `{summary, ledger}`. `summary`: `actualKnownUsd`, `actualUnknownCount` (calls with unknown price, e.g. ElevenLabs characters), `estimateKnownUsd`, `estimateUnknownCount`, `reusedCount` (cache hits), tokens, `byProvider`. Quote the unknowns as unknown and show characters/tokens instead. Compare against the project `budgetUsd` only for known amounts.

## Tool dependencies
Engine + worker; `GET /api/settings`/`PUT /api/settings` (`autoApproveUnderUsd`, `elevenlabsUsdPerChar`) - change settings only with explicit user instruction.

## Errors & recovery
- Run stuck `waiting_approval`: pending approvals (`GET /api/approvals?runId=`); decide them or cancel (`POST /api/runs/{id}/cancel`).
- `QUOTA` from ElevenLabs/Claude cap: not retryable; tell the user; do not retry in a loop.
- Cost shows unknown: expected for token/character billing; never fill in a number.
- Unexpected re-spend: check whether params/inputs changed (new signature) or `forceNodes` was passed.
- Approval "already approved/rejected" error: it was decided already; re-read state.

## Acceptance criteria
- User saw paid nodes and the estimate (or "unknown" + character count) before approval; no paid step ran without an approval row or an explicit preauthorized/auto-approve rule they set.
- Ledger totals reported with unknowns labelled; no invented prices, rates or balances.
- Iterations reused cached nodes (`reusedCount` > 0) wherever inputs were unchanged.

## Examples
Run with a $2 known-price ceiling (will still ask for unknown-price nodes):
`curl.exe -s -H "Content-Type: application/json" -d "{\"preauthorizedUsd\":2}" http://127.0.0.1:4317/api/workflows/wf_xxx/run`
Cheap re-make of one scene: edit that scene's node, run `.../rerun` `{"nodeIds":["scene3"]}`; the VO/captions nodes hit the cache ($0, `reused`).
Statement: "voiceover = 612 characters, price unknown (no plan rate set); approval needed" - not "about $0.18".
