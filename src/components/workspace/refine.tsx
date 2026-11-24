"use client";

import { useState } from "react";
import { History, RotateCcw, Send, Sparkles } from "lucide-react";
import type { WorkspaceView } from "@/server/producer";
import { ApiError, ago, api } from "@/lib/api";
import { Button, cn, toast } from "@/components/ui";

const BASE_SUGGESTIONS = ["Make it shorter", "Slower, more cinematic", "Make the text easier to read", "Make the first 3 seconds more exciting"];

const SOURCE_LABEL: Record<string, string> = { ai: "AI Director", recipe: "First draft", qa: "Auto-improved", edit: "Your change", restore: "Restored" };

/**
 * Conversational refinement. Common requests are understood locally (free, instant); creative rewrites can use
 * the AI Director, which is asked for explicitly because its price is only known afterwards.
 */
export function RefinePanel({ view, onChanged }: { view: WorkspaceView; onChanged: () => void }) {
  const prod = view.production!;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [needAi, setNeedAi] = useState<string | null>(null);
  const [log, setLog] = useState<{ you: string; reply: string }[]>([]);
  // Suggestions prefill the box (nothing changes until you send), and only offer what makes sense for this plan.
  const suggestions = [...BASE_SUGGESTIONS, ...(view.plan?.deliverables.some((d) => d.aspect === "9:16") ? [] : ["Make an Instagram version"]), "Change the call to action to "];
  const send = async (instruction: string, allowAi = false) => {
    if (!instruction.trim()) return;
    setBusy(true);
    setNeedAi(null);
    try {
      const r = await api<{ summary: string; changes: string[]; rerendering: boolean; usedAi: boolean }>(`/api/productions/${prod.id}/refine`, { method: "POST", json: { instruction, allowAi } });
      setLog((l) => [...l, { you: instruction, reply: `${r.summary || r.changes.join(" ")}${r.rerendering ? " Re-rendering only what changed." : ""}${r.usedAi ? " (AI Director; cost recorded.)" : ""}` }]);
      setText("");
      onChanged();
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof ApiError && e.status === 422 && /Use AI Director/.test(msg)) setNeedAi(instruction);
      else setLog((l) => [...l, { you: instruction, reply: msg }]);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (planId: string) => {
    try {
      await api(`/api/productions/${prod.id}/restore`, { method: "POST", json: { planId } });
      toast("Version restored.", "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="space-y-4">
      <section className="rounded-card border-2 border-ink bg-panel" aria-labelledby="refine-h">
        <div className="border-b-2 border-ink/10 px-4 py-3">
          <h2 id="refine-h" className="font-display text-[17px] font-bold text-ink">
            Refine
          </h2>
          <p className="text-[12px] text-muted">Say what to change. Unchanged parts are reused, not re-made.</p>
        </div>
        {log.length > 0 && (
          <ol className="max-h-64 space-y-2 overflow-y-auto px-4 py-3 text-[13px]" aria-live="polite">
            {log.map((m, i) => (
              <li key={i} className="space-y-1">
                <p className="ms-6 rounded-ctl bg-accent/40 px-2.5 py-1.5 text-ink" dir="auto">
                  {m.you}
                </p>
                <p className="me-6 rounded-ctl bg-panel-2 px-2.5 py-1.5 text-ink" dir="auto">
                  {m.reply}
                </p>
              </li>
            ))}
          </ol>
        )}
        <form
          className="p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <label htmlFor="refine-input" className="sr-only">
            Describe a change
          </label>
          <div className="flex items-end gap-2 rounded-ctl border-2 border-ink bg-white p-1.5 focus-within:shadow-brut-accent">
            <textarea
              id="refine-input"
              dir="auto"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder="e.g. make it 15 seconds, bigger text"
              className="min-h-10 flex-1 resize-none bg-transparent px-1.5 py-1 text-[14px] outline-none"
            />
            <Button variant="primary" size="sm" type="submit" busy={busy} disabled={!text.trim()} aria-label="Apply change">
              <Send className="size-3.5" />
            </Button>
          </div>
          {needAi && (
            <div className="mt-2 rounded-ctl border-2 border-ink bg-info-fill/40 p-2.5 text-[13px]">
              This needs the AI Director to rewrite copy. It runs on your Claude plan; the cost is shown after.
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" busy={busy} onClick={() => void send(needAi, true)}>
                  <Sparkles className="size-3.5" /> Use AI Director
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNeedAi(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => { setText(s); document.getElementById("refine-input")?.focus(); }} disabled={busy} className="rounded-full border-2 border-ink/20 bg-panel px-2.5 py-1 text-[12px] font-medium text-ink hover:border-ink disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        </form>
      </section>

      {view.versions.length > 1 && (
        <section className="rounded-card border-2 border-ink/15 bg-panel" aria-labelledby="versions-h">
          <h2 id="versions-h" className="flex items-center gap-2 border-b-2 border-ink/10 px-4 py-2.5 font-display text-[15px] font-bold">
            <History className="size-4" aria-hidden /> Versions
          </h2>
          <ol className="divide-y divide-ink/10">
            {view.versions.map((v) => (
              <li key={v.id} className={cn("flex items-start gap-2 px-4 py-2.5 text-[13px]", v.current && "bg-accent/15")}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">
                    {SOURCE_LABEL[v.source] ?? v.source} {v.current && <span className="ms-1 font-mono text-[11px] font-normal text-muted">current</span>}
                  </div>
                  {v.note && (
                    <div className="line-clamp-2 text-[12px] text-muted" dir="auto">
                      {v.note}
                    </div>
                  )}
                  <div className="font-mono text-[11px] text-faint">{ago(v.createdAt)}</div>
                </div>
                {!v.current && (
                  <button type="button" onClick={() => void restore(v.id)} className="inline-flex shrink-0 items-center gap-1 rounded-ctl border-2 border-ink/20 px-2 py-1 text-[12px] font-semibold hover:border-ink" aria-label={`Restore version from ${ago(v.createdAt)}`}>
                    <RotateCcw className="size-3" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
