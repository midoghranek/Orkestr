import React, { createContext, useContext } from "react";
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { accentOn, alpha, darken, isDark, lighten, mix, readableOn, textColors } from "../color";
import { ensureFonts, FONT_FAMILY } from "../fonts";
import type { CaptionCue, CommercialProps, CommercialScene, Palette, Visual } from "../schema";
import { fitFactor, hasArabic, headlineStyle, kickerStyle, typeScale, type TypeScale } from "../typography";

type Motion = NonNullable<CommercialProps["motion"]>;
const MOTION: Record<Motion, { fadeS: number; stiffness: number; kb: number }> = {
  calm: { fadeS: 0.5, stiffness: 70, kb: 1.05 },
  standard: { fadeS: 0.27, stiffness: 120, kb: 1.08 },
  energetic: { fadeS: 0.18, stiffness: 200, kb: 1.12 },
};

interface Ctx {
  u: number;
  portrait: boolean;
  rtl: boolean;
  ts: TypeScale;
  palette: Palette;
  stiffness: number;
  kb: number;
  captionsOn: boolean;
  textScale: number;
}
const C = createContext<Ctx>(null as unknown as Ctx);
const useCtx = () => useContext(C);

/** Alternating Ken Burns origins per scene index. */
const ORIGINS = ["30% 35%", "70% 65%"];

const VisualLayer: React.FC<{ visual: Visual; durationFrames: number; index: number; scrim?: "bottom" | "even" | null }> = ({ visual, durationFrames, index, scrim = null }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette, kb } = useCtx();
  const zoom = visual.kenBurns && visual.type === "image" ? interpolate(frame, [0, durationFrames], [1.0, kb], { extrapolateRight: "clamp" }) : 1;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: visual.fit, transform: `scale(${zoom})`, transformOrigin: ORIGINS[index % 2] };
  const s = palette.surface;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: darken(s, 0.4) }}>
      {visual.type === "video" ? (
        <OffthreadVideo src={visual.src} muted style={style} startFrom={Math.round(visual.startFromS * fps)} />
      ) : (
        <Img src={visual.src} style={style} />
      )}
      {scrim === "bottom" && <AbsoluteFill style={{ background: `linear-gradient(to top, ${alpha(s, 0.92)} 0%, ${alpha(s, 0.7)} 38%, ${alpha(s, 0.15)} 70%, ${alpha(s, 0)} 100%)` }} />}
      {scrim === "even" && <AbsoluteFill style={{ background: `linear-gradient(to bottom, ${alpha(s, 0.5)} 0%, ${alpha(s, 0.78)} 50%, ${alpha(s, 0.5)} 100%)` }} />}
    </AbsoluteFill>
  );
};

