"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import type { WorkspaceView } from "@/server/producer";
import { assetUrl } from "@/lib/api";
import { cn } from "@/components/ui";
import { ApprovalCard, DownloadLink, StageList } from "./production";

/** The finished piece: big preview, every format one click away, downloads, and honest quality checks. */
export function ResultView({ view, projectId, onChanged }: { view: WorkspaceView; projectId: string; onChanged: () => void }) {
  const items = view.deliverables.filter((d) => d.assetId);
  const [sel, setSel] = useState(0);
  const d = items[Math.min(sel, items.length - 1)];
  const creative = view.creative;
  const tech = view.deliverables.flatMap((x) => x.qa?.issues ?? []);
  const portrait = d && (d.aspect === "9:16" || d.aspect === "4:5");
  return (
    <div className="space-y-5">
      {view.approvals.map((a) => (
        <ApprovalCard key={a.id} a={a} onDone={onChanged} productionId={view.production?.id} />
      ))}
      {d ? (
        <section className="overflow-hidden rounded-card border-2 border-ink bg-ink">
          <div className={cn("mx-auto", portrait ? "max-w-sm" : "")}>
            {d.kind === "video" ? (
              <video key={d.assetId} src={assetUrl(d.assetId!)} controls playsInline preload="metadata" className="block w-full bg-ink" />
            ) : (
              <img key={d.assetId} src={assetUrl(d.assetId!)} alt={d.name} className="block w-full bg-white" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t-2 border-ink bg-panel px-4 py-3">
            <div role="tablist" aria-label="Formats" className="flex flex-wrap gap-1.5">
              {items.map((x, i) => (
                <button
                  key={x.name}
                  role="tab"
                  aria-selected={i === sel}
                  type="button"
                  onClick={() => setSel(i)}
                  className={cn("rounded-ctl border-2 border-ink px-2.5 py-1 text-[13px] font-semibold", i === sel ? "bg-accent" : "bg-white hover:bg-panel-2")}
                >
                  {x.name} <span className="font-mono text-[11px] text-muted">{x.aspect}</span>
                </button>
              ))}
            </div>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {d.exportedFiles.length ? (
                d.exportedFiles.map((f) => <DownloadLink key={f} projectId={projectId} name={f} />)
              ) : (
                <span className="text-[13px] text-muted">{d.status === "approved" ? "Exported" : "Approve the cut to export it"}</span>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-card border-2 border-ink bg-panel p-5">
          <StageList view={view} />
        </section>
      )}

      {(creative || tech.length > 0) && (
        <section className="rounded-card border-2 border-ink/15 bg-panel p-4" aria-labelledby="qa-h">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="qa-h" className="font-display text-[16px] font-bold text-ink">
              Quality checks
            </h3>
            {creative && (
              <span className="font-mono text-[12px] text-muted">
                {creative.passed}/{creative.total} creative checks passed{tech.length ? ` · ${tech.length} technical issue${tech.length > 1 ? "s" : ""}` : view.deliverables.some((x) => x.qa) ? " · technical checks passed" : ""}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-faint">Observable checks on pacing, readability, the hook, the end card, honesty and the rendered files (resolution, frame rate, duration, audio, black frames). They are not a verdict on taste — watch it.</p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {[...(creative?.issues ?? []), ...tech].slice(0, 8).map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                <CircleAlert className={cn("mt-0.5 size-4 shrink-0", i.severity === "critical" ? "text-err" : i.severity === "major" ? "text-warn" : "text-faint")} aria-hidden />
                <span>{i.message}</span>
              </li>
            ))}
            {!creative?.issues.length && !tech.length && (
              <li className="flex items-center gap-2 text-ok">
                <CheckCircle2 className="size-4" aria-hidden /> Nothing flagged.
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
