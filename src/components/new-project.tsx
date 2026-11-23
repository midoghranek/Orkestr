"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Dialog, Field, Input, Textarea, toast } from "./ui";

export function NewProjectButton({ variant = "primary", size = "md" }: { variant?: "primary" | "ink" | "default"; size?: "sm" | "md" | "lg" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", description: "", productUrl: "", language: "", budgetUsd: "0" });
  const router = useRouter();
  const close = useCallback(() => setOpen(false), []);
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
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New project
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="New project"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!f.name.trim()} busy={busy} onClick={submit}>
              Create project
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (f.name.trim()) void submit();
          }}
        >
          <Field label="Name">
            <Input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Spring launch film" />
          </Field>
          <Field label="Description">
            <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-16" />
          </Field>
          <Field label="Product URL" hint="Optional. Used for real UI captures (Playwright).">
            <Input type="url" value={f.productUrl} onChange={(e) => setF({ ...f, productUrl: e.target.value })} placeholder="https://…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Language">
              <Input value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} placeholder="Egyptian Arabic" />
            </Field>
            <Field label="Budget (USD)" hint="Cap for paid steps">
              <Input type="number" min={0} value={f.budgetUsd} onChange={(e) => setF({ ...f, budgetUsd: e.target.value })} />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      </Dialog>
    </>
  );
}
