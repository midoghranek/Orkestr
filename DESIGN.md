# Orkestr design system — "Call Sheet"

Orkestr is a single-user, local-first production studio: an AI Director plans, a worker runs verified tools, and a
human approves spend and creative checkpoints. People keep it open for hours while renders run. The visual language
is **modern neo-brutalism borrowed from the film set**: the paper call sheet, gaffer-tape labels, clapperboard stripes
and hazard tape. Bold where it guides attention, quiet everywhere else.

## Principles

1. **Ink is structure, colour is meaning.** Outlines and shadows are always ink (`--color-ink`). Colour fills are
   reserved for state (ok / running / waiting / error / paid) and the single signal accent. Never decorate with colour.
2. **One loud thing per view.** The yellow accent marks the primary action, the active nav item, focus-within inputs
   and items that need the user. If two things are yellow, one of them is wrong.
3. **State is never colour-only.** Every status carries an icon *and* a word (`StatusBadge`), every tool health a
   glyph (● ◐ ○) and screen-reader text.
4. **Physical feedback, instant.** Pressables lift 1px on hover and press 3px into their shadow on `:active`
   (`.nb-press`). Cards that navigate lift (`.nb-lift`). 90–160 ms, no easing theatre. `prefers-reduced-motion`
   removes it all.
5. **Dense where operators work, expressive where people arrive.** Display type and big numbers on dashboards and page
   headers; compact 13–14px rows, soft dividers and flat panels inside editors and tables.

## Tokens (`src/app/globals.css` `@theme`)

| Group | Tokens | Notes |
| --- | --- | --- |
| Surfaces | `bg` #f4efe4 paper · `panel` #fffcf5 card · `panel-2` #eae2d1 sunken/hover · `ink` #17140f · `ink-2` · `cream` | Body has a 22px dot grid for paper texture. |
| Rules | `line` #d8cdb8 soft divider · `line-strong` = ink | Use `line` for rows *inside* a card, ink for the card itself. |
| Text | `fg`/`ink` 16:1 · `muted` 7.3:1 · `faint` 5.1:1 | All pass AA on `bg` and `panel`. Never use `faint` on `panel-2` for body text below 14px. |
| Accent | `accent` #ffd23f + `accent-fg` · `link` | Yellow is a *fill*, never a text colour (fails contrast). |
| Semantic text | `ok` `warn` `err` `info` `paid` | AA on paper — use for inline text/icons. |
| Semantic fills | `ok-fill` `warn-fill` `err-fill` `info-fill` `paid-fill`, `mint` `coral` `violet` | Always with ink text (≥11:1). |
| Focus | `focus` #2b4bff | 3px outline, 2px offset. Inside `.on-ink` areas it switches to the accent. |
| Radius | `rounded-ctl` 6px (controls, chips) · `rounded-card` 12px · `rounded-sheet` 16px (dialogs, hero) | Nothing else. Pills/badges may be `rounded-full`. |
| Shadow | `shadow-brut-xs` 2px · `-sm` 3px · `shadow-brut` 4px · `-lg` 6px · `-xl` 10px · `-accent` | Hard offset, zero blur, always ink (or accent on ink). |
| Type | `font-display` Bricolage Grotesque · `font-sans` IBM Plex Sans (+ Plex Sans Arabic) · `font-mono` IBM Plex Mono | Self-hosted via @fontsource; no runtime network. |

### Type scale

| Use | Style |
| --- | --- |
| Page title | `font-display text-[34px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[0.95]` (`PageHeader`) |
| Project title | display 30–36px extrabold |
| Card title | display 17px bold (`CardHeader`) |
| KPI number | display 32px extrabold tabular-nums (`Stat`) |
| Body / rows | Plex Sans 14px; secondary 13px `text-muted`; meta 12px `text-faint` |
| Labels / eyebrows | `.nb-label` — Plex Mono 11px, 600, uppercase, 0.08em tracking |
| Data (timecodes, ids, money) | `font-mono` 11–13px |

Arabic/RTL: any user-authored text gets `dir="auto"`; `[dir=rtl]`/`:lang(ar)` switch to Plex Sans Arabic.

## Elevation ladder

