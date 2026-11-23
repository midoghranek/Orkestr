import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { TestCardProps } from "../schema";

/** Minimal composition used by integration tests and the Remotion health smoke render. */
export const TestCard: React.FC<TestCardProps> = ({ label }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const x = interpolate(frame, [0, durationInFrames - 1], [0, width - 40]);
  return (
    <AbsoluteFill style={{ background: "#1A3324", color: "#F7F1E8", fontFamily: "sans-serif", justifyContent: "center", alignItems: "center", fontSize: 42 }}>
      <div>{label}</div>
      <div style={{ position: "absolute", left: x, bottom: 20, width: 40, height: 8, background: "#C97A55" }} />
      <Sequence from={0}>
        <div style={{ position: "absolute", top: 10, left: 10, fontSize: 14 }}>frame {frame}</div>
      </Sequence>
    </AbsoluteFill>
  );
};
