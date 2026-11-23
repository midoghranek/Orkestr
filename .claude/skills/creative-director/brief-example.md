# Example brief (Acme Café demo project)

Source of truth: `scripts/seed-demo.ts` (`npm run seed:demo`). Everything is fictional dummy data; nothing is downloaded or spent.

- Brand **Acme Café** (fictional), project slug `acme-cafe`, product URL `https://example.com`. Language: English, with one Arabic end-card title «صباحك على مزاجك» to keep RTL coverage.
- Palette: bg `#F4EFE4`, fg/surface `#17140F`, accent `#FFD23F`, accent2 `#8C6CFF`.
- Stills in the library are flat-colour dummy images generated with FFmpeg: placeholders. Replace with real footage before a real campaign, and keep `draftBanner` on until then.
- Verified claims are the invented "Demo claim: ..." strings in `CLAIMS` (fictional coffee shop, counter or phone orders, espresso/filter/pastries menu, open 8:00 to 20:00). Never state prices, customer numbers or awards.

Brief text:

> Make a 20-second 16:9 spot and a 10-second 9:16 social cut for Acme Café (a fictional demo brand).
> Story: the counter opens -> espresso -> pastries -> end card.
> Use only the demo stills and the listed demo claims.

Name the deliverables so `planToGraph` classifies them: "Spot" / "Commercial 16:9" (cut), "Social cut 9:16" (cut), "Homepage loop desktop" (loop), "Poster 4:5" (poster).
