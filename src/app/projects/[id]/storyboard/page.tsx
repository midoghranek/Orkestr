"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api, ago, useApi } from "@/lib/api";
import { useProject, type AssetFull, type SceneLite } from "@/components/project-context";
import { X } from "lucide-react";
import { AssetPreview, Button, Card, CardHeader, Empty, ErrorNote, Field, IconButton, Input, LoadingRows, Notice, Pill, Sheet, Skeleton, Spinner, StatusBadge, Textarea, btnCls, toast, cn } from "@/components/ui";

const EDIT_FIELDS = ["title", "durationS", "narration", "onScreenText", "camera", "prompt", "notes"] as const;
type EditField = (typeof EDIT_FIELDS)[number];
type Draft = Record<EditField, string>;

function toDraft(s: SceneLite): Draft {
  return { title: s.title, durationS: String(s.durationS), narration: s.narration, onScreenText: s.onScreenText, camera: s.camera, prompt: s.prompt, notes: s.notes };
}

function visualTone(v: string): { tone: "warn" | "ok" | "info"; flagged: boolean } {
  if (v === "placeholder" || v === "stock" || v.startsWith("generated-")) return { tone: "warn", flagged: true };
  return { tone: v === "ui-capture" || v === "motion-graphics" ? "ok" : "info", flagged: false };
}

function SceneThumb({ id }: { id: string | null }) {
  const { data, error } = useApi<{ asset: AssetFull }>(id ? `/api/assets/${id}` : null);
  return (
    <div className="aspect-video w-full overflow-hidden rounded-ctl border-2 border-ink bg-ink">
      {!id ? (
        <div className="nb-label flex h-full items-center justify-center text-cream/80">No visual selected</div>
      ) : data ? (
        <AssetPreview asset={data.asset} controls={false} />
      ) : error ? (
        <div className="nb-label flex h-full items-center justify-center text-cream">asset unavailable</div>
      ) : (
        <div className="flex h-full items-center justify-center text-cream">
          <Spinner />
        </div>
      )}
    </div>
  );
}

