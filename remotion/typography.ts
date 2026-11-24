import type React from "react";

/** Arabic script check: Arabic/RTL text must never get letter-spacing (it breaks joining). */
export const hasArabic = (s: string) => /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(s);

export interface TypeScale {
  headline: number;
  kicker: number;
  body: number;
  caption: number;
  url: number;
}

/** u = 1% of the short side. headline 9u landscape / 8u portrait, kicker 3u, body 3.6u, caption 4.2u. */
export function typeScale(u: number, portrait: boolean, textScale = 1): TypeScale {
  return {
    headline: (portrait ? 8 : 9) * u * textScale,
    kicker: 3 * u * textScale,
    body: 3.6 * u * textScale,
    caption: 4.2 * u * textScale,
    url: 3.4 * u * textScale,
  };
}

/** Shrink long headlines so they stay within ~2-3 balanced lines. */
export function fitFactor(text: string): number {
  const n = text.replace(/\s+/g, " ").length;
  if (n > 90) return 0.7;
  if (n > 60) return 0.8;
  if (n > 38) return 0.9;
  return 1;
}

export function headlineStyle(size: number, rtl: boolean, text: string): React.CSSProperties {
  const latin = !rtl && !hasArabic(text);
  return {
    fontSize: size * fitFactor(text),
    fontWeight: 800,
    lineHeight: 1.12,
    letterSpacing: latin ? "-0.02em" : "normal",
    textWrap: "balance" as React.CSSProperties["textWrap"],
    whiteSpace: "pre-line",
  };
}

export function kickerStyle(size: number, rtl: boolean, text: string): React.CSSProperties {
  const latin = !rtl && !hasArabic(text);
  return {
    fontSize: size,
    fontWeight: 700,
    lineHeight: 1.3,
    letterSpacing: latin ? "0.12em" : "normal",
    textTransform: latin ? "uppercase" : "none",
  };
}
