import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { LoopProps } from "../schema";

/**
 * Text-free homepage loop, seamless by construction: image k holds for a segment and dissolves into
 * image k+1 during the segment's last frames; the final segment dissolves back into image 0, and the
 * drift uses a sine with the loop's period, so frame N looks exactly like frame 0.
 */
export const Loop: React.FC<LoopProps> = (p) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const n = p.images.length;
  const seg = durationInFrames / n;
  const xfade = Math.min(seg * 0.4, 36);
  const u = Math.min(width, height) / 100;
  const k = Math.min(n - 1, Math.floor(frame / seg));
  const local = frame - k * seg;
  const mix = n === 1 ? 0 : interpolate(local, [seg - xfade, seg], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const phase = (frame / durationInFrames) * Math.PI * 2;
  const layer = (idx: number, opacity: number) => (
    <AbsoluteFill key={`${idx}-${opacity > 0.5 ? "a" : "b"}`} style={{ opacity }}>
      <Img
        src={p.images[idx]}
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.07 + 0.03 * Math.sin(phase + idx)}) translateX(${1.2 * u * Math.cos(phase + idx)}px)` }}
      />
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ background: p.palette.surface }}>
      {layer(k, 1)}
      {n > 1 && mix > 0 && layer((k + 1) % n, mix)}
      {p.scrim > 0 && <AbsoluteFill style={{ background: `rgba(26,51,36,${p.scrim})` }} />}
      {p.logo && <Img src={p.logo} style={{ position: "absolute", bottom: 5 * u, insetInlineEnd: 5 * u, height: 5 * u, opacity: 0.85 }} />}
    </AbsoluteFill>
  );
};
