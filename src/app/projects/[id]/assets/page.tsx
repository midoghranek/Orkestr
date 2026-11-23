"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ago, assetUrl, fmtBytes, useApi } from "@/lib/api";
import { useProject, type AssetFull } from "@/components/project-context";
import { Download, Search, Upload, X } from "lucide-react";
import { AssetPreview, Button, Card, CardHeader, Empty, ErrorNote, Field, IconButton, Input, Label, LoadingRows, Notice, Pill, Sheet, Skeleton, Spinner, Tabs, Textarea, btnCls, toast, cn } from "@/components/ui";

const KINDS = ["all", "image", "video", "audio", "subtitle", "json", "text"] as const;
const TEXT_KINDS = new Set(["subtitle", "json", "text"]);

function meta(a: AssetFull): string {
  const p: string[] = [];
  if (a.width && a.height) p.push(`${a.width}×${a.height}`);
  if (a.durationS) p.push(`${a.durationS.toFixed(1)}s`);
  p.push(fmtBytes(a.size));
  return p.join(" · ");
}

function TextBody({ id }: { id: string }) {
  const [txt, setTxt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    setTxt(null);
    setErr(null);
    fetch(assetUrl(id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => {
        if (!off) setTxt(t);
      })
      .catch((e) => {
        if (!off) setErr((e as Error).message);
      });
    return () => {
      off = true;
    };
  }, [id]);
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (txt === null) return <Skeleton className="h-24" />;
  return (
    <pre dir="auto" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-ctl border-2 border-ink bg-bg p-2 font-mono text-[12px] leading-relaxed text-ink">
      {txt.length > 20000 ? `${txt.slice(0, 20000)}\n... (truncated, ${txt.length} chars)` : txt}
    </pre>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="nb-label w-24 shrink-0 pt-0.5 text-faint">{k}</span>
      <span className="min-w-0 break-all text-ink">{children}</span>
    </div>
  );
}

const H = "nb-label mb-1.5 text-faint";

