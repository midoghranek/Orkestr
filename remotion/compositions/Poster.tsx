import React from "react";
import { AbsoluteFill, Img, useVideoConfig } from "remotion";
import { accentOn, alpha, lighten, readableOn } from "../color";
import { ensureFonts, FONT_FAMILY } from "../fonts";
import type { PosterProps } from "../schema";
import { hasArabic, headlineStyle, kickerStyle } from "../typography";

export const Poster: React.FC<PosterProps> = (p) => {
  ensureFonts();
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 100;
  const pal = p.palette;
  const portrait = height > width;
  const k = p.textScale ?? 1;
  const rtl = p.direction === "rtl";
  const text = readableOn(pal.surface, [pal.onSurface, pal.bg]);
  const accent = accentOn(pal.accent, pal.surface);
  const pillText = readableOn(pal.accent, [pal.onSurface, pal.fg, pal.bg, pal.surface]);
  const s = pal.surface;
  return (
    <AbsoluteFill style={{ fontFamily: `"${FONT_FAMILY}", system-ui, sans-serif`, direction: p.direction, background: `radial-gradient(120% 90% at 50% 30%, ${lighten(s, 0.1)} 0%, ${s} 70%)` }}>
      {p.background && <Img src={p.background} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      {p.background && <AbsoluteFill style={{ background: `linear-gradient(to top, ${alpha(s, 0.96)} 0%, ${alpha(s, 0.8)} 38%, ${alpha(s, 0)} 72%)` }} />}
      {p.logo && <Img src={p.logo} style={{ position: "absolute", top: 7 * u, insetInlineStart: 7 * u, height: 9 * u, objectFit: "contain" }} />}
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: 8 * u, gap: 2.4 * u }}>
        <div style={{ width: 9 * u, height: 0.8 * u, borderRadius: u, background: pal.accent }} />
        {p.kicker && <div style={{ color: accent, ...kickerStyle(3.4 * u * k, rtl, p.kicker) }}>{p.kicker}</div>}
        <div style={{ color: text, ...headlineStyle((portrait ? 8.6 : 9) * u * k, rtl, p.headline) }}>{p.headline}</div>
        {p.sub && <div style={{ color: text, opacity: 0.88, fontSize: 3.8 * u * k, lineHeight: 1.45, textWrap: "balance" as React.CSSProperties["textWrap"] }}>{p.sub}</div>}
        {p.cta && (
          <div style={{ alignSelf: "flex-start", marginTop: 2 * u, background: pal.accent, color: pillText, fontWeight: 800, fontSize: 3.6 * u * k, lineHeight: 1.2, padding: `${1.7 * u}px ${5 * u}px`, borderRadius: 999, letterSpacing: !rtl && !hasArabic(p.cta) ? "0.01em" : "normal" }}>{p.cta}</div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
