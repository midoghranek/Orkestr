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
**live capability matrix** (ready tools, and unavailable tools with reasons). The system prompt is
`DIRECTOR_SYSTEM` (see [System prompts](#system-prompts)).

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

## System prompts

All four system prompts live in [`src/server/prompts.ts`](src/server/prompts.ts). Each one is passed as
`--system-prompt` to a `claude -p` call whose answer is validated against a JSON Schema.

| Prompt | Used by | Answer schema | What it covers |
| --- | --- | --- | --- |
| `DIRECTOR_SYSTEM` | AI Director plan (`director.ts`) | `DirectorPlanSchema` | How `planToGraph` reads the plan (deliverable kinds, visual sources, end card), verified claims only, pacing and reading-speed targets, questions and risks |
| `EDIT_SYSTEM` | "Use AI Director" refinements (`producer.ts`) | `EditOpsSchema` | How operations are applied (scene numbering, automatic rebalancing), minimal changes, copy limits, verified claims only |
| `REVIEW_SYSTEM` | `ai.review` node (`claude.ts`) | `{verdict, summary, issues[]}` | What to look for in frames, severity and verdict definitions, report only what is visible |
| `WRITE_SYSTEM` | `ai.write` node (`claude.ts`) | `{text}` | Finished copy only, facts only from the context, language and length |

The prompts share three rules:

- **They explain what happens to the answer.** Most of each prompt describes how the engine renders or applies
  the output, so a plan that follows `DIRECTOR_SYSTEM` should pass creative QA without repairs.
- **Supplied content is data.** Website text, the current plan, upstream context and words inside frames are
  never treated as instructions.
- **No invented content.** Product facts come only from verified claims or the supplied context.

When you change a pacing number in `creative-qa.ts` or a rule in `planToGraph`, update the matching line in
`prompts.ts`. `tests/unit/prompts.test.ts` checks that the guardrails are present and that each prompt stays
under `MAX_SYSTEM_PROMPT_CHARS`: the prompt travels as a command-line argument, and Windows caps a command line
at 32,767 characters.

## Model abstraction

`ClaudeAdapter.structured({system, prompt, schema, model, maxBudgetUsd})` is the single entry point. Swapping to
the Claude Agent SDK or the Messages API means re-implementing that one method; callers are unaffected.
Default model: `opus` (Settings → Director model).

## Delegation used to build Orkestr

The build itself followed the brief's delegation model: Opus owned architecture, engine, adapters, Director and
the flow editor and reviewed everything; Sonnet sub-agents built the Settings, Render Queue, Storyboard, Asset
Library and Preview pages and the Claude Code skills against written contracts, and their reports were checked
(typecheck, browser and API tests, fixes applied).

## Creation-first orchestration

- **Intent → recipe.** `understandIntent` classifies the request with keyword rules and what was supplied (URL,
  photos), then extracts duration, aspect and language. The chosen recipe is passed to the AI Director as
  constraints (`recipeConstraints`): beats, roles, deliverables and motion. The plan schema gains `recipe`, `cta`,
  `style` and a per-scene `role`. All have defaults, so old plans still parse.
- **Free recipe planner.** Without Claude, or with "Quick draft", `recipePlan` builds the plan deterministically.
  Copy comes only from the user's request, confirmed website lines and verified claims. Missing lines are marked
  `✎` and block production until the user writes them.
- **Website content is untrusted.** It enters the Director prompt inside a delimited `<<<WEBSITE … WEBSITE>>>`
  block, with a system rule never to follow instructions in it. Page text is sanitised (control characters and
  markup stripped, lengths capped) inside the adapter. Lines become verified claims only when the user ticks "the
  text above is accurate".
- **Creative QA + bounded improvement.** Every new plan version goes through `improvePlan` (at most 2 passes):
  hook ≤ 2.5 s, scenes 1.5–6 s (UI ≤ 7 s), reading speed ≤ 17 characters per second, narration pace, end card
  ≥ 2.5 s, CTA present, no unproducible sources, numbers on screen confirmed, palette contrast ≥ 4.5:1. Repairs
  only touch timing, line breaks, CTA defaults and unavailable sources, never the meaning of copy.
- **Conversational edits.** `parseInstruction` maps common requests to EditOps for free (length, pace or motion,
  text size, captions, CTA, per-scene text, retime, remove, swap, platform versions). Creative rewrites
  (translation, tone, new copy) return null and need an explicit "Use AI Director". That call asks Claude for
  EditOps only (`EditOpsSchema`), never a full plan or a graph, and its cost goes to the ledger.
- **Selective re-render.** An edit saves a new plan version and rebuilds the same workflow's graph. Unchanged nodes
  keep their signatures and are served from cache. Verified: a style edit re-rendered only the two compositions;
  8 captures and 2 imports were reused.
- **Carried-over approvals.** A creative gate whose input signature matches content the person already approved
  in this project is recorded as "Carried over …". Any change in the bytes asks again. Cost approvals are never
  carried over.
