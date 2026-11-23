"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { ago, api, useApi } from "@/lib/api";
import { Button, Card, CardHeader, Empty, Field, Input, Select, StatusBadge, Textarea, toast } from "@/components/ui";
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
  if (!data) return <div className="p-6 text-xs text-faint">Loading…</div>;
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
    <div className="grid gap-4 p-6 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader title="Workflows" />
        {data.workflows.length === 0 ? (
          <div className="p-4">
            <Empty title="No workflows">Start from a template, a blank canvas, or let the AI Director build one from a brief.</Empty>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {data.workflows.map((w) => {
              const last = data.runs.find((r) => r.workflowId === w.id);
              return (
                <Link key={w.id} href={`/projects/${data.project.slug}/flows/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-2/50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{w.name}</div>
                    <div className="text-[11px] text-faint">
                      {w.nodes} nodes · v{w.version} · {w.source} · edited {ago(w.updatedAt)}
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
        <CardHeader title="New workflow" />
        <div className="space-y-3 p-4">
          <Field label="Start from">
            <Select value={tpl} onChange={(e) => setTpl(e.target.value)} options={[{ value: "", label: "Blank canvas" }, ...(templates.data ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.aspect} · ${x.durationS}s` }))]} />
          </Field>
          {t && <div className="text-xs leading-relaxed text-muted">{t.description}</div>}
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
            <Button variant="primary" busy={busy} onClick={create}>
              <Plus className="size-4" /> Create
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