| Level | Treatment | Used for |
| --- | --- | --- |
| 0 | no border | page canvas |
| 1 | 2px ink border, no shadow (`<Card flat>`) | nested panels, list items inside cards, editor side panels |
| 2 | 2px ink + `shadow-brut` | page-level cards, bento tiles |
| 3 | `shadow-brut-lg` | hovered navigable cards, the "needs you" card when it has items |
| 4 | `shadow-brut-xl` | dialogs, sheets |

Do not stack level-2 cards inside level-2 cards.

## Components (`src/components/ui.tsx`)

- `Button` variants: `primary` (yellow, the one main action), `default` (paper), `outline`, `ink` (inverted, for dark
  hero areas), `danger` (coral fill), `ghost` (toolbars). Sizes `sm` 32px · `md` 40px · `lg` 48px. `busy` shows a
  spinner and sets `aria-busy`. `btnCls()` gives the same look to `<Link>`s.
- `IconButton` — 36px square, requires `label`.
- `Card` (+`flat`), `CardHeader` (`eyebrow`, `title`, `sub`, `actions`), `PageHeader` (`eyebrow`, `title`, `sub`,
  `actions`), `Stat` (KPI tile with tone), `Label`, `linkCls` (yellow-underlined text link).
- `StatusBadge` (icon + word + fill), `Pill` (tones default/paid/ok/warn/err/info/accent), `Progress` (chunky bar,
  hazard stripes when indeterminate, `role=progressbar`).
- `Field`, `Input`, `Textarea`, `Select` (custom chevron), `inputCls`. Focus = white fill + yellow offset shadow.
- `Tabs` (segmented, roving tabindex, ←/→ keys), `Dialog` (bottom sheet on phones, centred on ≥sm; Esc, focus trap,
  focus restore), `Sheet` (right drawer), `useOverlay`.
- `Empty` (dashed outline, optional icon disc), `ErrorNote` (`role=alert`), `Notice` (info/warn/ok with icon),
  `Skeleton`, `LoadingRows` — routine loads show skeletons in place, never full-screen loaders.
- `toast()` / `Toaster` — ink-bordered cards with a coloured icon block; `aria-live`; dismissible.
- `Logo` — yellow tile with three "tracks" of different length: parallel jobs being conducted.

## Layout

- **Shell:** ≥md an ink rail (240px) with the active item as a yellow sticker and a worker-status block; <md an ink
  top bar + a 4-item bottom tab bar (64px targets), content padded `pb-20`.
- **Page gutters:** `px-4 sm:px-6 lg:px-8`. Vertical rhythm 24px between blocks (`space-y-6`, `gap-6`).
- **Dashboard:** KPI strip (2 cols phone, 4 desktop) then a 12-col bento: decisions 7 / runs 5 / projects 8 /
  tools 4 / renders 12. Eyebrows number the blocks (01 · Decisions …) like a call sheet.
- **Project:** paper header with breadcrumb, display title, and folder-tab navigation in production order (Overview →
  Director → Storyboard → Flows → Assets → Preview); the active tab joins the canvas. The flow editor collapses the
  title to give the canvas height.
- **Editors** (flow editor, drawers): flat panels, soft dividers, 13px type; side panels become overlay drawers <lg.

## Motion

`nb-press` (90ms), `nb-lift` (120ms), `animate-rise` (160ms, dialogs/toasts), `animate-stripes` (indeterminate
progress), spinner on running badges. Everything is disabled under `prefers-reduced-motion`.

## Accessibility checklist

Skip link, `aria-current` on nav, landmarks (`main`, labelled `nav`s), visible 3px focus everywhere, 40px default
control height (32px minimum in dense toolbars), dialogs trap focus and close on Esc, progress bars expose values,
statuses have text, contrast verified with a script (all text tokens ≥4.5:1 on paper/panel).

## Not in scope / honest limits

- There is no public marketing site, pricing, signup or login in this product (single local user). The dashboard's
  first-run hero carries the product story instead; nothing was invented to fill those slots.
- Light theme only. A dark variant would need a second token set and a separate contrast pass.
- Remotion compositions (rendered video output) keep the brand palettes of each project; this system styles the
  studio UI only.