function VersionDrawer({ scene, onClose, onUse }: { scene: SceneLite; onClose: () => void; onUse: (assetId: string) => Promise<void> }) {
  const { data, error, loading } = useApi<{ scene: SceneLite; versions: AssetFull[] }>(`/api/scenes/${scene.id}`);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Sheet onClose={onClose} label="Version history">
      <CardHeader
        className="bg-panel-2"
        eyebrow={`Scene ${scene.idx + 1}`}
        title="Version history"
        sub={
          <span className="block truncate" dir="auto">
            {scene.title}
          </span>
        }
        actions={
          <IconButton label="Close" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loading && <LoadingRows rows={3} className="p-0" />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {data && !data.versions.length && <Empty title="No versions yet">Assets produced for this scene by a workflow run will appear here.</Empty>}
        {data?.versions.map((a) => {
          const selected = a.id === scene.selectedAssetId;
          return (
            <div key={a.id} className={cn("rounded-ctl border-2 border-ink p-2", selected ? "bg-accent/25 shadow-brut-xs" : "bg-panel")}>
              <div className="aspect-video overflow-hidden rounded-ctl border-2 border-ink bg-ink">
                <AssetPreview asset={a} controls={false} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="min-w-0 text-[13px]">
                  <div className="truncate font-semibold text-ink" title={a.label}>
                    <span className="font-mono">v{a.version}</span> · {a.label}
                  </div>
                  <div className="text-[12px] text-faint">
                    {a.kind} · {ago(a.createdAt)}
                  </div>
                </div>
                {selected ? (
                  <Pill tone="ok">selected</Pill>
                ) : (
                  <Button
                    size="sm"
                    busy={busy === a.id}
                    onClick={async () => {
                      setBusy(a.id);
                      try {
                        await onUse(a.id);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Use this version
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

const LBL = "nb-label text-faint";

function SceneCard({
  scene,
  regen,
  onChanged,
  onHistory,
}: {
  scene: SceneLite;
  regen: { runId: string; nodeId: string } | null | undefined;
  onChanged: () => Promise<void>;
  onHistory: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(scene));
  const [busy, setBusy] = useState<string | null>(null);
  const vs = typeof scene.settings?.visualSource === "string" ? (scene.settings.visualSource as string) : null;
  const vt = vs ? visualTone(vs) : null;

  const patch = async (body: Record<string, unknown>, key: string, okMsg?: string) => {
    setBusy(key);
    try {
      await api(`/api/scenes/${scene.id}`, { method: "PATCH", json: body });
      if (okMsg) toast(okMsg, "ok");
      await onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const changes: Record<string, unknown> = {};
    const orig = toDraft(scene);
    for (const f of EDIT_FIELDS) {
      if (draft[f] === orig[f]) continue;
      if (f === "durationS") {
        const n = Number(draft.durationS);
        if (!Number.isFinite(n)) return toast("Duration must be a number", "err");
        changes.durationS = n;
      } else changes[f] = draft[f];
    }
    if (!Object.keys(changes).length) return setEditing(false);
    if (await patch(changes, "save", "Scene saved")) setEditing(false);
  };

  const regenerate = async () => {
    if (!regen) return;
    setBusy("regen");
    try {
      await api(`/api/runs/${regen.runId}/rerun`, { method: "POST", json: { nodeIds: [regen.nodeId] } });
      toast("Regeneration started", "ok");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const set = (f: EditField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [f]: e.target.value }));

  const regenTitle = regen
    ? "Re-run only this scene's workflow node; unchanged scenes are reused from cache"
    : regen === undefined
      ? "Looking up the workflow node for this scene..."
      : "No run for this project has a workflow node with this scene's id. Run a workflow generated from the storyboard first.";

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-stretch gap-3 border-b-2 border-ink bg-panel-2 pr-3">
        <span
          className="flex min-w-14 shrink-0 items-center justify-center border-r-2 border-ink bg-accent px-2 py-2 font-mono text-[28px] font-bold leading-none tabular-nums text-ink"
          aria-label={`Scene ${scene.idx + 1}`}
        >
          {String(scene.idx + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1 py-2">
          <h3 className="line-clamp-2 font-display text-[17px] font-bold leading-tight tracking-[-0.01em] text-ink" dir="auto" title={scene.title}>
            {scene.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-ink">{scene.durationS}s</span>
            <StatusBadge status={scene.status} />
          </div>
        </div>
      </div>
      <div className="space-y-3 p-3">
        <SceneThumb id={scene.selectedAssetId} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill className="font-mono">{scene.aspect}</Pill>
          <Pill className="font-mono">v{scene.version}</Pill>
          {scene.tool && <Pill>{scene.tool}</Pill>}
          {vs && vt && (
            <Pill tone={vt.tone} title={vt.flagged ? "Needs footage that no verified tool can produce" : "Producible with verified tools"}>
              {vt.flagged ? "needs footage: " : ""}
              {vs}
            </Pill>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <Field label="Title">
              <Input dir="auto" value={draft.title} onChange={set("title")} />
            </Field>
            <Field label="Duration (s)">
              <Input type="number" step="0.5" min={0.5} max={120} value={draft.durationS} onChange={set("durationS")} />
            </Field>
            <Field label="Narration">
              <Textarea dir="auto" value={draft.narration} onChange={set("narration")} />
            </Field>
            <Field label="On-screen text">
              <Textarea dir="auto" className="min-h-12" value={draft.onScreenText} onChange={set("onScreenText")} />
            </Field>
            <Field label="Camera">
              <Input dir="auto" value={draft.camera} onChange={set("camera")} />
            </Field>
            <Field label="Prompt">
              <Textarea dir="auto" value={draft.prompt} onChange={set("prompt")} />
            </Field>
            <Field label="Notes">
              <Textarea dir="auto" className="min-h-12" value={draft.notes} onChange={set("notes")} />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" busy={busy === "save"} onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(toDraft(scene));
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="space-y-2.5 text-[13px]">
            {scene.narration && (
              <div>
                <dt className={LBL}>Narration</dt>
                <dd dir="auto" className="mt-0.5 whitespace-pre-wrap leading-relaxed text-ink">
                  {scene.narration}
                </dd>
              </div>
            )}
            {scene.onScreenText && (
              <div>
                <dt className={LBL}>On-screen text</dt>
                <dd dir="auto" className="mt-0.5 whitespace-pre-wrap font-semibold text-ink">
                  {scene.onScreenText}
                </dd>
              </div>
            )}
            {scene.camera && (
              <div>
                <dt className={LBL}>Camera</dt>
                <dd dir="auto" className="mt-0.5 text-muted">
                  {scene.camera}
                </dd>
              </div>
            )}
            {scene.prompt && (
              <div>
                <dt className={LBL}>Prompt</dt>
                <dd dir="auto" className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-muted" title={scene.prompt}>
                  {scene.prompt}
                </dd>
              </div>
            )}
            {scene.constraints.length > 0 && (
              <div>
                <dt className={LBL}>Constraints</dt>
                <dd className="mt-0.5 flex flex-wrap gap-1">
                  {scene.constraints.map((c, i) => (
                    <Pill key={i} className="h-auto whitespace-normal py-0.5">
                      <span dir="auto">{c}</span>
                    </Pill>
                  ))}
                </dd>
              </div>
            )}
            {scene.references.length > 0 && (
              <div>
                <dt className={LBL}>References</dt>
                <dd className="mt-0.5 flex flex-wrap gap-1">
                  {scene.references.map((r, i) => (
                    <Pill key={i} className="max-w-full truncate" title={r}>
                      {r}
                    </Pill>
                  ))}
                </dd>
              </div>
            )}
            {scene.notes && (
              <div>
                <dt className={LBL}>Notes</dt>
                <dd dir="auto" className="mt-0.5 whitespace-pre-wrap text-muted">
                  {scene.notes}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t-2 border-ink bg-panel-2 px-3 py-2.5">
        {!editing && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(toDraft(scene));
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
        {scene.status !== "approved" && (
          <Button size="sm" variant="primary" busy={busy === "approved"} onClick={() => patch({ status: "approved" }, "approved")}>
            Approve
          </Button>
        )}
        {scene.status !== "rejected" && (
          <Button size="sm" variant="danger" busy={busy === "rejected"} onClick={() => patch({ status: "rejected" }, "rejected")}>
            Reject
          </Button>
        )}
        {(scene.status === "approved" || scene.status === "rejected") && (
          <Button size="sm" variant="ghost" busy={busy === "review"} onClick={() => patch({ status: "review" }, "review")}>
            Back to review
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onHistory}>
          Versions
        </Button>
        <Button size="sm" variant="outline" busy={busy === "regen"} disabled={!regen} onClick={regenerate} title={regenTitle}>
          Regenerate scene
        </Button>
      </div>
    </Card>
  );
}

export default function StoryboardPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useProject();
  const [drawer, setDrawer] = useState<string | null>(null);
  const [regenMap, setRegenMap] = useState<Record<string, { runId: string; nodeId: string }> | null | undefined>(undefined);

  const scenes = useMemo(() => [...(data?.scenes ?? [])].sort((a, b) => a.idx - b.idx), [data?.scenes]);
  const latestRun = useMemo(() => [...(data?.runs ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0], [data?.runs]);
  const latestRunId = latestRun?.id;

  useEffect(() => {
    if (!latestRunId) {
      setRegenMap(null);
      return;
    }
    let cancelled = false;
    api<{ graph: { nodes: { id: string; sceneId?: string }[] } }>(`/api/runs/${latestRunId}`)
      .then((r) => {
        if (cancelled) return;
        const m: Record<string, { runId: string; nodeId: string }> = {};
        for (const n of r.graph?.nodes ?? []) if (n.sceneId) m[n.sceneId] = { runId: latestRunId, nodeId: n.id };
        setRegenMap(m);
      })
      .catch(() => {
        if (!cancelled) setRegenMap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latestRunId]);

  const groups = useMemo(() => {
    const g = new Map<string, SceneLite[]>();
    for (const s of scenes) g.set(s.storyboard, [...(g.get(s.storyboard) ?? []), s]);
    return [...g.entries()];
  }, [scenes]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of scenes) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [scenes]);
  const total = scenes.reduce((a, s) => a + s.durationS, 0);

  const onChanged = useCallback(() => reload(), [reload]);
  const drawerScene = scenes.find((s) => s.id === drawer);

  if (error && !data)
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  if (!data)
    return (
      <div className="space-y-6 p-4 sm:p-6 lg:p-8" role="status" aria-label="loading">
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="hidden h-72 sm:block" />
          <Skeleton className="hidden h-72 xl:block" />
        </div>
      </div>
    );

  if (!scenes.length)
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <Empty
          title="No storyboard yet"
          action={
            <Link href={`/projects/${id}/director`} className={btnCls("primary", "md")}>
              Create storyboard with the AI Director
            </Link>
          }
        >
          The AI Director turns your brief into scenes with narration, on-screen text and visual sources. They will appear here for review.
        </Empty>
      </div>
    );

  const flagged = scenes.filter((s) => typeof s.settings?.visualSource === "string" && visualTone(s.settings.visualSource as string).flagged).length;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Pill tone="info">{scenes.length} scenes</Pill>
        <Pill className="font-mono">total {total.toFixed(1)}s</Pill>
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <StatusBadge status={k} />
            <span className="font-mono text-[13px] font-semibold text-ink">{v}</span>
          </span>
        ))}
        {flagged > 0 && <Pill tone="warn">{flagged} need footage</Pill>}
      </div>

      <Notice tone="info">
        Selective regeneration: each scene is produced by a workflow node tied to its scene id. &quot;Regenerate scene&quot; forces only that node in the latest run
        {latestRun ? ` (${latestRun.workflowName})` : ""}; unchanged scenes are reused from cache and the downstream composition re-renders.
        {regenMap === undefined && latestRun && (
          <span className="ml-2 inline-flex align-middle">
            <Spinner className="size-3" />
          </span>
        )}
      </Notice>
      {flagged > 0 && (
        <Notice tone="warn">
          Scenes flagged &quot;needs footage&quot; want a visual source (placeholder, stock or generated media) that no verified tool can produce; they currently use marked placeholder assets.
        </Notice>
      )}

      {groups.map(([name, list]) => (
        <section key={name} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-ink pb-2">
            <h2 className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.02em]" dir="auto">
              {name || "Storyboard"}
            </h2>
            <span className="nb-label text-muted">
              {list.length} scenes · <span className="font-mono">{list.reduce((a, s) => a + s.durationS, 0).toFixed(1)}s</span>
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((s) => (
              <SceneCard key={s.id} scene={s} regen={regenMap === undefined ? undefined : (regenMap?.[s.id] ?? null)} onChanged={onChanged} onHistory={() => setDrawer(s.id)} />
            ))}
          </div>
        </section>
      ))}

      {drawerScene && (
        <VersionDrawer
          scene={drawerScene}
          onClose={() => setDrawer(null)}
          onUse={async (assetId) => {
            try {
              await api(`/api/scenes/${drawerScene.id}`, { method: "PATCH", json: { selectedAssetId: assetId } });
              toast("Version selected", "ok");
              await reload();
            } catch (e) {
              toast((e as Error).message, "err");
            }
          }}
        />
      )}
    </div>
  );
}
