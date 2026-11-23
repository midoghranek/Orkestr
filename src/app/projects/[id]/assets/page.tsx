"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ago, assetUrl, fmtBytes, useApi } from "@/lib/api";
import { useProject, type AssetFull } from "@/components/project-context";
import { AssetPreview, Button, Card, CardHeader, Empty, ErrorNote, Input, Notice, Pill, Spinner, Textarea, toast, cn } from "@/components/ui";

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
  if (txt === null) return <Spinner />;
  return (
    <pre dir="auto" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg p-2 text-[11px] leading-relaxed text-muted">
      {txt.length > 20000 ? `${txt.slice(0, 20000)}\n... (truncated, ${txt.length} chars)` : txt}
    </pre>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-faint">{k}</span>
      <span className="min-w-0 break-all text-fg">{children}</span>
    </div>
  );
}

const H = "mb-1 text-[11px] font-medium uppercase tracking-wide text-faint";

function DetailPanel({ assetId, onClose, onSelect }: { assetId: string; onClose: () => void; onSelect: (id: string) => void }) {
  const { data, error } = useApi<{ asset: AssetFull; lineage: AssetFull[] }>(`/api/assets/${assetId}`);
  const a = data?.asset;
  const rawStreams = a ? (a.metadata as { streams?: unknown }).streams : undefined;
  const streams = Array.isArray(rawStreams) ? (rawStreams as Record<string, unknown>[]) : [];
  const prov = a?.provenance ?? {};
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-line-strong bg-panel shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 truncate text-[13px] font-semibold" dir="auto">
          {a?.label ?? "Asset"}
        </div>
        <div className="flex gap-2">
          {a && (
            <a href={`/api/assets/${a.id}/file?download=1`} className="inline-flex h-7 items-center rounded-md border border-line bg-panel-2 px-2.5 text-xs hover:bg-line">
              Download
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data && !error && <Spinner />}
        {a && data && (
          <>
            {TEXT_KINDS.has(a.kind) ? (
              <TextBody id={a.id} />
            ) : (
              <div className={cn("overflow-hidden rounded-md border border-line bg-black", a.kind === "audio" ? "p-3" : "max-h-[50vh]")}>
                <AssetPreview asset={a} controls className={a.kind === "audio" ? "" : "max-h-[50vh]"} />
              </div>
            )}
            <div className="space-y-1.5">
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
                <code className="text-[11px]">{a.sha256}</code>
              </Row>
            </div>
            {streams.length > 0 && (
              <div>
                <div className={H}>Streams</div>
                <div className="space-y-1">
                  {streams.map((s, i) => (
                    <div key={i} className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-muted">
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
              {prov.params !== undefined && <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-line bg-bg p-2 text-[11px] text-muted">{JSON.stringify(prov.params, null, 2)}</pre>}
            </div>
            <div>
              <div className={H}>Lineage</div>
              {data.lineage.length === 0 ? (
                <div className="text-xs text-muted">No parent assets (source asset).</div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Pill tone="info">this</Pill>
                  {data.lineage.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5">
                      <span className="text-faint">←</span>
                      <button onClick={() => onSelect(p.id)} className="max-w-48 truncate rounded bg-panel-2 px-1.5 py-0.5 text-fg hover:bg-line" title={p.label}>
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
    </div>
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
    <div className="space-y-5 p-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upload files" sub="Images, video, audio, subtitles, JSON, text (1 GB max each)" />
          <div className="p-4">
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
              className={cn("flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted", drag ? "border-accent bg-accent/5" : "border-line-strong")}
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Uploading...
                </span>
              ) : (
                <>
                  <span>Drag and drop files here, or</span>
                  <Button size="sm" onClick={() => fileRef.current?.click()}>
                    Choose files
                  </Button>
                </>
              )}
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Import from local path" sub="One absolute path per line" />
          <div className="space-y-2 p-4">
            <Textarea dir="ltr" className="min-h-16 font-mono text-xs" placeholder="C:\Users\me\Footage\clip.mp4" value={paths} onChange={(e) => setPaths(e.target.value)} />
            <Notice tone="info">Only works for folders listed in Settings → Import folders. Other paths are rejected with a 403.</Notice>
            {importErr && <ErrorNote>{importErr}</ErrorNote>}
            <Button size="sm" variant="primary" busy={importing} disabled={!paths.trim()} onClick={doImport}>
              Import
            </Button>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("h-7 rounded-full border px-3 text-xs capitalize", kind === k ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-muted hover:text-fg")}>
            {k}
            {assets && <span className="ml-1 text-faint">{k === "all" ? assets.length : assets.filter((a) => a.kind === k).length}</span>}
          </button>
        ))}
        <div className="ml-auto w-56">
          <Input placeholder="Search label..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading && <Spinner />}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {assets && !list.length && <Empty title={assets.length ? "No assets match" : "No assets yet"}>{assets.length ? "Try another kind or search term." : "Upload or import files, or run a workflow to produce some."}</Empty>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {list.map((a) => (
          <button key={a.id} onClick={() => setSel(a.id)} className={cn("overflow-hidden rounded-lg border bg-panel text-left transition-colors hover:border-line-strong", sel === a.id ? "border-accent/60" : "border-line")}>
            <div className="pointer-events-none aspect-video bg-black">
              <AssetPreview asset={a} controls={false} />
            </div>
            <div className="space-y-1 p-2">
              <div className="truncate text-xs font-medium text-fg" title={a.label} dir="auto">
                {a.label}
              </div>
              <div className="flex items-center gap-1.5">
                <Pill>{a.kind}</Pill>
                <span className="text-[11px] text-faint">v{a.version}</span>
                <span className="ml-auto text-[11px] text-faint">{ago(a.createdAt)}</span>
              </div>
              <div className="truncate text-[11px] text-muted">{meta(a)}</div>
            </div>
          </button>
        ))}
      </div>

      {sel && <DetailPanel assetId={sel} onClose={() => setSel(null)} onSelect={setSel} />}
    </div>
  );
}
