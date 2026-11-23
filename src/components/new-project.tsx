"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Field, Input, Textarea, toast } from "./ui";

export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", description: "", productUrl: "", language: "", budgetUsd: "0" });
  const router = useRouter();
  const submit = async () => {
    setBusy(true);
    try {
      const p = await api<{ slug: string }>("/api/projects", {
        method: "POST",
        json: { name: f.name, description: f.description, budgetUsd: Number(f.budgetUsd) || 0, settings: { productUrl: f.productUrl || undefined, language: f.language || undefined, verifiedClaims: [] } },
      });
      setOpen(false);
      router.push(`/projects/${p.slug}`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New project
      </Button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New project">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">New project</div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <Field label="Name">
                <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Spring launch film" />
              </Field>
              <Field label="Description">
                <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-14" />
              </Field>
              <Field label="Product URL" hint="Optional. Used for real UI captures (Playwright).">
                <Input value={f.productUrl} onChange={(e) => setF({ ...f, productUrl: e.target.value })} placeholder="https://…" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Language">
                  <Input value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} placeholder="Egyptian Arabic" />
                </Field>
                <Field label="Budget (USD)" hint="Cap for paid steps">
                  <Input type="number" min={0} value={f.budgetUsd} onChange={(e) => setF({ ...f, budgetUsd: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!f.name.trim()} busy={busy} onClick={submit}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
