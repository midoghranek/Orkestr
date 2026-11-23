"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Database, Lock } from "lucide-react";
import type { NodeTypeInfo, PortType } from "@/shared/schema";
import { assetUrl } from "@/lib/api";
import { cn, Progress, StatusBadge } from "../ui";

export const PORT_COLORS: Record<PortType, string> = {
  text: "#c9c3b8",
  json: "#9aa0a8",
  image: "#6aa7e8",
  video: "#e0a458",
  audio: "#5fbf8f",
  subtitle: "#c792ea",
  storyboard: "#e5675e",
  any: "#6b717a",
};

const FAMILY_COLORS: Record<string, string> = {
  ai: "#c792ea",
  image: "#6aa7e8",
  video: "#e0a458",
  audio: "#5fbf8f",
  production: "#e8e6e3",
  logic: "#9aa0a8",
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
        "w-[220px] rounded-lg border bg-panel text-fg shadow-lg",
        selected ? "border-accent" : data.issues?.length ? "border-err/60" : "border-line-strong",
        info && !info.available && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2 rounded-t-lg border-b border-line px-2.5 py-1.5" style={{ boxShadow: `inset 3px 0 0 ${FAMILY_COLORS[info?.family ?? "logic"]}` }}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{data.label || info?.label || data.type}</div>
          <div className="truncate text-[10px] text-faint">{data.type}</div>
        </div>
        {info?.paid && <Lock className="size-3 text-paid" aria-label="paid: needs approval" />}
        {info && !info.available && <AlertTriangle className="size-3 text-warn" aria-label={info.unavailableReason} />}
        {run?.cached && <Database className="size-3 text-info" aria-label="reused from cache" />}
      </div>
      {run?.previewAssetId && (run.previewKind === "image" || run.previewKind === "video") && (
        <div className="aspect-video overflow-hidden bg-black">
          {run.previewKind === "image" ? <img src={assetUrl(run.previewAssetId)} alt="" className="h-full w-full object-cover" /> : <video src={assetUrl(run.previewAssetId)} muted className="h-full w-full object-cover" preload="metadata" />}
        </div>
      )}
      <div className="relative py-1.5" style={{ minHeight: rows * 20 + 6 }}>
        {info?.inputs.map((p, i) => (
          <div key={`in-${p.name}`} className="absolute left-0 flex h-5 items-center" style={{ top: 4 + i * 20 }}>
            <Handle type="target" position={Position.Left} id={p.name} style={{ background: PORT_COLORS[p.type], borderColor: "#0e0f11", width: 10, height: 10, left: -5 }} />
            <span className="pl-2.5 text-[10px] text-muted">
              {p.name}
              {p.multiple ? "[]" : ""}
              {p.optional ? "?" : ""}
            </span>
          </div>
        ))}
        {info?.outputs.map((p, i) => (
          <div key={`out-${p.name}`} className="absolute right-0 flex h-5 items-center" style={{ top: 4 + i * 20 }}>
            <span className="pr-2.5 text-[10px] text-muted">{p.name}</span>
            <Handle type="source" position={Position.Right} id={p.name} style={{ background: PORT_COLORS[p.type], borderColor: "#0e0f11", width: 10, height: 10, right: -5 }} />
          </div>
        ))}
      </div>
      {run && (
        <div className="space-y-1 border-t border-line px-2.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <StatusBadge status={run.status} />
            {run.attempt > 1 && <span className="text-[10px] text-faint">try {run.attempt}/{run.maxAttempts}</span>}
          </div>
          {run.status === "running" && <Progress value={run.progress} indeterminate={run.progress === 0} tone="info" />}
          {run.message && run.status === "running" && <div className="truncate text-[10px] text-muted">{run.message}</div>}
          {run.error && <div className="line-clamp-2 text-[10px] text-err">{run.error}</div>}
        </div>
      )}
    </div>
  );
}

export const OrkNode = memo(OrkNodeImpl);
