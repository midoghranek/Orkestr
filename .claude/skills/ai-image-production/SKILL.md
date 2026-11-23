---
name: ai-image-production
description: Produces still imagery in Orkestr with what is actually verified - real UI captures (Playwright), photographic grading (PhotoCraft), logo rasterizing (VectorCraft) and Remotion posters - and explains honestly that text-to-image generation is unavailable and how it could be enabled later. Use for posters, stills, UI screenshots, logo prep, or any "generate an image" request.
---

# AI image production (honest edition)

## Triggers
- "Make a poster / hero image / screenshot / social still", "grade these photos", "convert the SVG logo".
- A request for AI image generation, edit, inpaint or upscale (answer: unavailable, offer alternatives).

## Inputs
- Live product URL (for captures), library asset ids (`GET /api/assets?projectId=&kind=image`), SVG/PDF brand artwork under Settings `importRoots`, copy lines that are verified claims.
- Aspect from `ASPECTS`: `16:9` (1920x1080), `9:16` (1080x1920), `1:1` (1080x1080), `4:5` (1080x1350).

## Outputs
- Image assets (PNG/JPG/WebP) in the project library, with provenance (node, params, run). Deliverable posters via `production.export`.

## Steps
1. **Check availability**: `GET /api/node-types`; require `available:true` for the nodes below.
2. **Pick the producible route**:
   - `image.capture` (`playwright.screenshot`): real UI. Params: `url` (required), `width` 320-3840 (1440), `height` (900), `deviceScaleFactor` 1-3 (2), `locale` (`ar-EG`), `fullPage`, `scrollTo` (px), `selector`, `mobile`, `hideSelectors[]` (cookie banners, chat widgets). Use `mobile:true`, 430x932 for 9:16. Capture at several `scrollTo` values for different feature moments.
   - `image.grade` (`photocraft.grade`): input `image`; params `width` (resize), `warming` 0-100 (12), `vibrance` -100..100 (8), `saturation` (-4), `sharpen` (true), `format` png|jpg|webp. Gentle, consistent grade across a set; do not stack grades.
   - `image.rasterize` (`vectorcraft.rasterize`): input `vector` (SVG/PDF) -> PNG, `scale` 0.1-16 (4). Do this once for logos and reuse the asset.
   - `image.poster` (`remotion.still`, composition `Poster`): optional inputs `background`, `logo`; params `aspect` (4:5), `kicker`, `headline` (required), `sub`, `cta`, `direction` rtl|ltr, `palette`, `format` png|jpeg. Layout: full-bleed background, dark gradient from the bottom, logo top-start, text bottom-start.
3. **Import** existing material with `production.import` (`assetId`, or `file` inside `importRoots`). Upload: `POST /api/projects/{id}/assets/upload` (multipart).
4. **Wire**, validate (`POST /api/workflows/validate`), run (see `cost-optimizer`; every node above is free), review the result image yourself, then `production.export`.
5. **Variants**: vary only `aspect`/copy in the poster node; upstream nodes are cache-reused (identical signatures), so only the Remotion still re-renders.

### Not possible now
`image.generate`, `image.edit` (reason: no verified generation provider: no ComfyUI, no fal/Runway/Higgsfield key), `image.upscale` (Real-ESRGAN not installed, no API). These nodes exist but are permanently `available:false`; graphs containing them fail validation with code `unavailable`. Never "simulate" them with stock or invented imagery.

### Enabling generation later
Install/configure a provider (ComfyUI server on 127.0.0.1:8188, or fal/Runway/Higgsfield API key via `PUT /api/credentials/<provider>` `{secret}`), then write a provider adapter per `tool-discovery` (verified, with cost model), and replace the `unavailable("image.generate"...)` entry with a real node. Note: an MCP connector in a chat session is not reachable by the local app. Until then, discovery lists them under `unavailable[]` (`missing` or `present-no-adapter`).

### Reference and consistency guidance (no guarantees)
- Reuse the same graded brand photos, logo asset and palette across deliverables; consistency comes from reusing assets, not from a model.
- If a generator is added later: pass the same reference images and a fixed `seed` where the provider supports it, keep prompts templated, review every output; consistency of faces/products is not guaranteed and each regeneration costs money.
- Photos that are crops of generated concept boards (like the dummy stills in the acme-cafe demo) are placeholders: tag them in `note`, mark scenes `placeholder`, and keep the draft banner on video cuts.

## Tool dependencies
`playwright.screenshot`, `photocraft.grade`, `vectorcraft.rasterize`, `remotion.still` (all free, local); the live product URL must be reachable.

## Errors & recovery
- `INVALID_INPUT` on capture: bad URL/selector or unreachable site; fix and `POST /api/runs/{id}/retry`.
- Blank/cookie-covered capture: add `hideSelectors`, change `scrollTo`, rerun that node only (`POST /api/runs/{id}/rerun` `{nodeIds:["cap1"]}`).
- Arabic text clipped in poster: shorten `headline`; check `direction`.
- Remotion first render slow: bundle + Chrome download once.

## Acceptance criteria
- Every image comes from a real capture, a library asset, or a deterministic render; none claims to be AI-generated.
- Dimensions match the chosen aspect; text is legible and verified-claim-only; logo is not distorted; placeholders are labelled.
- You looked at the output (e.g. via `GET /api/assets/{id}/file`) before declaring it done.

## Examples
Poster graph: `import(bg) -> image.grade -> image.poster(aspect "4:5", headline "صباحك على مزاجك") -> production.export(name "acme-cafe-poster-4x5")`, with `import(logo_rev) -> image.poster.logo`. Template-free nodes: `{"id":"cap1","type":"image.capture","params":{"url":"https://example.com","width":1440,"height":900,"scrollTo":900}}`.
