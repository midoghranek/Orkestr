import { continueRender, delayRender, staticFile } from "remotion";

export const FONT_FAMILY = "Plex Arabic";
let loaded: Promise<void> | null = null;

/** Load IBM Plex Sans Arabic (SIL OFL, bundled in remotion/public/fonts) before the first frame renders. */
export function ensureFonts(): void {
  if (loaded || typeof document === "undefined") return;
  const handle = delayRender("Loading IBM Plex Sans Arabic");
  const faces = [
    new FontFace(FONT_FAMILY, `url(${staticFile("fonts/IBMPlexSansArabic-Regular.woff")}) format("woff")`, { weight: "400" }),
    new FontFace(FONT_FAMILY, `url(${staticFile("fonts/IBMPlexSansArabic-Bold.woff")}) format("woff")`, { weight: "700" }),
  ];
  loaded = Promise.all(faces.map((f) => f.load()))
    .then((fs) => fs.forEach((f) => document.fonts.add(f)))
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
}
