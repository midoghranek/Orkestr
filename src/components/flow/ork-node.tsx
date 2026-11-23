"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Database, Lock } from "lucide-react";
import type { NodeTypeInfo, PortType } from "@/shared/schema";
import { assetUrl } from "@/lib/api";
import { cn, Progress, StatusBadge } from "../ui";

// Port + family colours are system fills (see DESIGN.md); handles always carry an ink outline and a text label.
export const PORT_COLORS: Record<PortType, string> = {
  text: "#fffcf5",
  json: "#eae2d1",
  image: "#b9d3ff",
  video: "#ffd23f",
  audio: "#9bebc4",
  subtitle: "#d6c8ff",
  storyboard: "#ffb8a6",
  any: "#8a7f6c",
};

export const FAMILY_COLORS: Record<string, string> = {
  ai: "#d6c8ff",
  image: "#b9d3ff",
  video: "#ffd23f",
  audio: "#9bebc4",
  production: "#cdeffd",
  logic: "#eae2d1",
};

export interface OrkNodeData extends Record<string, unknown> {
  type: string;
  label?: string;
  params: Record<string, unknown>;
  sceneId?: string;
  retry?: { maxAttempts?: number; backoffMs?: number };
  info?: NodeTypeInfo;
  run?: { status: string; progress: number; message: string | null; attempt: number; maxAttempts: number; cached: boolean; error?: string; previewAssetId?: string; previewKind?: string };
  issues?: string[];
}

function OrkNodeImpl({ data, selected }: NodeProps & { data: OrkNodeData }) {
  const info = data.info;
  const run = data.run;
  const rows = Math.max(info?.inputs.length ?? 0, info?.outputs.length ?? 0);
  return (
    <div
      className={cn(
        "w-[220px] overflow-hidden rounded-card border-2 bg-panel text-ink transition-shadow",
        selected ? "border-ink shadow-brut-accent outline outline-2 outline-offset-2 outline-ink" : data.issues?.length ? "border-err shadow-brut-sm" : "border-ink shadow-brut-sm",
        info && !info.available && "opacity-75",
      )}
    >
      <div className="flex items-center gap-2 border-b-2 border-ink px-2.5 py-1.5" style={{ background: FAMILY_COLORS[info?.family ?? "logic"] }}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold leading-tight">{data.label || info?.label || data.type}</div>
          <div className="truncate font-mono text-[11px] text-ink/70">{data.type}</div>
        </div>
        {info?.paid && <Lock className="size-3.5" aria-label="paid: needs approval" />}
        {info && !info.available && <AlertTriangle className="size-3.5" aria-label={info.unavailableReason} />}
        {run?.cached && <Database className="size-3.5" aria-label="reused from cache" />}
      </div>
      {run?.previewAssetId && (run.previewKind === "image" || run.previewKind === "video") && (
        <div className="aspect-video overflow-hidden border-b-2 border-ink bg-ink">
          {run.previewKind === "image" ? <img src={assetUrl(run.previewAssetId)} alt="" className="h-full w-full object-cover" /> : <video src={assetUrl(run.previewAssetId)} muted className="h-full w-full object-cover" preload="metadata" />}
        </div>
      )}
      <div className="relative py-1.5" style={{ minHeight: rows * 20 + 6 }}>
        {info?.inputs.map((p, i) => (
          <div key={`in-${p.name}`} className="absolute left-0 flex h-5 items-center" style={{ top: 4 + i * 20 }}>
            <Handle type="target" position={Position.Left} id={p.name} style={{ background: PORT_COLORS[p.type], borderColor: "#17140f", borderWidth: 2, width: 12, height: 12, left: -6 }} />
            <span className="pl-2.5 font-mono text-[11px] text-muted">
              {p.name}
              {p.multiple ? "[]" : ""}
              {p.optional ? "?" : ""}
            </span>
          </div>
        ))}
        {info?.outputs.map((p, i) => (
          <div key={`out-${p.name}`} className="absolute right-0 flex h-5 items-center" style={{ top: 4 + i * 20 }}>
            <span className="pr-2.5 font-mono text-[11px] text-muted">{p.name}</span>
            <Handle type="source" position={Position.Right} id={p.name} style={{ background: PORT_COLORS[p.type], borderColor: "#17140f", borderWidth: 2, width: 12, height: 12, right: -6 }} />
          </div>
        ))}
      </div>
      {run && (
        <div className="space-y-1.5 border-t-2 border-ink bg-bg px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <StatusBadge status={run.status} />
            {run.attempt > 1 && <span className="font-mono text-[11px] text-faint">try {run.attempt}/{run.maxAttempts}</span>}
          </div>
          {run.status === "running" && <Progress value={run.progress} indeterminate={run.progress === 0} tone="info" />}
          {run.message && run.status === "running" && <div className="truncate text-[11px] text-muted">{run.message}</div>}
          {run.error && <div className="line-clamp-2 text-[11px] text-err">{run.error}</div>}
        </div>
      )}
    </div>
  );
}

export const OrkNode = memo(OrkNodeImpl);
