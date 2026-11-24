/** Small colour helpers so every composition derives its look from the brand palette (no hard-coded brand colours). */
import type { Palette } from "./schema";

type RGB = [number, number, number];

export function parseColor(input: string): RGB {
  const s = input.trim();
  const hex = s.replace(/^#/, "");
  if (/^[0-9a-f]{3,4}$/i.test(hex) && s.startsWith("#")) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) && (s.startsWith("#") || hex.length >= 6)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [0, 0, 0];
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear mix: t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
export const lighten = (c: string, t: number) => mix(c, "#ffffff", t);
export const darken = (c: string, t: number) => mix(c, "#000000", t);

export function alpha(c: string, a: number): string {
  const [r, g, b] = parseColor(c);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

export function luminance(c: string): number {
  const lin = parseColor(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const isDark = (c: string) => luminance(c) < 0.4;

/** First candidate with WCAG >= min on `bg`; otherwise the best-contrast candidate, falling back to black/white. */
export function readableOn(bg: string, candidates: string[], min = 4.5): string {
  const pool = [...candidates, "#ffffff", "#111111"];
  for (const c of pool) if (contrast(c, bg) >= min) return c;
  return pool.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best), pool[0]);
}

/** Text colours for the three fills a composition uses. Palette order of preference is kept when it already passes. */
export function textColors(p: Palette) {
  return {
    onSurface: readableOn(p.surface, [p.onSurface, p.bg, p.fg]),
    onBg: readableOn(p.bg, [p.fg, p.surface, p.onSurface]),
    onAccent: readableOn(p.accent, [p.onSurface, p.fg, p.bg, p.surface]),
  };
}

/** Accent tint usable as text on `bg` (kickers, rules): nudged lighter/darker until it reads at >= min contrast. */
export function accentOn(accent: string, bg: string, min = 3.2): string {
  if (contrast(accent, bg) >= min) return accent;
  const towardsLight = isDark(bg);
  for (let t = 0.1; t <= 1; t += 0.1) {
    const c = towardsLight ? lighten(accent, t) : darken(accent, t);
    if (contrast(c, bg) >= min) return c;
  }
  return readableOn(bg, [accent]);
}
