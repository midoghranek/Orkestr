# Architecture

```
 Browser (React 19, React Flow)                     Worker process (tsx worker/index.ts)
 ┌──────────────────────────────┐                   ┌─────────────────────────────────────┐
 │ Dashboard · Director · Flows │  fetch / SSE      │ Engine.tick() every 500 ms          │
 │ Storyboard · Assets · Queue  │ ───────────────►  │  ├ recoverStale()  (crash recovery) │
 └──────────────────────────────┘                   │  ├ advance(run)    (DAG scheduling) │
                ▲                                    │  └ claim()+execute (adapters)       │
                │  Next.js 16 route handlers         │ processPlans()      (AI Director)   │
 ┌──────────────┴───────────────┐   intents         │ runDiscovery()      (every 10 min)  │
 │ src/app/api/** (127.0.0.1)   │ ───────────────►  └──────────────┬──────────────────────┘
 │ guard(): loopback Host,       │   (rows in SQLite)               │ spawn (argv, no shell,
 │ same-origin mutations         │                                  │  allowlisted exes)
 └──────────────┬───────────────┘                                   ▼
                │                         ┌────────────────────────────────────────────┐
                └────────► SQLite (WAL) ◄─┤ Adapters: ffmpeg · remotion · whisper.cpp ·│
                  data/orkestr.db         │ playwright · claude CLI · elevenlabs ·     │
                  data/assets/<project>/  │ photo/film/sound/effect/ani/vectorcraft    │
                  data/work/<run>/<node>/ └────────────────────────────────────────────┘
```

## Processes

- **Web** (`next dev|start -H 127.0.0.1 -p 4317`): UI and a JSON API. It never executes tools. It writes
  *intents* (create run, approve, cancel, queue a plan) to SQLite and reads state back.
- **Worker** (`worker/index.ts`): the only executor. It owns the process allowlist (populated by discovery), the
  scheduler, retries, heartbeats and plan jobs. Because all state is in the DB, killing either process loses nothing:
  on start the worker re-queues jobs whose heartbeat went stale, and re-queues interrupted AI Director plans.
- The two processes share one SQLite file in WAL mode (`node:sqlite`, built into Node — no native addon to compile).
  Writes that need atomicity use `BEGIN IMMEDIATE`; job claims are a conditional `UPDATE … WHERE status='queued'`.

## Modules (`src/server`)

| Module | Responsibility |
| --- | --- |
| `db/` | connection, pragmas, migrations |
| `projects.ts` | projects, workflows (optimistic versioning), storyboard scenes |
| `director.ts` | AI Director prompt, plan jobs and versions, deterministic plan → graph builder |
| `producer.ts` | **Production coordinator** for the creation-first journey: research → plan → direction → produce → review, refinement, restore, recovery, the workspace read model and readiness. Builds validated graphs and creates runs; it never executes tools |
| `recipes.ts` | Smart recipes (story beats, deliverables, fallbacks), the intent classifier and the free deterministic planner |
| `creative-qa.ts` | Deterministic creative checks on plans (hook, pacing, reading speed, end card, unconfirmed numbers, contrast) and bounded auto-repair |
| `edits.ts` | The EditOp vocabulary: a natural-language parser plus a pure `applyEdits` |
| `engine/validate.ts` | graph schema, port typing, cycles, required inputs, capability availability |
| `engine/node-types.ts` | every node type: ports, Zod params, capability, executor |
| `engine/engine.ts` | runs, scheduling, cache, approvals, retries, recovery, cancellation, lineage |
| `adapters/*` | tool adapters + registry/discovery |
| `assets.ts` | content-addressed storage, ffprobe facts, provenance, lineage |
| `costs.ts` | cost ledger (estimates, actuals, reuse, tokens) |
| `qa.ts` | technical QA (ffprobe + EBU R128 + black frames + subtitle checks) |
| `credentials.ts`, `settings.ts` | encrypted secrets, budgets/defaults |
| `events.ts` | durable event log (progress, logs) tailed by SSE |
| `http.ts`, `views.ts` | route guard/error mapping, read models |

`remotion/` holds the React compositions (Commercial, Poster, Loop, TestCard) and their Zod prop schemas, shared
with the production nodes. `templates/` holds editable workflow templates. `.claude/skills/` holds the Claude Code
skills that let an agent operate the studio.

## Creation-first layer

```
 "What do you want to create?" ──POST /api/create──► producer.startCreation
        │  (worker tick: processProductions, every 1 s, idempotent)
        ▼
 researching ─ web.inspect run (Playwright: brand, colours, headings, CTA, logo, hero)
        ▼
 planning ─── AI Director plan job (recipe constraints)  │ or recipe planner (free, instant)
        ▼          └─ improvePlan(): creative QA + bounded repair → new plan version
 direction ── user edits lines inline, confirms facts and website rights, picks a voice
        ▼  POST /api/productions/:id/produce → autoBuildOptions (asset roles) → planToGraph → createRun
 producing ── same engine, real stage progress, approvals inline
        ▼
 done ─────── refine (EditOps → new version → same workflow → cache reuse) · restore · recover
```

Productions live in the `productions` table (migration v2, additive). Plans are versioned: `parent_plan_id` plus a
`source` of ai, recipe, qa, edit or restore. Asset **roles** (`metadata.role`, or inferred by `assetRole`) replace
manual picking of the visual pool, logo, music and voice.

## Data model

`productions` · `projects` · `workflows` (graph JSON + version) · `runs` (graph snapshot, budget, status) · `node_runs` (status,
attempt, signature, outputs, estimate, cost, heartbeat) · `assets` (sha256, media facts, parents, provenance,
scene, version) · `approvals` (cost/creative) · `cost_ledger` · `scenes` · `plans` · `events` · `settings` ·
`credentials` · `tool_registry`.

A run stores a **snapshot** of the graph, so editing a workflow never changes a run in flight.

## Decisions

- **Drizzle → raw `node:sqlite`.** The brief recommended Drizzle + SQLite. Drizzle has no driver for Node's
  built-in `node:sqlite`, and `better-sqlite3` needs a native build (no prebuilt for Node 26 here, no Python/MSVC).
  A small typed repository layer over `node:sqlite` avoids native compilation entirely.
- **Job queue = SQLite.** Durable, inspectable, transactional with the rest of the state; no Redis.
- **SSE over the events table** instead of in-memory pub/sub, so the web process sees worker progress.
- **AI via the Claude Code CLI** (`claude -p --json-schema --tools ""`): uses the user's existing login, gives
  structured output with real `total_cost_usd`, and the model has no tools — its output is data, never code.
- **Remotion for composition, FFmpeg for encode/validate**, no custom NLE.
- **shadcn/ui** was not installed; the studio uses a small set of hand-written primitives (`src/components/ui.tsx`)
  on Tailwind v4 tokens to keep the dependency surface small.
