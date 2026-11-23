"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, ago, fmtBytes, useApi } from "@/lib/api";
import { useProject, type AssetFull } from "@/components/project-context";
import { Card, CardHeader, Empty, ErrorNote, Pill, Select, Spinner, cn } from "@/components/ui";

interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTs(s: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0").slice(0, 3)) / 1000;
}

function parseSrt(src: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of src.replace(/^﻿/, "").replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.length);
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = parseTs(a);
    const end = parseTs(b ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end, text: lines.slice(i + 1).join("\n") });
  }
  return cues;
}

function tc(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function useText(id: string | null) {
  const [state, setState] = useState<{ id: string; text?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let off = false;
    fetch(assetUrl(id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (!off) setState({ id, text });
      })
      .catch((e) => {
        if (!off) setState({ id, error: (e as Error).message });
      });
    return () => {
      off = true;
    };
  }, [id]);
  const cur = state && state.id === id ? state : null;
  return { text: cur?.text, error: cur?.error, loading: !!id && !cur };
}

interface QaCheck {
  name?: string;
  expected?: unknown;
  actual?: unknown;
  severity?: string;
  pass?: boolean;
  passed?: boolean;
}

const show = (v: unknown) => (v === undefined || v === null ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v));

function QaReport({ asset }: { asset: AssetFull }) {
  const { text, error, loading } = useText(asset.id);
  let j: { pass?: boolean; passed?: boolean; checks?: QaCheck[]; facts?: Record<string, unknown> } | null = null;
  let parseErr: string | null = null;
  if (text) {
    try {
      j = JSON.parse(text);
    } catch (e) {
      parseErr = (e as Error).message;
    }
  }
  const checks = j?.checks ?? [];
  const overall = j?.pass ?? j?.passed ?? (checks.length ? checks.every((c) => (c.pass ?? c.passed) !== false) : undefined);
  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{asset.label}</span>
        <span className="text-faint">{ago(asset.createdAt)}</span>
        {overall !== undefined && <Pill tone={overall ? "ok" : "err"}>{overall ? "pass" : "fail"}</Pill>}
        {loading && <Spinner className="size-3" />}
      </div>
      {(error || parseErr) && <ErrorNote>{error ?? parseErr}</ErrorNote>}
      {j?.facts && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {Object.entries(j.facts).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <span className="text-faint">{k}: </span>
              <span className="break-all text-fg">{show(v)}</span>
            </div>
          ))}
        </div>
      )}
      {checks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-faint">
              <tr>
                <th className="py-1 pr-3 font-medium">Check</th>
                <th className="py-1 pr-3 font-medium">Expected</th>
                <th className="py-1 pr-3 font-medium">Actual</th>
                <th className="py-1 pr-3 font-medium">Severity</th>
                <th className="py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c, i) => {
                const ok = c.pass ?? c.passed;
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-3 text-fg">{c.name ?? "-"}</td>
                    <td className="py-1 pr-3 text-muted">{show(c.expected)}</td>
                    <td className="py-1 pr-3 text-muted">{show(c.actual)}</td>
                    <td className="py-1 pr-3">
                      <Pill tone={c.severity === "error" ? "err" : c.severity === "warn" || c.severity === "warning" ? "warn" : "default"}>{c.severity ?? "-"}</Pill>
                    </td>
                    <td className="py-1">
                      <Pill tone={ok ? "ok" : "err"}>{ok ? "pass" : "fail"}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PreviewPage() {
  const { data } = useProject();
  const pid = data?.project.id;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string>("");
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);

  const all = useApi<AssetFull[]>(pid ? `/api/assets?projectId=${pid}&limit=1000` : null, { events: (e) => e.project_id === pid && e.type === "node.completed" });
  const assets = all.data;
  const videos = useMemo(() => (assets ?? []).filter((a) => a.kind === "video").sort((a, b) => b.createdAt - a.createdAt), [assets]);
  const subs = useMemo(() => (assets ?? []).filter((a) => a.kind === "subtitle").sort((a, b) => b.createdAt - a.createdAt), [assets]);
  const audios = useMemo(() => (assets ?? []).filter((a) => a.kind === "audio").sort((a, b) => b.createdAt - a.createdAt), [assets]);
  const qas = useMemo(() => (assets ?? []).filter((a) => a.kind === "json" && a.provenance?.nodeType === "production.qa").sort((a, b) => b.createdAt - a.createdAt), [assets]);

  const defaultVideo = useMemo(() => {
    const c = videos.find((v) => /compose/i.test(v.label) || v.provenance?.nodeType === "production.compose");
    return (c ?? videos[0])?.id ?? null;
  }, [videos]);
  const activeVideoId = videoId && videos.some((v) => v.id === videoId) ? videoId : defaultVideo;
  const video = videos.find((v) => v.id === activeVideoId);

  const activeSubId = subId === "" ? (subs[0]?.id ?? null) : subId === "none" ? null : subId;
  const { text: srtText, error: srtErr, loading: srtLoading } = useText(activeSubId);
  const cues = useMemo(() => (srtText ? parseSrt(srtText) : []), [srtText]);
  const activeCue = cues.find((c) => now >= c.start && now < c.end);

  const scenes = useMemo(() => [...(data?.scenes ?? [])].sort((a, b) => a.idx - b.idx), [data?.scenes]);
  const sceneTotal = scenes.reduce((a, s) => a + s.durationS, 0);
  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t);
  };

  if (!data)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );

  return (
    <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader
            title="Production preview"
            sub={video ? `${video.label} · ${video.width ?? "?"}×${video.height ?? "?"} · ${fmtBytes(video.size)}` : undefined}
            actions={
              videos.length > 0 && (
                <div className="w-64">
                  <Select
                    value={activeVideoId ?? ""}
                    onChange={(e) => setVideoId(e.target.value)}
                    options={videos.map((v) => ({ value: v.id, label: `${v.label} (${ago(v.createdAt)})` }))}
                  />
                </div>
              )
            }
          />
          <div className="space-y-3 p-4">
            {!video ? (
              <Empty title="No video assets yet">Run a workflow that composes a video, or upload one in the Assets tab.</Empty>
            ) : (
              <>
                <div className="relative mx-auto max-h-[65vh] overflow-hidden rounded-md bg-black">
                  <video
                    key={video.id}
                    ref={videoRef}
                    src={assetUrl(video.id)}
                    controls
                    playsInline
                    preload="metadata"
                    className="mx-auto max-h-[65vh] w-full bg-black object-contain"
                    onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                    onSeeked={(e) => setNow(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                  />
                  {activeCue && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4">
                      <span dir="auto" className="max-w-[90%] whitespace-pre-line rounded-lg bg-black/75 px-3 py-1.5 text-center text-sm leading-snug text-white">
                        {activeCue.text}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Pill>duration {dur ? tc(dur) : video.durationS ? tc(video.durationS) : "-"}</Pill>
                  <Pill tone="info">current {tc(now)}</Pill>
                  {video.fps != null && <Pill>{video.fps} fps</Pill>}
                  {sceneTotal > 0 && <Pill>storyboard {tc(sceneTotal)}</Pill>}
                </div>
              </>
            )}

            {scenes.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">Scene timeline</div>
                <div className="relative flex h-9 overflow-hidden rounded-md border border-line bg-bg">
                  {(() => {
                    let acc = 0;
                    return scenes.map((s) => {
                      const start = acc;
                      acc += s.durationS;
                      return (
                        <button
                          key={s.id}
                          disabled={!video}
                          onClick={() => seek(start)}
                          title={`${s.idx + 1}. ${s.title} (${tc(start)} - ${tc(start + s.durationS)})`}
                          style={{ width: `${(s.durationS / sceneTotal) * 100}%` }}
                          className={cn("min-w-0 truncate border-r border-line px-1.5 text-left text-[11px] text-muted last:border-r-0 hover:bg-panel-2 hover:text-fg disabled:cursor-not-allowed", s.status === "approved" && "bg-ok/10")}
                        >
                          <span dir="auto">
                            {s.idx + 1}. {s.title}
                          </span>
                        </button>
                      );
                    });
                  })()}
                  {video && sceneTotal > 0 && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${Math.min(100, (now / (dur || sceneTotal)) * 100)}%` }} />}
                </div>
                <div className="mt-1 text-[11px] text-faint">Click a segment to seek to that scene&apos;s start. Segments are proportional to storyboard durations; the playhead is positioned against the video duration.</div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Subtitles"
            sub={cues.length ? `${cues.length} cues` : undefined}
            actions={
              subs.length > 0 && (
                <div className="w-64">
                  <Select
                    value={subId === "" ? (subs[0]?.id ?? "none") : subId}
                    onChange={(e) => setSubId(e.target.value)}
                    options={[{ value: "none", label: "No subtitles" }, ...subs.map((s) => ({ value: s.id, label: `${s.label} (${ago(s.createdAt)})` }))]}
                  />
                </div>
              )
            }
          />
          <div className="p-4">
            {!subs.length && <Empty title="No subtitle assets">Subtitle (SRT) assets produced by a workflow will be listed here.</Empty>}
            {srtLoading && <Spinner />}
            {srtErr && <ErrorNote>{srtErr}</ErrorNote>}
            {cues.length > 0 && (
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {cues.map((c, i) => (
                  <button key={i} onClick={() => seek(c.start)} disabled={!video} className={cn("flex w-full gap-3 rounded px-2 py-1 text-left text-xs hover:bg-panel-2 disabled:cursor-not-allowed", c === activeCue && "bg-accent/10")}>
                    <span className="w-28 shrink-0 font-mono text-[11px] text-faint">
                      {tc(c.start)} - {tc(c.end)}
                    </span>
                    <span dir="auto" className="min-w-0 whitespace-pre-line text-fg">
                      {c.text}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {activeSubId && !srtLoading && !srtErr && !cues.length && <div className="text-xs text-muted">No cues could be parsed from this file (SRT expected).</div>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Audio review" sub="Voiceover takes, music and other audio assets" />
          <div className="space-y-2 p-4">
            {!audios.length && <Empty title="No audio assets" />}
            {audios.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
                <div className="min-w-0 basis-48">
                  <div className="truncate text-xs font-medium" dir="auto" title={a.label}>
                    {a.label}
                  </div>
                  <div className="text-[11px] text-faint">
                    {a.durationS ? `${a.durationS.toFixed(1)}s · ` : ""}v{a.version} · {ago(a.createdAt)}
                  </div>
                </div>
                <audio src={assetUrl(a.id)} controls preload="none" className="h-8 min-w-48 flex-1" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="QA reports" sub="production.qa results" />
          <div className="space-y-3 p-4">
            {!qas.length && <Empty title="No QA reports yet">A production.qa node run will produce a JSON report with checks and facts.</Empty>}
            {qas.map((a) => (
              <QaReport key={a.id} asset={a} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Exports" />
          <div className="space-y-1 p-4">
            {!data.exports.length && <Empty title="No exports yet" />}
            {data.exports.map((e) => (
              <div key={e.name} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg" title={e.name}>
                    {e.name}
                  </div>
                  <div className="text-faint">
                    {fmtBytes(e.size)} · {ago(e.modifiedAt)}
                  </div>
                </div>
                <a href={`/api/exports/file?projectId=${pid}&name=${encodeURIComponent(e.name)}`} className="inline-flex h-7 items-center rounded-md border border-line bg-panel-2 px-2.5 text-xs hover:bg-line">
                  Download
                </a>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
