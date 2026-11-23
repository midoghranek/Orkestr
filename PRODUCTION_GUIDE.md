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

## Walkthrough: the acme-cafe demo project

*Acme Café* is a **fictional** demo brand with dummy data only. Use it to learn the pipeline end to end without
spending anything. Set it up with `npm run seed:demo` (see `scripts/seed-demo.ts`).

### 1. Seed

- `npm run seed:demo` creates the project `acme-cafe` ("Acme Café (demo)"), budget $0, product URL
  `https://example.com`. It is idempotent: re-running reuses the project and skips files that are already imported.
- **Assets.** Dummy media generated locally with FFmpeg into `data/demo-brand`: two logos (light and dark), four flat
  colour stills standing in for brand photography, a 4 s test-pattern clip and an 8 s test tone standing in for
  music. They are flagged `placeholder`, so every cut that uses them carries the burned-in banner
  **"DRAFT · placeholder visuals"**. Replace them with real footage and licensed music before anything ships.
- **Claims.** Invented "Demo claim: ..." facts, plus a rule that no price, customer number or award may be stated.
  The AI may only use the claims listed on the project.

### 2. Director / plan

- The seed accepts a **hand-written fixture plan**, "Acme Café — Morning ritual (demo)", through the normal accept
  code path. It is not produced by the AI Director. It has 4 scenes (counter, espresso bar, pastry shelf and an end
  card titled «صباحك على مزاجك» to keep RTL coverage) and two deliverables: a 20 s 16:9 spot and a 10 s 9:16 social cut.
- To try the real Director, open the project's **AI Director** tab, edit the brief and press Plan. Read the script,
  the storyboard, the **questions** and the **risks**, then accept with a visual pool, logos, music and a voiceover
  source. Planning uses the Claude Code CLI and records its cost in the ledger.

### 3. Storyboard and flow

- The accepted plan creates the **Storyboard** and a validated workflow graph. Review scenes in Storyboard / Preview;
  inspect or adjust the graph in the flow editor (live validation blocks Run after an invalid edit).
- Unavailable generators are shown in the graph rather than hidden. Nothing is promised that discovery did not verify
  (see `TOOL_ADAPTERS.md`).

### 4. Run

- Press Run in the flow editor. A preauthorized budget lets known-price paid steps run without asking; steps with
  unknown prices always ask. The demo plan uses no paid steps (`voiceover: none`).
- Re-running reuses cached nodes; only changed nodes re-render. Regenerate a single scene with selective rerun.

### 5. Approvals

- The Render Queue lists paid steps and creative gates (voiceover pronunciation, captions, final cut). The preview on
  each gate shows exactly what you are approving. Creative approval is deliberately left to a human.

### 6. QA

- `production.qa` checks resolution, aspect, fps, duration, codec, `yuv420p`, audio stream present and black
  segments. Loudness is flagged *minor* on silent cuts (no voiceover or music available). Extracted frames can also
  go through an advisory AI review. QA is a technical gate: inspect frames yourself before approving.
- Check that the DRAFT banner is present on any cut that uses placeholder visuals.

### 7. Export

- Approving the export gates copies deliverables to `data/exports/acme-cafe/`. Finished files are also in the Asset
  Library (Preview tab).

### Arabic / RTL notes

- RTL layout and Arabic typography (IBM Plex Sans Arabic) are provided by the compositions; the demo's Arabic end card
  «صباحك على مزاجك» is there to exercise them. Set the plan `direction` to `rtl` for Arabic-first projects.
- There is no Arabic TTS in the local tools: FilmCraft TTS is English-only. Arabic voiceover needs an ElevenLabs
  key (Settings → Credentials) and a voice id, or an imported human recording. Pronunciation must be verified by
  listening, and a brand name may need a phonetic respelling.
- Whisper `base` is weak on dialects; use `small`/`medium` and proofread the captions.

### Limitations and what unlocks them

| Limitation | Unlock |
| --- | --- |
| Arabic voiceover | Add an ElevenLabs API key (Settings → Credentials) and a voice id, or import a human recording. Keep the pronunciation and caption review gates. |
| Real footage | Shoot or license footage and import it. Alternatively, add a video-generation provider adapter + key and approve the spend. |
| Music | Import a licensed track. |
| Real in-app screens | A demo account for your product and an in-app capture flow (Playwright captures any http(s) page). |
| Sharper photos | Real photography, or install Real-ESRGAN for an upscale adapter. |

Once a voiceover exists, rerun from the Director accept step with `voiceover: elevenlabs | asset`. The engine reuses
every capture and only re-renders the cuts. Captions come from whisper `small`/`medium` and must be proofread.