const Reveal: React.FC<{ delay?: number; children: React.ReactNode; distance?: number; style?: React.CSSProperties }> = ({ delay = 0, children, distance = 2.4, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, stiffness } = useCtx();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness, mass: 0.6 } });
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * distance * u}px)`, ...style }}>{children}</div>;
};

const TextBlock: React.FC<{ scene: CommercialScene; color: string; accentColor: string; align: "start" | "center"; size?: number; shadow?: string; maxWidth?: string }> = ({ scene, color, accentColor, align, size = 1, shadow, maxWidth = "88%" }) => {
  const { u, ts, rtl } = useCtx();
  return (
    <div style={{ textAlign: align, display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", gap: 1.6 * u, maxWidth }}>
      {scene.kicker && (
        <Reveal>
          <div style={{ color: accentColor, ...kickerStyle(ts.kicker * size, rtl, scene.kicker) }}>{scene.kicker}</div>
        </Reveal>
      )}
      {scene.headline && (
        <Reveal delay={4}>
          <div style={{ color, textShadow: shadow, ...headlineStyle(ts.headline * size, rtl, scene.headline) }}>{scene.headline}</div>
        </Reveal>
      )}
      {scene.body && (
        <Reveal delay={9}>
          <div style={{ color, opacity: 0.88, fontWeight: 400, fontSize: ts.body * size, lineHeight: 1.5, whiteSpace: "pre-line", textWrap: "balance" as React.CSSProperties["textWrap"] }}>{scene.body}</div>
        </Reveal>
      )}
    </div>
  );
};

/** Statement: big type on the surface, revealed in word groups. Restrained: opacity + small lift, springs only. */
const Statement: React.FC<{ scene: CommercialScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, ts, rtl, palette, stiffness } = useCtx();
  const tc = textColors(palette);
  const accent = accentOn(palette.accent, palette.surface);
  const lines = scene.headline.split("\n").filter((l) => l.trim());
  const words = lines.flatMap((l, li) => l.trim().split(/\s+/).map((w, wi, arr) => ({ w, br: wi === arr.length - 1 && li < lines.length - 1 })));
  const per = words.length <= 5 ? 1 : words.length <= 10 ? 2 : 3;
  const groups: { text: string; br: boolean }[] = [];
  for (let i = 0; i < words.length; i += per) {
    const part = words.slice(i, i + per);
    groups.push({ text: part.map((p) => p.w).join(" "), br: part.some((p) => p.br) });
  }
  const size = ts.headline * 1.12 * fitFactor(scene.headline);
  const rule = spring({ frame, fps, config: { damping: 200, stiffness } });
  const gap = 5; // frames between groups
  const lastIn = 6 + groups.length * gap;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(110% 80% at 50% 38%, ${lighten(palette.surface, 0.1)} 0%, ${palette.surface} 72%)`, justifyContent: "center", alignItems: "center", padding: 9 * u }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 2.4 * u, maxWidth: "90%" }}>
        <div style={{ width: 9 * u, height: 0.8 * u, borderRadius: u, background: palette.accent, transform: `scaleX(${rule})` }} />
        {scene.kicker && (
          <Reveal delay={2}>
            <div style={{ color: accent, ...kickerStyle(ts.kicker, rtl, scene.kicker) }}>{scene.kicker}</div>
          </Reveal>
        )}
        <div style={{ color: tc.onSurface, ...headlineStyle(size, rtl, scene.headline), textAlign: "center" }}>
          {groups.map((g, i) => {
            const s = spring({ frame: frame - (6 + i * gap), fps, config: { damping: 200, stiffness, mass: 0.7 } });
            return (
              <React.Fragment key={i}>
                <span style={{ display: "inline-block", opacity: s, transform: `translateY(${(1 - s) * 1.8 * u}px)` }}>{g.text}</span>
                {g.br ? <br /> : i < groups.length - 1 ? " " : null}
              </React.Fragment>
            );
          })}
        </div>
        {scene.body && (
          <Reveal delay={lastIn + 4}>
            <div style={{ color: tc.onSurface, opacity: 0.85, fontWeight: 400, fontSize: ts.body, lineHeight: 1.5, whiteSpace: "pre-line", textWrap: "balance" as React.CSSProperties["textWrap"], maxWidth: "80%" }}>{scene.body}</div>
          </Reveal>
        )}
      </div>
    </AbsoluteFill>
  );
};

