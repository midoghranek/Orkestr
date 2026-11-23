import { describe, expect, it } from "vitest";
import { groupCues, parseSrt, toSrt, toWordCaptions } from "@/server/adapters/whisper";

describe("captions", () => {
  const json = {
    result: { language: "ar" },
    transcription: [
      {
        offsets: { from: 0, to: 2000 },
        text: " صباحك على مزاجك.",
        tokens: [
          { text: " صبا", offsets: { from: 0, to: 400 }, p: 0.9, t_dtw: 0 },
          { text: "حك", offsets: { from: 400, to: 700 }, p: 0.8, t_dtw: 0 },
          { text: " على", offsets: { from: 700, to: 1100 }, p: 0.95, t_dtw: 0 },
          { text: " مزاجك.", offsets: { from: 1100, to: 2000 }, p: 0.4, t_dtw: 0 },
          { text: "[_TT_100]", offsets: { from: 2000, to: 2000 }, p: 1, t_dtw: 0 },
        ],
      },
    ],
  };

  it("merges sub-word tokens into words and drops special tokens", () => {
    const words = toWordCaptions(json);
    expect(words.map((w) => w.text)).toEqual(["صباحك", "على", "مزاجك."]);
    expect(words[0]).toMatchObject({ startMs: 0, endMs: 700, confidence: 0.8 });
  });

  it("groups cues, breaks on sentence punctuation and round-trips SRT", () => {
    const cues = groupCues(toWordCaptions(json), 42);
    expect(cues).toHaveLength(1);
    const srt = toSrt(cues);
    expect(srt).toContain("00:00:00,000 --> 00:00:02,000");
    const back = parseSrt(srt);
    expect(back[0]).toMatchObject({ text: "صباحك على مزاجك.", startMs: 0, endMs: 2000 });
  });

  it("splits long text by max characters", () => {
    const words = Array.from({ length: 20 }, (_, i) => ({ text: `word${i}`, startMs: i * 300, endMs: i * 300 + 250, confidence: 1 }));
    const cues = groupCues(words, 20);
    expect(cues.every((c) => c.text.length <= 20)).toBe(true);
  });

  it("rejects malformed SRT", () => {
    expect(() => parseSrt("1\nnot a time\nhello")).toThrow();
  });
});
