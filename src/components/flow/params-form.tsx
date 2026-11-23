"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select, Textarea, inputCls } from "../ui";

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
  anyOf?: JsonSchema[];
  description?: string;
}

function baseType(s: JsonSchema): string | undefined {
  if (s.enum) return "enum";
  if (Array.isArray(s.type)) return s.type.find((t) => t !== "null");
  if (s.type) return s.type;
  const first = s.anyOf?.find((x) => x.type !== "null");
  return first ? baseType(first) : undefined;
}

/** Form generated from a node's JSON Schema. Complex values fall back to a validated JSON editor. */
export function ParamsForm({ schema, value, onChange }: { schema: JsonSchema; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const props = schema.properties ?? {};
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const keys = Object.keys(props);
  if (!keys.length) return <div className="text-[13px] text-faint">No parameters.</div>;
  return (
    <div className="space-y-4">
      {keys.map((k) => {
        const s = props[k];
        const t = baseType(s);
        const v = value[k];
        const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        const ph = s.default !== undefined ? `default: ${typeof s.default === "object" ? JSON.stringify(s.default) : String(s.default)}` : undefined;
        if (t === "enum")
          return (
            <Field key={k} label={label}>
              <Select value={v === undefined ? "" : String(v)} onChange={(e) => set(k, e.target.value || undefined)} options={[{ value: "", label: ph ?? "—" }, ...(s.enum ?? []).map((o) => ({ value: String(o), label: String(o) }))]} />
            </Field>
          );
        if (t === "boolean")
          return (
            <label key={k} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-ctl border-2 border-ink bg-white/70 px-3 py-1.5 text-[14px] font-medium text-ink">
              <input type="checkbox" checked={v === undefined ? !!s.default : !!v} onChange={(e) => set(k, e.target.checked)} className="size-5 shrink-0 cursor-pointer accent-[var(--color-ink)]" />
              {label}
            </label>
          );
        if (t === "number" || t === "integer")
          return (
            <Field key={k} label={label} hint={s.minimum !== undefined || s.maximum !== undefined ? `${s.minimum ?? "−∞"} … ${s.maximum ?? "∞"}` : undefined}>
              <Input type="number" step={t === "integer" ? 1 : "any"} value={v === undefined ? "" : String(v)} placeholder={ph} onChange={(e) => set(k, e.target.value === "" ? undefined : Number(e.target.value))} />
            </Field>
          );
        if (t === "string")
          return (
            <Field key={k} label={label}>
              {(s.maxLength ?? 0) > 300 ? (
                <Textarea dir="auto" value={(v as string) ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
              ) : (
                <Input dir="auto" value={(v as string) ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
              )}
            </Field>
          );
        if (t === "array" && s.items && baseType(s.items) === "string")
          return (
            <Field key={k} label={label} hint="One per line">
              <Textarea dir="auto" className="min-h-14" value={Array.isArray(v) ? (v as string[]).join("\n") : ""} onChange={(e) => set(k, e.target.value ? e.target.value.split("\n") : undefined)} />
            </Field>
          );
        return <JsonField key={k} label={label} value={v} onChange={(x) => set(k, x)} />;
      })}
    </div>
  );
}

function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(value === undefined ? "" : JSON.stringify(value, null, 2));
  }, [value]);
  return (
    <Field label={`${label} (JSON)`} hint={err ? <span role="alert" className="font-semibold text-err">{err}</span> : undefined}>
      <textarea
        dir="auto"
        className={`${inputCls} min-h-28 resize-y font-mono text-[12px] leading-relaxed`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setErr(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(text));
            setErr(null);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      />
    </Field>
  );
}
