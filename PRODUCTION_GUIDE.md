# Production guide

## Pipeline

`Brief → Script → Storyboard → References → Scene visuals → Animation/VFX → Voiceover + sound → Composition →
Subtitles → Render → QA → Approval → Export`

1. **Project.** Create it, then fill *Brand & facts*: brand name, how it is pronounced, language, product URL and
   the **verified claims**. The AI may only use those claims.
2. **Assets.** Upload or import logos (light and dark versions), photography, licensed music and recorded voice
   takes. Imports only come from Settings → import folders.
3. **AI Director.** Write a brief and press Plan. Read the script, the storyboard, the **questions** and the
   **risks**. Accept the plan with a visual pool, logos, music and a voiceover source. That creates the storyboard
   and a validated workflow.
4. **Flow editor.** Inspect or adjust the graph, then press Run. You can set a preauthorized budget so known-price
   paid steps run without asking. Steps with unknown prices always ask.
5. **Render queue.** Approve paid steps and creative gates (voiceover pronunciation, captions, final cut). The
   preview on each gate shows exactly what you are approving.
6. **Storyboard / Preview.** Review scenes, pick versions, and regenerate a single scene. Selective rerun reuses
   everything else.
7. **Export.** The export node copies approved deliverables to `data/exports/<project>/`.

Templates (Flows → New workflow): **Cinematic Commercial**, **Product Demo**, **Social Reel**, **Explainer Video**.
They are editable JSON in `/templates`.

Consistency: brand palette, typeface and logos are enforced by the compositions. Visual consistency between
generated shots would need provider seeds and reference images, but no generator is available here. Nothing about
consistency is promised beyond what the compositions enforce.

---

## Acceptance project: kafeeh

*Kafeeh* is an Arabic-first café POS for Egypt. In narration the brand is pronounced «كافيه». The campaign line
is «كافيهك تحت سيطرتك». Set it up with `npm run seed:kafeeh`.

### Inputs (all real)

- **Logos.** The official Kafeeh lockups (Arabic horizontal light/reversed, signature, mark) and the OG card,
  from `CafeOS/apps/design/brand/kafeeh`.
- **Photography.** Brand-graded crops from `CafeOS/apps/design/brand/photography`. The brand README states these
  were cut from **generated concept boards**. They are therefore flagged `placeholder` and every cut that uses
  them carries the burned-in banner **"DRAFT · placeholder visuals"**. They are also small (280–895 px wide),
  so they look soft at 1080p.
- **UI.** Live captures of `https://cafeos-app.vercel.app` (desktop 1440×900 @2× and mobile 430×932 @3×,
  `ar-EG`), taken by Playwright. These are the public landing pages; in-app screens need a demo account.
- **Claims.** 19 claims quoted from the live landing copy, including that **no price may be stated** because
  pricing is still being decided.

### AI Director

- Model: `claude-opus-5-5`, through the Claude Code CLI.
- Cost: **$0.1985**, 9,946 tokens in and 5,947 out, recorded in the ledger.
- Plan: "Kafeeh — «كافيهك تحت سيطرتك» · Launch Commercial 32s + Cutdowns", with 6 scenes:
  1. The rush
  2. Kafeeh on an ordinary tablet
  3. Tables & bar ticket
  4. Internet cuts out
  5. End of shift
  6. Free trial + logo
- Deliverables: 32 s 16:9, 15 s 9:16, 12 s 16:9 loop, 10 s 9:16 loop, and posters at 16:9, 9:16 and 4:5.
- Questions the Director raised:
  - Who records the Egyptian Arabic voiceover?
  - Can we get a demo café account for real in-app screens?
- Risks the Director raised:
  - The photos come from generated boards and are low resolution.
  - There is no Arabic TTS.
  - The offline scene needs a device that has already been set up.
  - Whisper `base` is weak on the Egyptian dialect.
  - There is no licensed music.

### Workflow

37 nodes in total:
- 5 desktop + 4 mobile UI captures, 1 brand photo, 2 logos
- 2 Remotion cuts → QA → approval → export
- 2 Remotion loops → seamless crossfade (MP4 + WebM) → QA → approval → export
- 3 Remotion posters → export

The graph validated with zero issues and runs with no paid steps.

### Results (verified with ffprobe + manual frame review)

| Deliverable | Spec (measured) | QA | Status |
| --- | --- | --- | --- |
| Commercial 16:9 | 1920×1080, 30 fps, 32.04 s, H.264 yuv420p, AAC 48 kHz stereo (silent) | PASS (loudness minor: silent) | rendered; **final approval pending (yours)** |
| Social cut 9:16 | 1080×1920, 30 fps, 15.06 s, H.264 yuv420p, AAC (silent) | PASS (loudness minor) | rendered; approval pending |
| Desktop homepage loop | 1920×1080, 30 fps, 12.0 s, muted MP4 + WebM (VP9), seamless crossfade | PASS | rendered; approval pending |
| Mobile homepage loop | 1080×1920, 30 fps, 10.0 s, muted MP4 + WebM | PASS | rendered; approval pending |
| Poster 16:9 / 9:16 / 4:5 | 1920×1080 / 1080×1920 / 1080×1350 PNG | — | **exported** |
| Subtitles | — | — | blocked: there is no voiceover to transcribe |
| Editable compositions | the `composition.json` props of each render, plus `/remotion` sources | — | produced by every render from now on |

The finished files are in the Asset Library (Preview tab). Approving the four gates in the Render Queue copies
them to `data/exports/kafeeh/`. Creative approval is deliberately left to a human.

### Manual review notes

- RTL Arabic typography (IBM Plex Sans Arabic), the brand palette, the official lockups and the end card render
  correctly at 16:9 and 9:16.
- The live site's product mockup still contains the old **"CafeOS"** wordmark (visible in the end-of-shift and
  offline UI scenes). Fix it on the site, then rerun the capture nodes; the cache re-renders only what changed.
- The corner logo has low contrast over bright areas of the hero photo.
- Scenes 3–5 show landing-page sections that illustrate the claim, not the exact in-app screen (offline queue,
  shift close). A demo account plus scripted Playwright navigation would fix this.

### Blockers and what unlocks them

| Blocker | Unlock |
| --- | --- |
| Egyptian Arabic voiceover | Add an ElevenLabs API key (Settings → Credentials) and a voice id, or import a human recording. The plan already includes pronunciation and caption review gates. |
| Authentic Egyptian café footage | Shoot or license footage and import it. Alternatively, add a video-generation provider adapter + key (Runway/fal/Higgsfield) and approve the spend. |
| Music | Import a licensed track. |
| Real in-app screens | A demo café account and an in-app capture flow. |
| Sharper photos | Real photography, or install Real-ESRGAN for an upscale adapter. |

Once a voiceover exists, rerun from the Director accept step with `voiceover: elevenlabs | asset`. The engine
reuses every capture and only re-renders the cuts. Captions come from whisper `small`/`medium` and must be proofread.
