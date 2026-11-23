"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { ago, api, useApi } from "@/lib/api";
import { Button, Card, CardHeader, Empty, Field, Input, LoadingRows, Notice, Select, Skeleton, StatusBadge, Textarea, toast } from "@/components/ui";
import { useProject } from "@/components/project-context";

interface Template {
  id: string;
  name: string;
  description: string;
  aspect: string;
  durationS: number;
  vars: { name: string; label: string; type: string; required: boolean; default?: unknown; help?: string }[];
}

export default function FlowsPage() {
  const { data } = useProject();
  const router = useRouter();
  const templates = useApi<Template[]>("/api/templates");
  const [tpl, setTpl] = useState<string>("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data)
    return (
      <div className="grid gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <LoadingRows rows={3} />
        </Card>
        <Skeleton className="h-64" />
      </div>
    );
  const t = templates.data?.find((x) => x.id === tpl);

  const create = async () => {
    setBusy(true);
    try {
      const wf = await api<{ id: string }>(`/api/projects/${data.project.id}/workflows`, {
        method: "POST",
        json: t ? { name: name || t.name, templateId: t.id, vars } : { name: name || "Untitled flow" },
      });
      router.push(`/projects/${data.project.slug}/flows/${wf.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="self-start">
        <CardHeader eyebrow="Library" title="Workflows" />
        {data.workflows.length === 0 ? (
          <div className="p-4">
            <Empty title="No workflows">Start from a template, a blank canvas, or let the AI Director build one from a brief.</Empty>
          </div>
        ) : (
          <ul className="space-y-3 p-3 sm:p-4">
            {data.workflows.map((w) => {
              const last = data.runs.find((r) => r.workflowId === w.id);
              return (
                <li key={w.id}>
                  <Link href={`/projects/${data.project.slug}/flows/${w.id}`} className="nb-lift group flex min-h-16 items-center gap-3 rounded-card border-2 border-ink bg-panel px-4 py-3 shadow-brut-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[16px] font-bold leading-tight text-ink" dir="auto">
                        {w.name}
                      </div>
                      <div className="mt-1 break-words font-mono text-[12px] text-ink/75">
                        {w.nodes} nodes · v{w.version} · {w.source} · edited {ago(w.updatedAt)}
                      </div>
                    </div>
                    {last && <StatusBadge status={last.status} />}
                    <ChevronRight className="size-5 shrink-0 text-ink transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader eyebrow="Create" title="New workflow" />
        <div className="space-y-4 p-4">
          <Field label="Start from">
            <Select value={tpl} onChange={(e) => setTpl(e.target.value)} options={[{ value: "", label: "Blank canvas" }, ...(templates.data ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.aspect} · ${x.durationS}s` }))]} />
          </Field>
          {t && <Notice tone="info">{t.description}</Notice>}
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t?.name ?? "Untitled flow"} />
          </Field>
          {t?.vars.map((v) => (
            <Field key={v.name} label={`${v.label}${v.required ? "" : " (optional)"}`} hint={v.help ?? (v.type === "assetIds" ? "Asset ids, comma or space separated (copy from the Assets tab)" : v.type === "assetId" ? "An asset id from the Assets tab" : undefined)}>
              {v.type === "text" ? (
                <Textarea dir="auto" value={vars[v.name] ?? String(v.default ?? "")} onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })} />
              ) : (
                <Input dir="auto" value={vars[v.name] ?? String(v.default ?? "")} onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })} />
              )}
            </Field>
          ))}
          <div className="flex justify-end">
            <Button variant="primary" size="lg" busy={busy} onClick={create}>
              <Plus className="size-4" /> Create
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