function DetailPanel({ assetId, onClose, onSelect }: { assetId: string; onClose: () => void; onSelect: (id: string) => void }) {
  const { data, error } = useApi<{ asset: AssetFull; lineage: AssetFull[] }>(`/api/assets/${assetId}`);
  const a = data?.asset;
  const rawStreams = a ? (a.metadata as { streams?: unknown }).streams : undefined;
  const streams = Array.isArray(rawStreams) ? (rawStreams as Record<string, unknown>[]) : [];
  const prov = a?.provenance ?? {};
  return (
    <Sheet onClose={onClose} label={a?.label ?? "Asset details"} className="max-w-lg">
      <CardHeader
        className="bg-panel-2"
        eyebrow="Asset"
        title={
          <span className="block truncate" dir="auto" title={a?.label}>
            {a?.label ?? "Asset"}
          </span>
        }
        actions={
          <>
            {a && (
              <a href={`/api/assets/${a.id}/file?download=1`} className={btnCls("default", "sm")}>
                <Download className="size-3.5" aria-hidden />
                Download
              </a>
            )}
            <IconButton label="Close" onClick={onClose}>
              <X className="size-5" />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data && !error && <LoadingRows rows={3} className="p-0" />}
        {a && data && (
          <>
            {TEXT_KINDS.has(a.kind) ? (
              <TextBody id={a.id} />
            ) : (
              <div className={cn("overflow-hidden rounded-ctl border-2 border-ink bg-ink", a.kind === "audio" ? "p-3" : "max-h-[50vh]")}>
                <AssetPreview asset={a} controls className={a.kind === "audio" ? "" : "max-h-[50vh]"} />
              </div>
            )}
            <div className="space-y-2 rounded-ctl border-2 border-ink bg-panel p-3">
              <Row k="Kind">
                {a.kind} ({a.mime})
              </Row>
              <Row k="Size">{fmtBytes(a.size)}</Row>
              {a.width && a.height && (
                <Row k="Dimensions">
                  {a.width}×{a.height}
                </Row>
              )}
              {a.durationS != null && <Row k="Duration">{a.durationS.toFixed(2)}s</Row>}
              {a.fps != null && <Row k="FPS">{a.fps}</Row>}
              <Row k="Version">v{a.version}</Row>
              <Row k="Created">{new Date(a.createdAt).toLocaleString()}</Row>
              {a.sceneId && <Row k="Scene">{a.sceneId}</Row>}
              <Row k="SHA-256">
                <code className="font-mono text-[12px]">{a.sha256}</code>
              </Row>
            </div>
            {streams.length > 0 && (
              <div>
                <div className={H}>Streams</div>
                <div className="space-y-1">
                  {streams.map((s, i) => (
                    <div key={i} className="break-all rounded-ctl border-2 border-ink/30 bg-bg px-2 py-1 font-mono text-[12px] text-muted">
                      {Object.entries(s)
                        .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join("  ")}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className={H}>Provenance</div>
              <div className="space-y-1.5">
                {["nodeType", "capability", "runId", "source", "originalPath"].map((k) =>
                  prov[k] !== undefined ? (
                    <Row key={k} k={k}>
                      {String(prov[k])}
                    </Row>
                  ) : null,
                )}
                {a.nodeRunId && <Row k="nodeRunId">{a.nodeRunId}</Row>}
              </div>
              {prov.params !== undefined && <pre className="mt-2 max-h-48 overflow-auto rounded-ctl border-2 border-ink bg-bg p-2 font-mono text-[12px] text-ink">{JSON.stringify(prov.params, null, 2)}</pre>}
            </div>
            <div>
              <div className={H}>Lineage</div>
              {data.lineage.length === 0 ? (
                <div className="text-[13px] text-muted">No parent assets (source asset).</div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                  <Pill tone="info">this</Pill>
                  {data.lineage.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5">
                      <span className="text-faint">←</span>
                      <button type="button" onClick={() => onSelect(p.id)} className="nb-press max-w-48 truncate rounded-ctl border-2 border-ink bg-panel px-1.5 py-0.5 text-ink shadow-brut-xs hover:bg-white" title={p.label}>
                        {p.kind}: {p.label}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

export default function AssetsPage() {
  const { data: proj, reload } = useProject();
  const pid = proj?.project.id;
  const { data: assets, error, loading, reload: reloadAssets } = useApi<AssetFull[]>(pid ? `/api/assets?projectId=${pid}` : null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [paths, setPaths] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return [...(assets ?? [])].filter((a) => (kind === "all" || a.kind === kind) && (!ql || a.label.toLowerCase().includes(ql))).sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, kind, q]);

  const refresh = async () => {
    await Promise.all([reloadAssets(), reload()]);
  };

  const upload = async (files: FileList | File[]) => {
    if (!pid || !files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f, i) => fd.append(`file${i}`, f, f.name));
      const res = await fetch(`/api/projects/${pid}/assets/upload`, { method: "POST", body: fd });
      const text = await res.text();
      const body = text ? JSON.parse(text) : undefined;
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast(`Uploaded ${Array.isArray(body) ? body.length : 1} file(s)`, "ok");
      await refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async () => {
    const p = paths
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!pid || !p.length) return;
    setImporting(true);
    setImportErr(null);
    try {
      const r = await api<unknown[]>(`/api/projects/${pid}/assets/import`, { method: "POST", json: { paths: p } });
      toast(`Imported ${r.length} file(s)`, "ok");
      setPaths("");
      await refresh();
    } catch (e) {
      setImportErr((e as Error).message);
      toast((e as Error).message, "err");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader eyebrow="01 · Upload" title="Upload files" sub="Images, video, audio, subtitles, JSON, text (1 GB max each)" />
          <div className="flex flex-1 flex-col p-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void upload(e.dataTransfer.files);
              }}
              className={cn("flex min-h-36 flex-1 flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-ink px-4 py-6 text-center text-[13px] text-muted transition-colors", drag ? "bg-accent/40" : "bg-bg/60")}
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2 font-semibold text-ink">
                  <Spinner /> Uploading...
                </span>
              ) : (
                <>
                  <span className="flex size-10 items-center justify-center rounded-full border-2 border-ink bg-accent shadow-brut-xs">
                    <Upload className="size-5 text-ink" aria-hidden />
                  </span>
                  <span>{drag ? "Drop to upload" : "Drag and drop files here, or"}</span>
                  <Button variant="primary" onClick={() => fileRef.current?.click()}>
                    Choose files
                  </Button>
                </>
              )}
              <input ref={fileRef} type="file" multiple hidden aria-label="Choose files to upload" onChange={(e) => e.target.files && void upload(e.target.files)} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow="02 · Import" title="Import from local path" sub="One absolute path per line" />
          <div className="space-y-3 p-4">
            <Field label="Paths">
              <Textarea dir="ltr" className="min-h-20 font-mono text-[13px]" placeholder="C:\Users\me\Footage\clip.mp4" value={paths} onChange={(e) => setPaths(e.target.value)} />
            </Field>
            <Notice tone="info">Only works for folders listed in Settings → Import folders. Other paths are rejected with a 403.</Notice>
            {importErr && <ErrorNote>{importErr}</ErrorNote>}
            <Button variant="primary" busy={importing} disabled={!paths.trim()} onClick={doImport}>
              Import
            </Button>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          className="rounded-ctl border-2 border-ink bg-panel"
          value={kind}
          onChange={setKind}
          tabs={KINDS.map((k) => ({
            value: k,
            label: (
              <span className="capitalize">
                {k}
                {assets && <span className="ml-1.5 font-mono text-[12px] opacity-70">{k === "all" ? assets.length : assets.filter((a) => a.kind === k).length}</span>}
              </span>
            ),
          }))}
        />
        <div className="relative w-full sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Search assets by label" className="pl-9" placeholder="Search label..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !assets && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" role="status" aria-label="loading">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      )}
      {assets && !list.length && <Empty title={assets.length ? "No assets match" : "No assets yet"}>{assets.length ? "Try another kind or search term." : "Upload or import files, or run a workflow to produce some."}</Empty>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSel(a.id)}
            aria-label={`Open asset ${a.label}`}
            className={cn("nb-lift min-w-0 overflow-hidden rounded-card border-2 border-ink bg-panel text-left shadow-brut-xs", sel === a.id && "bg-accent/30")}
          >
            <div className="pointer-events-none aspect-video border-b-2 border-ink bg-ink">
              <AssetPreview asset={a} controls={false} />
            </div>
            <div className="space-y-1.5 p-2.5">
              <div className="truncate text-[13px] font-semibold text-ink" title={a.label} dir="auto">
                {a.label}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill className="uppercase">{a.kind}</Pill>
                <span className="font-mono text-[12px] text-muted">v{a.version}</span>
                <span className="ml-auto text-[12px] text-faint">{ago(a.createdAt)}</span>
              </div>
              <div className="truncate font-mono text-[12px] text-muted">{meta(a)}</div>
            </div>
          </button>
        ))}
      </div>

      {sel && <DetailPanel assetId={sel} onClose={() => setSel(null)} onSelect={setSel} />}
    </div>
  );
}
