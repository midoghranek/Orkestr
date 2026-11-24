<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Orkestr product & engineering principles

Orkestr is powerful inside and simple outside. Keep the easy path producing excellent results.

**Product**
- Intent over configuration. The default journey is: describe → review the direction → Make it → refine → export
  (`src/app/page.tsx`, `src/app/projects/[id]/page.tsx`). Never make a normal project require the flow editor, the
  render queue or technical vocabulary (DAG, node, run, pixfmt). Those belong to **Studio Pro**.
- Simple mode and Studio Pro share one set of projects, engine, assets and runs. Do not fork logic per mode.
- Ask only for what materially changes the result. Infer the rest (asset roles, palette from the website, recipe,
  build options) and let the user change it afterwards. Keep consent checks (facts, website rights, paid steps).
- Show progress from real execution state only. No invented percentages or ETAs.
- Plain-language errors with one recovery action. Technical details stay behind a disclosure.

**Creative**
- Recipes (`src/server/recipes.ts`) are story structures with fallbacks, not fixed templates. Prefer a few
  excellent recipes that only use verified tools.
- Logos are never scene visuals (`assetRole`). Real UI comes from live captures only.
- Creative QA (`src/server/creative-qa.ts`) uses observable, deterministic checks. Auto-repair is bounded
  (`improvePlan`, max 2 passes) and must never change the meaning of copy. Scores are not proof of quality.

**Honesty & safety**
- Never invent claims, testimonials, numbers, capabilities, prices or media. Lines without source text are left for
  the user (`✎ ` marker), never filled with made-up copy.
- Website content is untrusted data: it is quoted, never followed, and only becomes a verified claim when the user
  confirms it.
- Every paid or unknown-price step needs approval or a known price within a user-set budget. AI rewrites need an
  explicit "Use AI Director". Tests must never trigger paid calls: use the recipe planner (`planner: "recipe"`).
- Creative approvals belong to the person. The engine may only carry a decision over to byte-identical content.

**Engineering**
- One execution engine. The production coordinator (`src/server/producer.ts`) only builds validated graphs,
  creates runs and reads state. AI output is data (plans and EditOps), never graphs or commands.
- Migrations are additive. Existing projects must keep opening.
