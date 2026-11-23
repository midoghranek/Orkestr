# Testing

```bash
npm run typecheck          # TypeScript, whole repo
npm test                   # unit + integration (vitest)
npm run dev & npm run test:e2e   # Playwright browser tests against the running studio
npx tsx scripts/smoke-remotion.ts  # render TestCard through the real Remotion adapter and ffprobe it
npm run discover           # live capability check (no spend)
```

## Unit (`tests/unit`, deterministic, mock adapter, isolated temp DB per test)

| Area | Covered |
| --- | --- |
| Graph validation | valid DAG, cycles, unknown types, bad ports, dangling edges, self-loops, type mismatch, missing inputs, bad params, unavailable capabilities, malformed graphs/ids, topo order, downstream sets |
| Scheduling | linear propagation with lineage; parallel independent branches (overlap asserted) |
| Retry/recovery | transient failures retried with backoff; max attempts → failure; crashed-worker job recovery; shutdown re-queues instead of cancelling |
| Selective rerun | scene 4 fails → scenes 1–3 kept, dependents skipped → retry runs only scene 4 + dependents |
| Caching | identical inputs reused; forced node re-executes, unchanged downstream reused; param change invalidates downstream |
| Cancellation | running workflow cancels, pending nodes cancelled |
| Authorization | paid step waits, nothing spent before approval; rejection fails branch; preauthorized budget admits only what fits (in-flight spend counted); creative approval gates |
| Logic | condition branches, path/operator evaluation without code |
| Security | path containment (traversal, absolute, NUL, ADS), file-name sanitising, import roots, process allowlist, secret redaction, credential encryption at rest |
| Captions | token → word merging, cue grouping, SRT round-trip, malformed SRT |
| Persistence | partial updates never reset untouched fields (regression for a Zod 4 `.partial()` defaults bug) |

## Integration (`tests/integration`, real local tools, free; each case skips if its tool is missing)

- FFmpeg: encode a lavfi clip, seamless loop, QA facts (resolution, fps, duration); wrong expectations fail QA;
  corrupt media is reported, not crashed on.
- End-to-end engine run with real tools: Playwright capture of a local page → still→motion → encode → technical QA
  (asserts 1920×1080, H.264, `yuv420p`) → Remotion poster (asserts 1080×1350 and lineage) → export; second run is
  100% cache hits.
- Speech: FilmCraft English TTS → whisper.cpp captions (asserts timed cues; see finding below); Arabic text is
  refused by the English-only TTS.

## Browser (`tests/e2e`, Playwright, read-only — never approves or spends)

The suite runs against the `acme-cafe` demo project. Create it with `npm run seed:demo` (dummy data, generated with
FFmpeg, no cost) and keep `npm run dev` running while the tests execute.

Dashboard (worker status, approvals, projects), Settings (verified tools and gaps), project Overview / Storyboard /
Assets / Preview / AI Director for the `acme-cafe` demo project, flow editor (graph renders with >20 nodes, run overlay, unavailable
generators visible, live validation blocks Run after an invalid edit), Render Queue, and API guards (foreign Host,
cross-origin POST, path traversal on exports). No console errors allowed. Screenshots land in
`test-results/screens/`.

## Last results (2026-11-23)

- `npm run typecheck`: clean
- unit: **34/34** passed · integration: **5/5** passed · browser: **6/6** passed
- acceptance run of the bundled templates: all four videos pass technical QA (resolution, aspect, fps, duration, codec, `yuv420p`,
  audio stream present, no black segments); loudness flagged *minor* on the two cuts because they are silent
  (no voiceover/music available). Frames were inspected manually (see PRODUCTION_GUIDE.md).

## Defects found by testing and fixed

| Found by | Defect |
| --- | --- |
| unit | optional-input nodes ran after an upstream failure (now failure always propagates) |
| unit | preauthorized budget let two paid steps through concurrently (in-flight spend now counted) |
| acceptance run | render props with `{$file}` objects failed schema validation (switched to string file refs) |
| acceptance QA | Remotion output was full-range `yuvj420p` (now converted to `yuv420p`) |
| acceptance frame review | every scene visual dropped: Zod 4 `.partial()` applied `visual: null` defaults |
| acceptance frame review | desktop UI captures cropped in 9:16 (portrait deliverables now get real mobile captures) |
| acceptance frame review | DRAFT banner missing on placeholder photos |
| acceptance run | poster render passed a JPEG-only option for PNG |
| cache review | edited compositions would reuse stale renders (composition source hash now in the signature) |
| browser | Director brief empty: PATCH reset fields to defaults (same Zod 4 issue) |
| browser | orphaned approvals counted after deleting a workflow |

## Findings (not bugs)

- whisper.cpp `base` mis-hears FilmCraft's robotic built-in voice ("yom…"); use `small`/`medium` and always
  proofread — the caption review gate exists for this.
