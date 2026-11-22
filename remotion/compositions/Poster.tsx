import React from "react";
import { AbsoluteFill, Img, useVideoConfig } from "remotion";
import { ensureFonts, FONT_FAMILY } from "../fonts";
import type { PosterProps } from "../schema";

export const Poster: React.FC<PosterProps> = (p) => {
  ensureFonts();
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 100;
  const pal = p.palette;
  return (
    <AbsoluteFill style={{ fontFamily: `"${FONT_FAMILY}", system-ui, sans-serif`, direction: p.direction, background: pal.surface }}>
      {p.background && <Img src={p.background} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(26,51,36,.96) 0%, rgba(26,51,36,.78) 38%, rgba(26,51,36,0) 70%)" }} />
      {p.logo && <Img src={p.logo} style={{ position: "absolute", top: 7 * u, insetInlineStart: 7 * u, height: 9 * u }} />}
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: 8 * u, gap: 2.4 * u }}>
        {p.kicker && <div style={{ color: pal.accent, fontWeight: 700, fontSize: 4.2 * u }}>{p.kicker}</div>}
        <div style={{ color: pal.onSurface, fontWeight: 700, fontSize: 10 * u, lineHeight: 1.2 }}>{p.headline}</div>
        {p.sub && <div style={{ color: pal.onSurface, opacity: 0.88, fontSize: 4.4 * u, lineHeight: 1.5 }}>{p.sub}</div>}
        {p.cta && (
          <div style={{ alignSelf: "flex-start", marginTop: 2 * u, background: pal.accent, color: "#fff", fontWeight: 700, fontSize: 4 * u, padding: `${1.6 * u}px ${4 * u}px`, borderRadius: 2 * u }}>{p.cta}</div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