const UiFrame: React.FC<{ visual: Visual; durationFrames: number }> = ({ visual, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, palette, stiffness, kb } = useCtx();
  const scroll = visual.scroll ? interpolate(frame, [0, durationFrames], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateRight: "clamp" }) : 0;
  const lift = spring({ frame, fps, config: { damping: 200, stiffness } });
  const push = interpolate(frame, [0, durationFrames], [1, kb], { extrapolateRight: "clamp" });
  const isPhone = visual.frame === "phone" || portrait;
  const shadowC = darken(palette.fg, 0.55);
  const chrome = mix(palette.bg, palette.fg, 0.08);
  const dot = alpha(palette.fg, 0.28);
  return (
    <div
      style={{
        width: portrait || isPhone ? "70%" : "86%",
        flex: 1,
        minHeight: 0,
        borderRadius: isPhone ? 5.5 * u : 1.6 * u,
        overflow: "hidden",
        background: palette.bg,
        border: isPhone ? `${0.9 * u}px solid ${darken(palette.surface, 0.35)}` : undefined,
        boxShadow: `0 ${2.6 * u}px ${7 * u}px ${alpha(shadowC, 0.3)}, 0 ${0.6 * u}px ${1.6 * u}px ${alpha(shadowC, 0.18)}, 0 0 0 ${0.15 * u}px ${alpha(palette.fg, 0.14)}`,
        transform: `translateY(${(1 - lift) * 5 * u}px) scale(${(0.97 + lift * 0.03) * push})`,
        opacity: lift,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {!isPhone && (
        <div style={{ height: 4 * u, flex: "none", background: chrome, display: "flex", alignItems: "center", gap: 0.9 * u, padding: `0 ${1.8 * u}px`, direction: "ltr", borderBottom: `${0.1 * u}px solid ${alpha(palette.fg, 0.1)}` }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 1.2 * u, height: 1.2 * u, borderRadius: "50%", background: dot }} />
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", background: "#fff" }}>
        {visual.type === "video" ? (
          <OffthreadVideo src={visual.src} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        ) : visual.scroll ? (
          <Img src={visual.src} style={{ position: "absolute", left: 0, width: "100%", height: "auto", minHeight: "100%", objectFit: "cover", objectPosition: "top", top: `${scroll * 100}%`, transform: `translateY(${-scroll * 100}%)` }} />
        ) : (
          <Img src={visual.src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        )}
      </div>
    </div>
  );
};

const EndCard: React.FC<{ scene: CommercialScene; props: CommercialProps; durationFrames: number }> = ({ scene, props, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, ts, rtl, palette, stiffness } = useCtx();
  const tc = textColors(palette);
  const accent = accentOn(palette.accent, palette.surface);
  // Everything is settled and static for the final ~1 s.
  const f = Math.min(frame, Math.max(0, durationFrames - fps));
  const logo = isDark(palette.surface) ? props.logoReversed ?? props.logo : props.logo ?? props.logoReversed;
  const s = spring({ frame, fps, config: { damping: 200, stiffness } });
  const lines = scene.headline.split("\n").filter((l) => l.trim());
  const legacy = lines.length > 1 && !scene.cta && !scene.url;
  const headline = legacy ? lines[0] : scene.headline.replace(/\n+/g, " ");
  const extra = legacy ? lines.slice(1) : [];
  const drift = interpolate(f, [0, Math.max(1, durationFrames - fps)], [34, 44]);
  const pillText = readableOn(palette.accent, [palette.onSurface, palette.fg, palette.bg, palette.surface]);
  const latinUrl = !hasArabic(scene.url);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 50% ${drift}%, ${lighten(palette.surface, 0.12)} 0%, ${palette.surface} 70%)`, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 3.4 * u, padding: 8 * u }}>
      {logo && <Img src={logo} style={{ width: (portrait ? 44 : 28) * u, maxHeight: (portrait ? 26 : 22) * u, objectFit: "contain", opacity: s, transform: `scale(${0.94 + 0.06 * s})` }} />}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.4 * u, textAlign: "center", maxWidth: "90%" }}>
        {scene.kicker && (
          <Reveal delay={3}>
            <div style={{ color: accent, ...kickerStyle(ts.kicker, rtl, scene.kicker) }}>{scene.kicker}</div>
          </Reveal>
        )}
        {headline && (
          <Reveal delay={5}>
            <div style={{ color: tc.onSurface, ...headlineStyle(ts.headline * 0.8, rtl, headline) }}>{headline}</div>
          </Reveal>
        )}
        {[...(scene.body ? [scene.body] : []), ...extra].map((l, i) => (
          <Reveal key={i} delay={9 + i * 2}>
            <div style={{ color: tc.onSurface, opacity: 0.85, fontWeight: 400, fontSize: ts.body, lineHeight: 1.45, whiteSpace: "pre-line" }}>{l}</div>
          </Reveal>
        ))}
      </div>
      {scene.cta && (
        <Reveal delay={12}>
          <div style={{ background: palette.accent, color: pillText, fontWeight: 800, fontSize: ts.body * 1.05, lineHeight: 1.2, padding: `${1.7 * u}px ${5 * u}px`, borderRadius: 999, boxShadow: `0 ${1 * u}px ${3 * u}px ${alpha(darken(palette.surface, 0.5), 0.4)}` }}>{scene.cta}</div>
        </Reveal>
      )}
      {scene.url && (
        <Reveal delay={15}>
          <div style={{ color: tc.onSurface, opacity: 0.8, fontSize: ts.url, fontWeight: 400, letterSpacing: latinUrl ? "0.02em" : "normal", direction: "ltr", unicodeBidi: "isolate" }}>{scene.url}</div>
        </Reveal>
      )}
    </AbsoluteFill>
  );
};

interface SceneViewProps {
  scene: CommercialScene;
  props: CommercialProps;
  durationFrames: number;
  fadeFrames: number;
  index: number;
  nextTransition: CommercialScene["transition"] | null;
}

const SceneView: React.FC<SceneViewProps> = ({ scene, props, durationFrames, fadeFrames, index, nextTransition }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const { u, portrait, palette, captionsOn, ts, rtl } = useCtx();
  const isFirst = index === 0;
  const tc = textColors(palette);
  const p = isFirst || scene.transition === "none" ? 1 : interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  // In RTL the "next" content arrives from the left (inline-end).
  const dir = rtl ? -1 : 1;
  let opacity = 1;
  let tx = 0;
  let clip: string | undefined;
  if (!isFirst) {
    if (scene.transition === "fade") opacity = p;
    if (scene.transition === "slide") {
      opacity = p;
      tx = dir * 6 * u * (1 - p);
    }
    if (scene.transition === "wipe") clip = rtl ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)`;
    if (scene.transition === "push") tx = dir * width * (1 - p);
  }
  if (nextTransition === "push") {
    const out = interpolate(frame, [durationFrames, durationFrames + fadeFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    tx = -dir * width * out;
  }
  const pad = 7 * u;
  const safeBottom = portrait ? 14 * u : 9 * u;
  let body: React.ReactNode;
  switch (scene.layout) {
    case "full-bleed": {
      const hasText = !!(scene.headline || scene.body || scene.kicker);
      const centered = captionsOn;
      const hasVisual = !!scene.visual;
      const txtColor = readableOn(palette.surface, [palette.onSurface, palette.bg], 4.5);
      body = (
        <>
          {scene.visual ? <VisualLayer visual={scene.visual} durationFrames={durationFrames} index={index} scrim={hasText ? (centered ? "even" : "bottom") : null} /> : <AbsoluteFill style={{ background: palette.surface }} />}
          <AbsoluteFill style={{ justifyContent: centered ? "center" : "flex-end", alignItems: centered ? "center" : undefined, padding: pad, paddingBottom: centered ? pad : pad + safeBottom - 5 * u }}>
            <TextBlock scene={scene} color={hasVisual ? txtColor : tc.onSurface} accentColor={accentOn(palette.accent, palette.surface)} align={centered ? "center" : "start"} shadow={hasVisual ? `0 ${0.2 * u}px ${1.6 * u}px ${alpha(palette.surface, 0.5)}` : undefined} />
          </AbsoluteFill>
        </>
      );
      break;
    }
    case "ui-showcase":
      body = (
        <AbsoluteFill style={{ background: `linear-gradient(160deg, ${palette.bg} 0%, ${mix(palette.bg, palette.accent, 0.14)} 100%)`, alignItems: "center", justifyContent: "center", gap: 3 * u, flexDirection: "column", padding: `${4.5 * u}px ${4 * u}px ${captionsOn ? (portrait ? 27 : 19) * u : 4.5 * u}px` }}>
          {(scene.headline || scene.kicker) && <TextBlock scene={{ ...scene, body: "" }} color={tc.onBg} accentColor={accentOn(palette.accent, palette.bg)} align="center" size={0.75} />}
          {scene.visual && <UiFrame visual={scene.visual} durationFrames={durationFrames} />}
        </AbsoluteFill>
      );
      break;
    case "split":
      body = (
        <AbsoluteFill style={{ flexDirection: props.width > props.height ? "row" : "column", background: palette.bg }}>
          <div style={{ flex: 1, position: "relative" }}>{scene.visual && <VisualLayer visual={scene.visual} durationFrames={durationFrames} index={index} />}</div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", padding: pad, paddingBottom: captionsOn && portrait ? safeBottom + 6 * u : pad }}>
            <TextBlock scene={scene} color={tc.onBg} accentColor={accentOn(palette.accent, palette.bg)} align="start" size={0.85} />
          </div>
        </AbsoluteFill>
      );
      break;
    case "statement":
      body = <Statement scene={scene} />;
      break;
    case "end-card":
      body = <EndCard scene={scene} props={props} durationFrames={durationFrames} />;
      break;
    case "title":
    default:
      body = (
        <AbsoluteFill style={{ background: palette.surface, justifyContent: "center", padding: pad }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2.4 * u, alignItems: "flex-start" }}>
            <div style={{ width: 10 * u, height: 0.8 * u, background: palette.accent, borderRadius: u }} />
            <TextBlock scene={scene} color={tc.onSurface} accentColor={accentOn(palette.accent, palette.surface)} align="start" />
          </div>
        </AbsoluteFill>
      );
  }
  void ts;
  return <AbsoluteFill style={{ opacity, transform: `translateX(${tx}px)`, clipPath: clip }}>{body}</AbsoluteFill>;
};

const Captions: React.FC<{ cues: CaptionCue[]; offsetMs: number }> = ({ cues, offsetMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, ts, palette } = useCtx();
  const t = (frame / fps) * 1000 - offsetMs;
  const cue = cues.find((c) => t >= c.startMs && t < c.endMs);
  if (!cue) return null;
  const color = readableOn(palette.surface, [palette.onSurface, palette.bg]);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: (portrait ? 14 : 5) * u, pointerEvents: "none" }}>
      <div style={{ maxWidth: "86%", background: alpha(palette.surface, 0.85), color, fontSize: ts.caption, fontWeight: 700, lineHeight: 1.4, padding: `${1 * u}px ${2.4 * u}px`, borderRadius: 1.6 * u, textAlign: "center", textWrap: "balance" as React.CSSProperties["textWrap"] }}>{cue.text}</div>
    </AbsoluteFill>
  );
};

