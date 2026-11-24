"use client";

import Link from "next/link";
import { useState } from "react";
import { ago, api, fmtBytes, fmtUsd } from "@/lib/api";
import { ArrowRight, Pencil, Workflow } from "lucide-react";
import { AssetPreview, Button, Card, CardHeader, Empty, Field, Input, LoadingRows, Notice, Progress, StatusBadge, Textarea, btnCls, linkCls, toast } from "@/components/ui";
import { useProject } from "@/components/project-context";

export default function ProjectOverview() {
  const { data, reload } = useProject();
  const [editing, setEditing] = useState(false);
  if (!data) return <LoadingRows rows={4} className="p-4 sm:p-6 lg:p-8" />;
  const { project, costs, runs, workflows, approvals, exports, assets, scenes } = data;
  const base = `/projects/${project.slug}`;
  const budgetUsed = project.budgetUsd > 0 ? costs.actualKnownUsd / project.budgetUsd : 0;

  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-3">
      <div className="min-w-0 space-y-6 xl:col-span-2">
        {approvals.length > 0 && (
          <Notice tone="warn">
            <strong>
              {approvals.length} step{approvals.length > 1 ? "s" : ""} waiting for your approval.
            </strong>{" "}
            <Link href="/queue" className={linkCls}>
              Review in the render queue <ArrowRight className="size-3.5" />
            </Link>
          </Notice>
        )}
        <Card>
          <CardHeader
            title="Workflows"
            sub="Visual flows that produce this project's assets."
            actions={
              <Link href={`${base}/flows`} className={btnCls("default", "sm")}>
                Open flows
              </Link>
            }
          />
          {workflows.length === 0 ? (
            <div className="p-4">
              <Empty title="No workflow yet" icon={<Workflow className="size-6" />} action={<Link href={`${base}/director`} className={btnCls("primary")}>Plan with the AI Director</Link>}>
                Describe what you want; the AI Director proposes a script and storyboard and builds a validated workflow from the tools that actually work here.
              </Empty>
            </div>
          ) : (
            <div className="divide-y-2 divide-line">
              {workflows.map((w) => {
                const last = runs.find((r) => r.workflowId === w.id);
                return (
                  <Link key={w.id} href={`${base}/flows/${w.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{w.name}</div>
                      <div className="font-mono text-[12px] text-faint">
                        {w.nodes} nodes · v{w.version} · {w.source} · {ago(w.updatedAt)}
                      </div>
                    </div>
                    {last && <StatusBadge status={last.status} />}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent runs" />
          {runs.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-muted">No runs yet. Open a workflow and press Run.</div>
          ) : (
            <div className="divide-y-2 divide-line">
              {runs.slice(0, 8).map((r) => (
                <Link key={r.id} href={`${base}/flows/${r.workflowId}?run=${r.id}`} className="block px-4 py-3 transition-colors hover:bg-panel-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{r.workflowName}</span>
                    <span className="order-last w-full font-mono text-[12px] text-faint sm:order-none sm:w-auto">{Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <Progress className="mt-2" label={`${r.workflowName} progress`} value={r.progress} tone={r.status === "failed" ? "err" : r.status === "completed" ? "ok" : "accent"} indeterminate={r.status === "running" && r.progress === 0} />
                  {r.error && <div className="mt-1.5 truncate text-[12px] text-err">{r.error}</div>}
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Latest assets" sub={`${data.assetCount} in library`} actions={<Link href={`${base}/assets`} className={linkCls}>Asset library <ArrowRight className="size-3.5" /></Link>} />
          {assets.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-muted">No assets yet. Upload brand visuals in Assets.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 p-4 md:grid-cols-6">
              {assets.filter((a) => ["image", "video"].includes(a.kind)).slice(0, 12).map((a) => (
                <div key={a.id} className="aspect-video overflow-hidden rounded-ctl border-2 border-ink bg-ink" title={a.label}>
                  <AssetPreview asset={a} controls={false} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="Spend" sub="Actuals reported by providers; unknown prices are listed, never guessed." />
          <div className="space-y-3 p-4">
            <div className="flex items-baseline justify-between">
              <span className="nb-label text-muted">Known spend</span>
              <span className="font-display text-[32px] font-extrabold leading-none tabular-nums">{fmtUsd(costs.actualKnownUsd)}</span>
            </div>
            {project.budgetUsd > 0 && (
              <div>
                <Progress label="Budget used" value={Math.min(1, budgetUsed)} tone={budgetUsed > 0.9 ? "err" : "accent"} />
                <div className="mt-1.5 font-mono text-[12px] text-faint">{Math.round(budgetUsed * 100)}% of {fmtUsd(project.budgetUsd)} budget</div>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t-2 border-line pt-3">
              {(
                [
                  ["Unknown-price calls", costs.actualUnknownCount],
                  ["Reused results", costs.reusedCount],
                  ["Tokens in/out", `${costs.tokensIn}/${costs.tokensOut}`],
                  ["Billable calls", costs.apiCalls],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[12px] text-faint">{k}</dt>
                  <dd className="font-mono text-[14px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {costs.byProvider.length > 0 && (
              <div className="divide-y-2 divide-line rounded-ctl border-2 border-ink font-mono text-[12px]">
                {costs.byProvider.map((p) => (
                  <div key={p.provider} className="flex justify-between gap-2 px-2.5 py-1.5">
                    <span className="text-muted">{p.provider}</span>
                    <span>
                      {fmtUsd(p.actualUsd)}
                      {p.unknown ? ` + ${p.unknown} unknown` : ""}
                      {p.units ? ` · ${p.quantity} ${p.units}s` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Storyboard" actions={<Link href={`${base}/storyboard`} className={linkCls}>Open <ArrowRight className="size-3.5" /></Link>} />
          <div className="p-4 text-[13px] text-muted">
            {scenes.length ? (
              <>
                <div className="font-mono text-[12px]">
                  {scenes.length} scenes · {scenes.reduce((s, x) => s + x.durationS, 0).toFixed(1)}s · {scenes.filter((s) => s.status === "approved").length} approved
                </div>
                {/* Strip: width = duration; fill + glyph = status, so it never relies on colour alone */}
                <div className="mt-2 flex h-7 overflow-hidden rounded-ctl border-2 border-ink" role="list" aria-label="Scene status by duration">
                  {scenes.map((s) => (
                    <div
                      role="listitem"
                      key={s.id}
                      style={{ flex: s.durationS }}
                      className={`flex min-w-0 items-center justify-center border-r-2 border-ink font-mono text-[11px] font-semibold text-ink last:border-r-0 ${s.status === "approved" ? "bg-ok-fill" : s.status === "review" ? "bg-accent" : s.status === "failed" ? "bg-err-fill" : "bg-panel-2"}`}
                      title={`${s.idx + 1}. ${s.title} — ${s.status}`}
                    >
                      <span aria-hidden>{s.status === "approved" ? "✓" : s.status === "failed" ? "✕" : s.status === "review" ? "?" : s.idx + 1}</span>
                      <span className="sr-only">{`Scene ${s.idx + 1} ${s.title}: ${s.status}`}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              "No storyboard yet."
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Exports" />
          {exports.length === 0 ? (
            <div className="px-4 py-4 text-[13px] text-muted">Nothing exported yet. Export nodes write here after final approval.</div>
          ) : (
            <div className="divide-y-2 divide-line">
              {exports.map((e) => (
                <a key={e.name} href={`/api/exports/file?projectId=${project.id}&name=${encodeURIComponent(e.name)}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] font-semibold transition-colors hover:bg-panel-2">
                  <span className="truncate">{e.name}</span>
                  <span className="shrink-0 font-mono text-[12px] font-normal text-faint">{fmtBytes(e.size)}</span>
                </a>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Brand & facts" sub="The AI may only claim what is listed here." actions={<Button size="sm" variant="outline" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Close" : <><Pencil className="size-3.5" /> Edit</>}</Button>} />
          {editing ? (
            <ProjectEditor onSaved={() => { setEditing(false); void reload(); }} />
          ) : (
            <div className="space-y-2 p-4 text-[13px]">
              <Row k="Brand" v={project.settings.brandName} />
              <Row k="Pronounced" v={project.settings.brandPronunciation} rtl />
              <Row k="Language" v={project.settings.language} />
              <Row k="Product URL" v={project.settings.productUrl} />
              <Row k="Budget" v={fmtUsd(project.budgetUsd)} />
              <div>
                <div className="nb-label mt-3 text-faint">Verified claims ({project.settings.verifiedClaims.length})</div>
                <ul className="mt-1.5 list-disc space-y-1 ps-4 text-ink marker:text-faint" dir="auto">
                  {project.settings.verifiedClaims.slice(0, 8).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                {project.settings.verifiedClaims.length > 8 && <div className="text-faint">+{project.settings.verifiedClaims.length - 8} more</div>}
              </div>
              {project.settings.palette && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {Object.entries(project.settings.palette).map(([k, v]) => (
                    <span key={k} title={`${k} ${v}`} className="size-7 rounded-ctl border-2 border-ink" style={{ background: v }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v, rtl }: { k: string; v?: string; rtl?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-faint">{k}</span>
      <span className="min-w-0 break-words font-medium text-ink" dir={rtl ? "rtl" : "auto"}>
        {v || "—"}
      </span>
    </div>
  );
}

function ProjectEditor({ onSaved }: { onSaved: () => void }) {
  const { data } = useProject();
  const p = data!.project;
  const [f, setF] = useState({
    name: p.name,
    description: p.description,
    budgetUsd: String(p.budgetUsd),
    brandName: p.settings.brandName ?? "",
    brandPronunciation: p.settings.brandPronunciation ?? "",
    language: p.settings.language ?? "",
    productUrl: p.settings.productUrl ?? "",
    claims: p.settings.verifiedClaims.join("\n"),
    brandNotes: p.settings.brandNotes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${p.id}`, {
        method: "PATCH",
        json: {
          name: f.name,
          description: f.description,
          budgetUsd: Number(f.budgetUsd) || 0,
          settings: {
            brandName: f.brandName || undefined,
            brandPronunciation: f.brandPronunciation || undefined,
            language: f.language || undefined,
            productUrl: f.productUrl || undefined,
            brandNotes: f.brandNotes || undefined,
            verifiedClaims: f.claims.split("\n").map((s) => s.trim()).filter(Boolean),
          },
        },
      });
      toast("Project saved", "ok");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 p-4">
      <Field label="Name">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Description">
        <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-12" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brand">
          <Input value={f.brandName} onChange={(e) => setF({ ...f, brandName: e.target.value })} />
        </Field>
        <Field label="Pronunciation">
          <Input dir="auto" value={f.brandPronunciation} onChange={(e) => setF({ ...f, brandPronunciation: e.target.value })} />
        </Field>
        <Field label="Language">
          <Input value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} />
        </Field>
        <Field label="Budget USD">
          <Input type="number" min={0} value={f.budgetUsd} onChange={(e) => setF({ ...f, budgetUsd: e.target.value })} />
        </Field>
      </div>
      <Field label="Product URL">
        <Input value={f.productUrl} onChange={(e) => setF({ ...f, productUrl: e.target.value })} />
      </Field>
      <Field label="Verified claims" hint="One per line. The AI Director may only use these product facts.">
        <Textarea dir="auto" value={f.claims} onChange={(e) => setF({ ...f, claims: e.target.value })} />
      </Field>
      <Field label="Brand notes">
        <Textarea value={f.brandNotes} onChange={(e) => setF({ ...f, brandNotes: e.target.value })} className="min-h-14" />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" busy={busy} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
