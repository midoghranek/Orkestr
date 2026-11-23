import React from "react";
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ensureFonts, FONT_FAMILY } from "../fonts";
import type { CaptionCue, CommercialProps, CommercialScene, Palette, Visual } from "../schema";

const FADE_S = 0.4;

/** Responsive unit: 1u = 1% of the short side. Keeps typography consistent across 16:9, 9:16 and 1:1. */
function useUnit() {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 100;
}

const VisualLayer: React.FC<{ visual: Visual; durationFrames: number; scrim?: number }> = ({ visual, durationFrames, scrim = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = visual.kenBurns && visual.type === "image" ? interpolate(frame, [0, durationFrames], [1.0, 1.08], { extrapolateRight: "clamp" }) : 1;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: visual.fit, transform: `scale(${zoom})` };
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      {visual.type === "video" ? (
        <OffthreadVideo src={visual.src} muted style={style} startFrom={Math.round(visual.startFromS * fps)} />
      ) : (
        <Img src={visual.src} style={style} />
      )}
      {scrim > 0 && <AbsoluteFill style={{ background: `linear-gradient(to top, rgba(0,0,0,${scrim}) 0%, rgba(0,0,0,${scrim * 0.35}) 45%, rgba(0,0,0,0) 70%)` }} />}
    </AbsoluteFill>
  );
};

const Reveal: React.FC<{ delay?: number; children: React.ReactNode; distance?: number }> = ({ delay = 0, children, distance = 3 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * distance * u}px)` }}>{children}</div>;
};

const TextBlock: React.FC<{ scene: CommercialScene; palette: Palette; dark: boolean; align: "start" | "center"; size?: number }> = ({ scene, palette, dark, align, size = 1 }) => {
  const u = useUnit();
  const color = dark ? palette.onSurface : palette.fg;
  return (
    <div style={{ textAlign: align, display: "flex", flexDirection: "column", gap: 1.6 * u, maxWidth: "88%" }}>
      {scene.kicker && (
        <Reveal>
          <div style={{ color: palette.accent, fontWeight: 700, fontSize: 3.4 * u * size, letterSpacing: 0.02 }}>{scene.kicker}</div>
        </Reveal>
      )}
      {scene.headline && (
        <Reveal delay={4}>
          <div style={{ color, fontWeight: 700, fontSize: 7.2 * u * size, lineHeight: 1.25, whiteSpace: "pre-line", textShadow: dark ? "0 2px 18px rgba(0,0,0,.35)" : "none" }}>{scene.headline}</div>
        </Reveal>
      )}
      {scene.body && (
        <Reveal delay={9}>
          <div style={{ color, opacity: 0.86, fontWeight: 400, fontSize: 3.6 * u * size, lineHeight: 1.5, whiteSpace: "pre-line" }}>{scene.body}</div>
        </Reveal>
      )}
    </div>
  );
};

const BrowserFrame: React.FC<{ visual: Visual; durationFrames: number; palette: Palette }> = ({ visual, durationFrames, palette }) => {
  const frame = useCurrentFrame();
  const u = useUnit();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const w = portrait ? width * 0.82 : width * 0.7;
  const h = portrait ? height * 0.62 : height * 0.72;
  const scroll = visual.scroll ? interpolate(frame, [0, durationFrames], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateRight: "clamp" }) : 0;
  const lift = spring({ frame, fps: 30, config: { damping: 200 } });
  const isPhone = visual.frame === "phone" || portrait;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: isPhone ? 5 * u : 1.6 * u,
        overflow: "hidden",
        background: "#fff",
        boxShadow: `0 ${3 * u}px ${8 * u}px rgba(26,51,36,.28), 0 0 0 ${0.25 * u}px rgba(26,51,36,.12)`,
        transform: `translateY(${(1 - lift) * 6 * u}px) scale(${0.96 + lift * 0.04})`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {!isPhone && (
        <div style={{ height: 4.2 * u, background: palette.bg, display: "flex", alignItems: "center", gap: 1 * u, padding: `0 ${2 * u}px`, direction: "ltr" }}>
          {["#E0B4A0", "#D9C2A3", "#9BBBA0"].map((c) => (
            <div key={c} style={{ width: 1.3 * u, height: 1.3 * u, borderRadius: "50%", background: c }} />
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {visual.type === "video" ? (
          <OffthreadVideo src={visual.src} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        ) : (
          <Img src={visual.src} style={{ width: "100%", height: visual.scroll ? "auto" : "100%", minHeight: "100%", objectFit: visual.scroll ? undefined : "cover", objectPosition: "top", transform: visual.scroll ? `translateY(calc(${-scroll * 100}% + ${scroll * h}px))` : undefined }} />
        )}
      </div>
    </div>
  );
};

const SceneView: React.FC<{ scene: CommercialScene; props: CommercialProps; durationFrames: number; isFirst: boolean }> = ({ scene, props, durationFrames, isFirst }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const { palette } = props;
  const fadeFrames = Math.round(FADE_S * fps);
  const opacity = isFirst || scene.transition === "none" ? 1 : interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateRight: "clamp" });
  const slide = scene.transition === "slide" && !isFirst ? interpolate(frame, [0, fadeFrames], [6 * u * (props.direction === "rtl" ? -1 : 1), 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 0;
  const pad = 7 * u;
  let body: React.ReactNode;
  switch (scene.layout) {
    case "full-bleed":
      body = (
        <>
          {scene.visual ? <VisualLayer visual={scene.visual} durationFrames={durationFrames} scrim={scene.headline || scene.body ? 0.72 : 0} /> : <AbsoluteFill style={{ background: palette.surface }} />}
          <AbsoluteFill style={{ justifyContent: "flex-end", padding: pad, paddingBottom: pad + 9 * u }}>
            <TextBlock scene={scene} palette={palette} dark align="start" />
          </AbsoluteFill>
        </>
      );
      break;
    case "ui-showcase":
      body = (
        <AbsoluteFill style={{ background: `linear-gradient(160deg, ${palette.bg} 0%, #EADBC4 100%)`, alignItems: "center", justifyContent: "center", gap: 4 * u, flexDirection: "column", padding: pad }}>
          {(scene.headline || scene.kicker) && <TextBlock scene={{ ...scene, body: "" }} palette={palette} dark={false} align="center" size={0.72} />}
          {scene.visual && <BrowserFrame visual={scene.visual} durationFrames={durationFrames} palette={palette} />}
        </AbsoluteFill>
      );
      break;
    case "split":
      body = (
        <AbsoluteFill style={{ flexDirection: props.width > props.height ? "row" : "column", background: palette.bg }}>
          <div style={{ flex: 1, position: "relative" }}>{scene.visual && <VisualLayer visual={scene.visual} durationFrames={durationFrames} />}</div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", padding: pad }}>
            <TextBlock scene={scene} palette={palette} dark={false} align="start" size={0.85} />
          </div>
        </AbsoluteFill>
      );
      break;
    case "end-card": {
      const logo = props.logoReversed ?? props.logo;
      const s = spring({ frame, fps, config: { damping: 200 } });
      body = (
        <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 50% 40%, #234a33 0%, ${palette.surface} 70%)`, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 * u, padding: pad }}>
          {logo && <Img src={logo} style={{ width: props.width > props.height ? 34 * u : 62 * u, opacity: s, transform: `scale(${0.92 + 0.08 * s})` }} />}
          <TextBlock scene={{ ...scene, kicker: scene.kicker }} palette={palette} dark align="center" size={0.8} />
        </AbsoluteFill>
      );
      break;
    }
    case "title":
    default:
      body = (
        <AbsoluteFill style={{ background: palette.surface, justifyContent: "center", padding: pad }}>
          <div style={{ position: "absolute", insetInlineStart: pad, top: pad, width: 10 * u, height: 0.8 * u, background: palette.accent, borderRadius: u }} />
          <TextBlock scene={scene} palette={palette} dark align="start" />
        </AbsoluteFill>
      );
  }
  return <AbsoluteFill style={{ opacity, transform: `translateX(${slide}px)` }}>{body}</AbsoluteFill>;
};

