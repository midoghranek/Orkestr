# Workflow engine

## Graph

```jsonc
{ "version": 1,
  "nodes": [{ "id": "compose", "type": "production.compose", "params": { "aspect": "16:9" },
              "position": { "x": 0, "y": 0 }, "sceneId": "scn_…", "retry": { "maxAttempts": 3, "backoffMs": 2000 } }],
  "edges": [{ "id": "e1", "source": "scene1", "sourceHandle": "asset", "target": "compose", "targetHandle": "visuals" }] }
```

Ports are typed: `text · json · image · video · audio · subtitle · storyboard · any`. `any` matches everything;
a `storyboard` may feed a `json` input. Inputs may be `multiple` (fan-in, values arrive in edge order) and
`optional` (may be left unconnected).

## Validation (`validate.ts`)

Schema (Zod) → unique ids → known node type → params (each node's Zod schema) → **capability ready on this
machine** → required inputs connected → single-input ports not over-connected → dangling edges, self-loops, bad
port names → port type compatibility → cycles (Kahn) → warnings for isolated nodes. The editor validates live; a
run cannot be created from an invalid graph (HTTP 422 with the issues).

## States

Run: `draft → validating → queued → running ⇄ waiting_approval → completed | failed | cancelled`.
Node: the same plus `pending` (waiting on upstream) and `skipped` (upstream failed, or a condition branch not taken).

## Scheduling (`Engine.tick`)

1. **Recover**: nodes `running` with a heartbeat older than 30 s and not owned by this worker are re-queued (or
   failed when out of attempts). Graceful shutdown re-queues in-flight nodes without consuming an attempt.
2. **Advance** each active run until nothing changes:
   - a `pending` node whose dependencies are all terminal is **skipped** if any dependency failed/cancelled, if
     all its edges are inactive, or if a required input only has inactive edges (failure always propagates; a node
     never runs with silently missing upstream work);
   - built-in `logic.condition` evaluates `path op value` on JSON input (no code) and marks the other branch inactive;
   - `logic.approval` creates a *creative* approval and waits;
   - otherwise the **input signature** is computed:
     `sha256(engineVersion, node type, params, input asset sha256s / value hashes, composition source hash)`;
     a completed node in the same project with the same signature whose output files still exist is **reused**
     (`cached_from`, ledger entry `reused`), unless the run forces that node;
   - **paid** nodes get a cost estimate. They run without asking only if the known estimate fits the run's
     preauthorized budget (spent + in-flight approved + this) or the global auto-approve threshold. Unknown prices
     always ask. Otherwise a *cost* approval is created and the node waits;
   - the node is queued.
3. **Claim** up to `concurrency` queued nodes (atomic conditional update), execute in parallel.

## Execution

Each attempt gets a clean work dir `data/work/<run>/<node>/<attempt>`. The node's executor calls capabilities
through `call("adapter.op", params)`, which refuses anything not ready. Artifacts are hashed and moved into the asset
store with provenance (node, run, attempt, capability, params) and **lineage** (parents = input assets). Costs
reported by adapters go to the ledger; known USD adds to the run's spent total.

Errors are normalized (`AdapterError` codes). Retryable ones (timeouts, provider 5xx, rate limits, tool crashes)
retry with exponential backoff `backoffMs · 2^(attempt-1)` ±20% jitter up to `maxAttempts`. Non-retryable ones
(invalid input, auth, unsupported, rejected) fail immediately.

## Reruns

- **Retry failed** (`POST /api/runs/:id/retry`): in place. Failed/cancelled/skipped nodes and their dependents go
  back to `pending`; completed nodes (e.g. scenes 1–3) are kept. A paid node re-asks for approval.
- **Rerun from node** (`POST /api/runs/:id/rerun {nodeIds}`): a new run of the same graph where the listed nodes
  bypass the cache. Everything else is reused by signature; downstream re-executes only if the forced node's output
  bytes actually changed (deterministic re-renders are reused).
- Changing a node's params changes its signature and therefore every downstream signature (selective invalidation).

## Cancellation

`POST /api/runs/:id/cancel` sets a flag; the worker aborts in-flight adapters through `AbortSignal` (child
processes get SIGTERM, then SIGKILL; Remotion via its cancel signal; Playwright by closing the browser), marks
pending/queued/waiting nodes cancelled, and cancels pending approvals.

## Node families

| Family | Nodes |
| --- | --- |
| AI | `ai.director`, `ai.write`, `ai.review` |
| Image | `image.capture`, `image.grade`, `image.rasterize`, `image.poster`; unavailable: `image.generate`, `image.edit`, `image.upscale` |
| Video | `video.capture`, `video.still`, `video.vfx`, `video.loop`; unavailable: `video.generate`, `video.image_to_video` |
| Audio | `audio.voiceover` (paid), `audio.tts_local`, `audio.normalize`, `audio.transcribe`, `production.mix`; unavailable: `audio.music`, `audio.sfx` |
| Production | `production.import`, `production.compose`, `production.loop`, `production.concat`, `video.encode`, `production.subtitles`, `production.poster_frame`, `production.qa`, `production.export` |
| Logic | `logic.approval`, `logic.condition`, `logic.select`, `logic.merge` (parallel join), `logic.text`; *retry* is a per-node policy (inspector), *parallel branches* are any fan-out |

Unavailable nodes stay visible in the palette with the exact reason, and validation blocks them.