const Bug: React.FC<{ palette: Palette; props: CommercialProps; layout: CommercialScene["layout"] }> = ({ palette, props, layout }) => {
  const { u } = useCtx();
  const lightBg = layout === "ui-showcase" || layout === "split";
  const fill = lightBg ? palette.bg : palette.surface;
  const src = isDark(fill) ? props.logoReversed ?? props.logo : props.logo ?? props.logoReversed;
  if (!src) return null;
  return <Img src={src} style={{ position: "absolute", top: 4 * u, insetInlineEnd: 4 * u, height: 4.2 * u, opacity: 0.92 }} />;
};

export const Commercial: React.FC<CommercialProps> = (props) => {
  ensureFonts();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const u = Math.min(width, height) / 100;
  const portrait = height > width;
  const m = MOTION[props.motion ?? "standard"];
  const fadeFrames = Math.max(1, Math.round(m.fadeS * fps));
  const captionsOn = props.showCaptions && props.captions.length > 0;
  const ctx: Ctx = {
    u,
    portrait,
    rtl: props.direction === "rtl",
    ts: typeScale(u, portrait, props.textScale ?? 1),
    palette: props.palette,
    stiffness: m.stiffness,
    kb: m.kb,
    captionsOn,
    textScale: props.textScale ?? 1,
  };
  let start = 0;
  const placed = props.scenes.map((s) => {
    const len = Math.max(1, Math.round(s.durationS * fps));
    const item = { scene: s, from: start, len };
    start += len;
    return item;
  });
  const musicVol = (f: number) => props.musicVolume * interpolate(f, [0, fps, durationInFrames - fps * 1.5, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const banner = readableOn(props.palette.accent, [props.palette.onSurface, props.palette.fg, props.palette.bg, props.palette.surface]);
  return (
    <C.Provider value={ctx}>
      <AbsoluteFill style={{ fontFamily: `"${FONT_FAMILY}", system-ui, sans-serif`, direction: props.direction, backgroundColor: props.palette.surface }}>
        {placed.map(({ scene, from, len }, i) => {
          const next = placed[i + 1]?.scene;
          return (
            <Sequence key={scene.id} from={from} durationInFrames={len + (next ? fadeFrames : 0)} name={`${scene.id} · ${scene.layout}`}>
              <SceneView scene={scene} props={props} durationFrames={len} fadeFrames={fadeFrames} index={i} nextTransition={next ? next.transition : null} />
              {i > 0 && scene.layout !== "end-card" && <Bug palette={props.palette} props={props} layout={scene.layout} />}
            </Sequence>
          );
        })}
        {captionsOn && <Captions cues={props.captions} offsetMs={props.voiceoverDelayS * 1000} />}
        {props.voiceover && (
          <Sequence from={Math.round(props.voiceoverDelayS * fps)}>
            <Audio src={props.voiceover} volume={props.voiceoverVolume} />
          </Sequence>
        )}
        {props.music && <Audio src={props.music} volume={musicVol} />}
        {props.draftBanner && (
          <div style={{ position: "absolute", top: 0, insetInline: 0, background: alpha(props.palette.accent, 0.94), color: banner, fontSize: 2.2 * u, fontWeight: 700, padding: `${0.6 * u}px 0`, textAlign: "center", letterSpacing: "0.04em", direction: "ltr" }}>
            {props.draftBanner}
          </div>
        )}
      </AbsoluteFill>
    </C.Provider>
  );
};