const Captions: React.FC<{ cues: CaptionCue[]; palette: Palette; offsetMs: number }> = ({ cues, palette, offsetMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const t = (frame / fps) * 1000 - offsetMs;
  const cue = cues.find((c) => t >= c.startMs && t < c.endMs);
  if (!cue) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 5 * u, pointerEvents: "none" }}>
      <div style={{ maxWidth: "86%", background: "rgba(26,51,36,.82)", color: palette.onSurface, fontSize: 3.6 * u, fontWeight: 700, lineHeight: 1.45, padding: `${1 * u}px ${2.2 * u}px`, borderRadius: 1.6 * u, textAlign: "center" }}>{cue.text}</div>
    </AbsoluteFill>
  );
};

const Bug: React.FC<{ src: string }> = ({ src }) => {
  const u = useUnit();
  return <Img src={src} style={{ position: "absolute", top: 4 * u, insetInlineEnd: 4 * u, height: 4.2 * u, opacity: 0.92 }} />;
};

export const Commercial: React.FC<CommercialProps> = (props) => {
  ensureFonts();
  const { fps, durationInFrames } = useVideoConfig();
  const u = useUnit();
  const fadeFrames = Math.round(FADE_S * fps);
  let start = 0;
  const placed = props.scenes.map((s) => {
    const len = Math.max(1, Math.round(s.durationS * fps));
    const item = { scene: s, from: start, len };
    start += len;
    return item;
  });
  const musicVol = (f: number) => props.musicVolume * interpolate(f, [0, fps, durationInFrames - fps * 1.5, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ fontFamily: `"${FONT_FAMILY}", system-ui, sans-serif`, direction: props.direction, backgroundColor: props.palette.surface }}>
      {placed.map(({ scene, from, len }, i) => (
        <Sequence key={scene.id} from={from} durationInFrames={len + (i < placed.length - 1 ? fadeFrames : 0)} name={`${scene.id} · ${scene.layout}`}>
          <SceneView scene={scene} props={props} durationFrames={len} isFirst={i === 0} />
          {scene.layout !== "end-card" && scene.layout !== "ui-showcase" && (props.logoReversed ?? props.logo) && <Bug src={(props.logoReversed ?? props.logo)!} />}
          {scene.layout === "ui-showcase" && props.logo && <Bug src={props.logo} />}
        </Sequence>
      ))}
      {props.showCaptions && props.captions.length > 0 && <Captions cues={props.captions} palette={props.palette} offsetMs={props.voiceoverDelayS * 1000} />}
      {props.voiceover && (
        <Sequence from={Math.round(props.voiceoverDelayS * fps)}>
          <Audio src={props.voiceover} volume={props.voiceoverVolume} />
        </Sequence>
      )}
      {props.music && <Audio src={props.music} volume={musicVol} />}
      {props.draftBanner && (
        <div style={{ position: "absolute", top: 0, insetInline: 0, background: "rgba(201,122,85,.94)", color: "#fff", fontSize: 2.2 * u, fontWeight: 700, padding: `${0.6 * u}px 0`, textAlign: "center", letterSpacing: 0.04, direction: "ltr" }}>
          {props.draftBanner}
        </div>
      )}
    </AbsoluteFill>
  );
};
