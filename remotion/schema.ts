import { z } from "zod";

/** Props contracts shared by the Remotion compositions and the Orkestr production nodes. */

export const PaletteSchema = z.object({
  bg: z.string().default("#F7F1E8"),
  fg: z.string().default("#22412D"),
  accent: z.string().default("#C97A55"),
  accent2: z.string().default("#4F7D5A"),
  surface: z.string().default("#1A3324"),
  onSurface: z.string().default("#F7F1E8"),
});
export type Palette = z.infer<typeof PaletteSchema>;

export const CaptionSchema = z.object({ text: z.string(), startMs: z.number(), endMs: z.number() });
export type CaptionCue = z.infer<typeof CaptionSchema>;

export const VisualSchema = z.object({
  src: z.string(),
  type: z.enum(["image", "video"]),
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Slow push-in on stills. */
  kenBurns: z.boolean().default(true),
  /** Wrap real UI captures in a neutral device frame. */
  frame: z.enum(["none", "browser", "phone"]).default("none"),
  /** For long UI captures: scroll from top to bottom during the scene. */
  scroll: z.boolean().default(false),
  startFromS: z.number().min(0).default(0),
});
export type Visual = z.infer<typeof VisualSchema>;

export const SceneLayoutSchema = z.enum(["full-bleed", "split", "title", "ui-showcase", "end-card"]);

export const CommercialSceneSchema = z.object({
  id: z.string(),
  durationS: z.number().min(0.3).max(120),
  layout: SceneLayoutSchema.default("full-bleed"),
  visual: VisualSchema.nullable().default(null),
  kicker: z.string().default(""),
  headline: z.string().default(""),
  body: z.string().default(""),
  transition: z.enum(["fade", "slide", "none"]).default("fade"),
  /** Marks a scene whose visual is a stand-in for footage that still has to be produced. */
  placeholder: z.boolean().default(false),
});
export type CommercialScene = z.infer<typeof CommercialSceneSchema>;

export const CommercialPropsSchema = z.object({
  width: z.number().int().min(16).default(1920),
  height: z.number().int().min(16).default(1080),
  fps: z.number().int().min(1).max(60).default(30),
  direction: z.enum(["rtl", "ltr"]).default("rtl"),
  palette: PaletteSchema.default(PaletteSchema.parse({})),
  scenes: z.array(CommercialSceneSchema).min(1),
  logo: z.string().nullable().default(null),
  logoReversed: z.string().nullable().default(null),
  voiceover: z.string().nullable().default(null),
  voiceoverDelayS: z.number().min(0).default(0.4),
  voiceoverVolume: z.number().min(0).max(2).default(1),
  music: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.25),
  captions: z.array(CaptionSchema).default([]),
  showCaptions: z.boolean().default(true),
  /** Burned-in banner when any visual is a placeholder: honesty about unfinished footage. */
  draftBanner: z.string().default(""),
});
export type CommercialProps = z.infer<typeof CommercialPropsSchema>;

export const PosterPropsSchema = z.object({
  width: z.number().int().default(1080),
  height: z.number().int().default(1350),
  direction: z.enum(["rtl", "ltr"]).default("rtl"),
  palette: PaletteSchema.default(PaletteSchema.parse({})),
  background: z.string().nullable().default(null),
  kicker: z.string().default(""),
  headline: z.string(),
  sub: z.string().default(""),
  cta: z.string().default(""),
  logo: z.string().nullable().default(null),
});
export type PosterProps = z.infer<typeof PosterPropsSchema>;

export const LoopPropsSchema = z.object({
  width: z.number().int().default(1920),
  height: z.number().int().default(1080),
  fps: z.number().int().default(30),
  durationS: z.number().min(2).max(60).default(12),
  palette: PaletteSchema.default(PaletteSchema.parse({})),
  images: z.array(z.string()).min(1).max(12),
  logo: z.string().nullable().default(null),
  /** Darken for text legibility when the loop sits behind a hero headline. */
  scrim: z.number().min(0).max(0.9).default(0.25),
});
export type LoopProps = z.infer<typeof LoopPropsSchema>;

export const TestCardPropsSchema = z.object({
  width: z.number().int().default(640),
  height: z.number().int().default(360),
  fps: z.number().int().default(30),
  durationS: z.number().min(0.5).max(30).default(2),
  label: z.string().default("Orkestr"),
});
export type TestCardProps = z.infer<typeof TestCardPropsSchema>;
