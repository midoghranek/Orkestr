# UX measurements: before / after the creation-first redesign

Measured on 2026-11-24, Windows 11, Node 26.13, GTX 1660 SUPER. The same scenario was used before and after:
**"A 30-second commercial for my café POS app in Egyptian Arabic", with the website kafeeh.com.**

The baseline was measured by reading the code paths and walking them in the browser (Playwright). The "after" numbers come
from a real run through the new UI. Rendering and captures ran locally. One AI Director call ($0.149) happened by
accident during an E2E test; no other paid call was made.

## Interactions to get a first video

| Step | Before (`main`) | After |
| --- | --- | --- |
| Start | Dashboard → **New project** → name → Create (3) | Type the request → **Create** (1 click) |
| Brand / facts | Overview → edit brand, product URL, claims (optional, about 4) | Automatic: the website is inspected for name, colours, headings, CTA and logo |
| Plan | **AI Director** tab → write brief → **Plan**, then wait 1–3 min (2) | Automatic; the free planner takes about 10 s including website research |
| Accept | Visual pool (1 click per image, ~3), logo, reversed logo, music, voice (~5 selects) → **Accept plan** (~9) | 2 confirmations (facts are accurate; the website is mine) → **Make it** (3) |
| Run | **Open workflow →** flow editor → **Run** (2) | Starts automatically |
| Approvals | Render Queue tab → approve each gate (1 nav + 1 per gate) | Inline in the workspace (1 per gate) |
| Watch | Preview tab → choose the composition (2) | Shown in the workspace |
| **Total to production start** | **~16 interactions** across 5 screens, including the flow editor | **4 interactions** on 2 screens, no flow editor |

- That is a **75% reduction** in interactions before production starts. The target was 50%.
- **Creative decisions before generating:**
  - Before: brief, visual pool, logos, music, voice and the graph — at least 6.
  - After: the request plus an optional voice choice. Everything else is inferred and can be changed afterwards.
  - The factual and website-rights confirmations are kept on purpose; they are consent, not creative decisions.
- **Technical vocabulary the default path shows:**
  - Before: workflow, nodes, run, DAG, QA pixfmt/bitrate, tokens in/out.
  - After: none in Simple mode. These remain in Studio Pro.

## Time

| Measure | Result |
| --- | --- |
| Create → direction ready (with website research, free planner) | ≈10 s |
| Create → direction ready (no website, free planner) | < 1 s (synchronous) |
| Create → direction ready (AI Director) | 1–3 min (unchanged; runs in the worker; the page stays usable) |
| Make it → first 30 s 16:9 cut ready for approval (8 live captures, 2 deliverables) | ≈3 min |
| Refinement "make the text easier to read and slow down the animations" | API 1.0 s; all 8 captures and 2 logo imports **reused from cache**, only the 2 compositions re-rendered |
| Home page data (5 API calls) | 8–19 ms each from the API; page populated ≈0.5 s after navigation in dev mode |

## Creative output (same scenario)

Compare `docs/screenshots/before-render-frames.png` (35 s, baseline) with `docs/screenshots/after-render-frames.png`
(30 s, new). One frame was sampled every 3 s and every 2.5 s respectively.

| | Before | After |
| --- | --- | --- |
| Opening | Logo cropped full-bleed for about 12 s | 2 s type hook, then a problem line |
| Product UI | Small (≈70% width), text unreadable, no headline on several scenes | 86%-wide browser frame, crisp 2× capture, headline above every scene |
| Brand | Hard-coded Kafeeh greens leaked into every project | Palette sampled from the website and contrast-checked |
| End card | Multi-line text dumped into one headline | Logo, tagline, CTA pill taken from the site ("ابدأ مجانًا") and URL |
| Honesty | DRAFT banner on every frame (logo treated as a placeholder) | No placeholder needed; logos are never scene visuals |

Remaining weaknesses seen in the new render:
- One scroll capture landed on an embedded video area that renders black. Captures are viewport-based; section-aware capture is a follow-up.
- A logo captured from the website keeps its page background when shown over dark scenes.

## Targets (from the brief)

| Target | Result |
| --- | --- |
| Begin a project within 60 s | Met: typing plus one click; direction in ≈10 s with the free planner |
| No manual workflow editing | Met: the flow editor is never required |
| ≤3 essential creative decisions before generation | Met: 1–2 |
| ≥50% fewer interactions in the core flow | Met: ≈75% to production start |
| Refine one scene without regenerating unrelated work | Met: verified cache reuse |
| Recoverable failures preserve work | Met: website-research failure falls back to planning without it; failed runs "Try again" keeps finished nodes (`retryFailed`) |
| No unauthorized spending | Partly met. Paid nodes still gate on known budget or approval, and AI rewrites need an explicit "Use AI Director". However, one AI Director plan ($0.149) was triggered by an E2E test race (now fixed) |
| No fabricated capabilities | Met: unavailable generators are listed as unavailable, and the recipes use only verified tools |
| No broken existing projects | Met: migration v2 is additive; legacy projects open with a link to their Studio Pro overview |
