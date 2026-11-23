# AI orchestration

**The AI decides creative direction. The workflow engine executes. The user approves.**

## The AI Director

`POST /api/projects/:id/plans {brief}` queues a plan job; the worker runs it (`director.ts`) through the Claude
Code CLI:

```
claude -p <prompt> --output-format json --json-schema <DirectorPlan JSON Schema> --system-prompt <rules>
       --model <settings.directorModel> --tools "" --strict-mcp-config --no-session-persistence
       --max-budget-usd <settings.directorMaxUsd>
```

The prompt contains: the brief, the project (brand, pronunciation, language, product URL, brand notes), the
**verified claims** (the only product facts the model may use), the library assets (id, kind, size, notes) and the
**live capability matrix** (ready tools, and unavailable tools with reasons). System rules: no invented claims; plan
only with ready tools; real UI only from `ui-capture`; durations add up; Egyptian Arabic pacing ≈ 2.3 words/s;
≤3 essential questions; propose only.

The response is validated twice: by the CLI against the JSON Schema and by Orkestr with Zod
(`DirectorPlanSchema`). Invalid output fails the job (retryable). Cost and tokens come from the CLI's
`total_cost_usd`/`usage` and go to the ledger.

The plan holds: title, logline, language, audience, tone, deliverables (name, aspect, duration), script, scenes
(duration, narration, on-screen text, prompt, camera, constraints, references, `visualSource`, tool), voiceover
direction, music, **questions** and **risks**.

## From plan to graph — deterministic

`acceptPlan` stores the scenes as the storyboard and calls `planToGraph`, plain TypeScript, no model:

- `ui-capture` scenes → `image.capture` of the product URL (plus mobile captures for portrait deliverables);
  `brand-asset` → `production.import` from the chosen pool; `motion-graphics` → title layouts;
  `generated-*`/`stock`/`placeholder` → a pool asset flagged as **placeholder** (burned-in DRAFT banner);
- voiceover: an existing take, ElevenLabs (paid + pronunciation approval gate) or none;
  Whisper captions + a proofreading gate when there is a voiceover;
- per deliverable: *cut* → `production.compose` → QA → approval → export; *loop* → `production.loop` →
  `video.loop` (seamless MP4 + WebM) → QA → approval → export; *poster* → `image.poster` → export;
- the graph is validated; issues and notes (e.g. "no licensed music") are returned to the UI.

The model never emits graph JSON, code or shell commands that get executed. Node params are validated by Zod;
nodes can only call capabilities that discovery marked ready.

## Other AI nodes

- `ai.write` — schema-validated copy (`{text}`), context from upstream nodes.
- `ai.review` — the model may *read* the frames copied into a dedicated temp dir (`--tools Read --add-dir`),
  returns `{verdict, summary, issues[]}`. Advisory only; it never approves anything.
- All Claude calls are paid with unknown up-front price → they require approval inside workflows.

## Model abstraction

`ClaudeAdapter.structured({system, prompt, schema, model, maxBudgetUsd})` is the single entry point. Swapping to
the Claude Agent SDK or the Messages API means re-implementing that one method; callers are unaffected.
Default model: `opus` (Settings → Director model).

## Delegation used to build Orkestr

The build itself followed the brief's delegation model: Opus owned architecture, engine, adapters, Director and
the flow editor and reviewed everything; Sonnet sub-agents built the Settings, Render Queue, Storyboard, Asset
Library and Preview pages and the Claude Code skills against written contracts, and their reports were checked
(typecheck, browser and API tests, fixes applied).
