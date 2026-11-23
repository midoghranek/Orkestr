import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GraphSchema, type Graph } from "@/shared/schema";
import { ROOT_DIR } from "./util/paths";

/**
 * Workflow templates live as editable JSON in /templates. Strings of the exact form "{{var}}" are replaced
 * by the typed value (so numbers/arrays survive); "{{var}}" inside longer strings is interpolated.
 */
export const TemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  aspect: z.string(),
  durationS: z.number(),
  vars: z.array(z.object({ name: z.string().regex(/^[A-Za-z0-9_]+$/), label: z.string(), type: z.enum(["string", "url", "number", "assetId", "assetIds", "text"]), required: z.boolean().default(true), default: z.unknown().optional(), help: z.string().optional() })),
  graph: z.unknown(),
});
export type Template = z.infer<typeof TemplateSchema>;

export function templatesDir(): string {
  return path.join(ROOT_DIR, "templates");
}

export function listTemplates(): Template[] {
  const dir = templatesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => TemplateSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getTemplate(id: string): Template | undefined {
  return listTemplates().find((t) => t.id === id);
}

function substitute(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = /^\{\{([A-Za-z0-9_]+)\}\}$/.exec(value);
    if (whole) return vars[whole[1]];
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_m, k: string) => (vars[k] === undefined ? "" : String(vars[k])));
  }
  if (Array.isArray(value)) {
    // Arrays of "{{assetIds}}" placeholders expand in place.
    return value.flatMap((v) => {
      const r = substitute(v, vars);
      return typeof v === "string" && /^\{\{[A-Za-z0-9_]+\}\}$/.test(v) && Array.isArray(r) ? r : [r];
    });
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = substitute(v, vars);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

/** Instantiate a template. `assetIds` vars expand `production.import` nodes marked with `"$each": "<var>"`. */
export function instantiate(t: Template, input: Record<string, unknown>): Graph {
  const vars: Record<string, unknown> = {};
  for (const v of t.vars) {
    const val = input[v.name] ?? v.default;
    if (v.required && (val === undefined || val === "" || (Array.isArray(val) && val.length === 0))) throw new Error(`template variable "${v.name}" is required`);
    if (v.type === "number" && val !== undefined) vars[v.name] = Number(val);
    else if (v.type === "assetIds") vars[v.name] = Array.isArray(val) ? val : typeof val === "string" ? val.split(/[\s,]+/).filter(Boolean) : [];
    else vars[v.name] = val;
  }
  const raw = t.graph as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } & Record<string, unknown>;
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [...raw.edges];
  for (const n of raw.nodes) {
    const each = n.$each as string | undefined;
    if (!each) {
      nodes.push(n);
      continue;
    }
    // Fan out one import node per asset id, re-pointing the template edges from the prototype.
    const ids = (vars[each] as string[]) ?? [];
    const proto = n.id as string;
    const protoEdges = edges.filter((e) => e.source === proto);
    ids.forEach((assetId, i) => {
      const id = `${proto}${i + 1}`;
      nodes.push({ ...n, $each: undefined, id, label: `${n.label ?? "Asset"} ${i + 1}`, params: { ...(n.params as object), assetId }, position: { x: (n.position as { x: number }).x, y: (n.position as { y: number }).y + i * 120 } });
      for (const e of protoEdges) edges.push({ ...e, id: `${e.id}_${i + 1}`, source: id });
    });
    for (const e of protoEdges) edges.splice(edges.indexOf(e), 1);
  }
  const g = substitute({ ...raw, nodes: nodes.map(({ $each: _ignored, ...rest }) => rest), edges }, vars);
  return GraphSchema.parse({ ...(g as object), meta: { template: t.id } });
}
