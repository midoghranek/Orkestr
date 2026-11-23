// One-off generator for the App Router API handlers (kept in repo so routes are reproducible and reviewable).
import fs from "node:fs";
import path from "node:path";

const R = (p, code) => {
  const f = path.join("src/app/api", p, "route.ts");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${code.trim()}\n`);
};

R("system", `
import { route } from "@/server/http";
import { loadRegistry } from "@/server/adapters/registry";
import { getSettings } from "@/server/settings";
import { listCredentials } from "@/server/credentials";
import { workerStatus } from "@/server/views";
import { installedModels } from "@/server/adapters/whisper";
export const dynamic = "force-dynamic";
export const GET = route(async () => ({ registry: loadRegistry() ?? null, settings: getSettings(), credentials: listCredentials(), worker: workerStatus(), whisperModels: installedModels() }));
`);

R("system/discover", `
import { route } from "@/server/http";
import { getDb } from "@/server/db";
import { runDiscovery } from "@/server/adapters/registry";
import { workerStatus } from "@/server/views";
export const dynamic = "force-dynamic";
export const POST = route(async () => {
  // Prefer letting the worker refresh (it owns the process allowlist it executes with); run inline if it is down.
  if (workerStatus().alive) {
    getDb().prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('__discovery_requested', 'true', ?) ON CONFLICT(key) DO UPDATE SET value_json='true', updated_at=excluded.updated_at").run(Date.now());
    return { queued: true };
  }
  return { queued: false, registry: await runDiscovery() };
});
`);

R("system/install-whisper", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { installWhisper } from "@/server/adapters/whisper";
import { emit } from "@/server/events";
export const dynamic = "force-dynamic";
export const POST = route(async (req) => {
  const { model } = z.object({ model: z.enum(["tiny", "base", "small", "medium"]).default("base") }).parse(await body(req));
  emit({ type: "tools.install", message: \`installing whisper.cpp + ggml-\${model} (free download)\` });
  void installWhisper(model, (m) => emit({ type: "tools.install", message: m }))
    .then(() => emit({ type: "tools.install", message: \`whisper model \${model} installed — run discovery to enable it\` }))
    .catch((e: Error) => emit({ level: "error", type: "tools.install", message: \`whisper install failed: \${e.message}\` }));
  return { started: true };
});
`);

R("settings", `
import { body, route } from "@/server/http";
import { SettingsSchema, getSettings, updateSettings } from "@/server/settings";
export const dynamic = "force-dynamic";
export const GET = route(() => getSettings());
export const PUT = route(async (req) => updateSettings(SettingsSchema.partial().parse(await body(req))));
`);

R("credentials/[provider]", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { PROVIDERS, deleteCredential, listCredentials, setCredential } from "@/server/credentials";
export const dynamic = "force-dynamic";
const P = z.enum(PROVIDERS);
export const PUT = route<{ provider: string }>(async (req, { provider }) => {
  const { secret } = z.object({ secret: z.string().min(8).max(512) }).parse(await body(req));
  await setCredential(P.parse(provider), secret);
  return { credentials: listCredentials() };
});
export const DELETE = route<{ provider: string }>(async (_req, { provider }) => {
  deleteCredential(P.parse(provider));
  return { credentials: listCredentials() };
});
`);

R("node-types", `
import { route } from "@/server/http";
import { nodeTypeInfos } from "@/server/engine/node-types";
export const dynamic = "force-dynamic";
export const GET = route(() => nodeTypeInfos());
`);

R("projects", `
import { body, route } from "@/server/http";
import { createProject, listProjects } from "@/server/projects";
export const dynamic = "force-dynamic";
export const GET = route(() => listProjects());
export const POST = route(async (req) => createProject(await body(req)));
`);

R("projects/[id]", `
import { body, notFound, route } from "@/server/http";
import { deleteProject, getProject, updateProject } from "@/server/projects";
import { projectOverview } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => projectOverview(id) ?? notFound("project"));
export const PATCH = route<{ id: string }>(async (req, { id }) => updateProject(id, await body(req)));
export const DELETE = route<{ id: string }>((_req, { id }) => {
  if (!getProject(id)) notFound("project");
  deleteProject(id);
  return { deleted: true };
});
`);

R("projects/[id]/workflows", `
import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { createWorkflow, getProject, listWorkflows } from "@/server/projects";
import { getTemplate, instantiate } from "@/server/templates";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => listWorkflows(id));
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const b = z
    .object({ name: z.string().min(1).max(120), graph: z.unknown().optional(), templateId: z.string().optional(), vars: z.record(z.string(), z.unknown()).default({}) })
    .parse(await body(req));
  if (b.templateId) {
    const t = getTemplate(b.templateId) ?? notFound("template");
    return createWorkflow(id, b.name, instantiate(t, b.vars), \`template:\${t.id}\`);
  }
  return createWorkflow(id, b.name, b.graph ?? { version: 1, nodes: [], edges: [] });
});
`);

R("workflows/[id]", `
import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { deleteWorkflow, getWorkflow, saveWorkflow } from "@/server/projects";
import { validateGraph } from "@/server/engine/validate";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const wf = getWorkflow(id) ?? notFound("workflow");
  return { workflow: wf, validation: validateGraph(wf.graph) };
});
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const b = z.object({ name: z.string().max(120).optional(), graph: z.unknown().optional(), expectedVersion: z.number().int().optional() }).parse(await body(req));
  const wf = saveWorkflow(id, b);
  return { workflow: wf, validation: validateGraph(wf.graph) };
});
export const DELETE = route<{ id: string }>((_req, { id }) => {
  deleteWorkflow(id);
  return { deleted: true };
});
`);

R("workflows/validate", `
import { body, route } from "@/server/http";
import { validateGraph } from "@/server/engine/validate";
export const dynamic = "force-dynamic";
export const POST = route(async (req) => validateGraph(await body(req)));
`);

R("workflows/[id]/run", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { createRun } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = z.object({ preauthorizedUsd: z.number().min(0).max(10000).default(0), forceNodes: z.array(z.string().max(64)).max(500).default([]) }).parse(await body(req));
  return { runId: createRun(id, b) };
});
`);

R("runs", `
import { route } from "@/server/http";
import { listRuns } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  return listRuns({ projectId: u.get("projectId") ?? undefined, workflowId: u.get("workflowId") ?? undefined, status: u.get("status") ?? undefined, limit: Math.min(200, Number(u.get("limit") ?? 50)) });
});
`);

R("runs/[id]", `
import { notFound, route } from "@/server/http";
import { runDetail } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => runDetail(id) ?? notFound("run"));
`);

R("runs/[id]/cancel", `
import { route } from "@/server/http";
import { requestCancel } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>((_req, { id }) => {
  requestCancel(id);
  return { cancelling: true };
});
`);

R("runs/[id]/retry", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { retryFailed } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { nodeIds } = z.object({ nodeIds: z.array(z.string().max(64)).max(500).optional() }).parse(await body(req));
  retryFailed(id, nodeIds);
  return { retrying: true };
});
`);

R("runs/[id]/rerun", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { rerunNodes } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { nodeIds } = z.object({ nodeIds: z.array(z.string().max(64)).min(1).max(500) }).parse(await body(req));
  return { runId: rerunNodes(id, nodeIds) };
});
`);

R("approvals", `
import { route } from "@/server/http";
import { listApprovals } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  return listApprovals({ status: u.get("status") ?? undefined, projectId: u.get("projectId") ?? undefined, runId: u.get("runId") ?? undefined });
});
`);

R("approvals/[id]", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { decideApproval } from "@/server/views";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional() }).parse(await body(req));
  return decideApproval(id, b.decision, b.note);
});
`);

R("assets", `
import { HttpError, route } from "@/server/http";
import { listAssets } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  const projectId = u.get("projectId");
  if (!projectId) throw new HttpError(400, "projectId required");
  return listAssets(projectId, { kind: u.get("kind") ?? undefined, sceneId: u.get("sceneId") ?? undefined, limit: Math.min(1000, Number(u.get("limit") ?? 500)) });
});
`);

R("assets/[id]", `
import { notFound, route } from "@/server/http";
import { getAsset, lineage } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const a = getAsset(id) ?? notFound("asset");
  return { asset: a, lineage: lineage(id) };
});
`);

R("assets/[id]/file", `
import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, guard, HttpError } from "@/server/http";
import { getAsset } from "@/server/assets";
import { assetsDir, resolveInside } from "@/server/util/paths";
import path from "node:path";
export const dynamic = "force-dynamic";

/** Streams an asset with HTTP Range support (video scrubbing). Only files inside the asset store are served. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    guard(req);
    const { id } = await ctx.params;
    const a = getAsset(id);
    if (!a) throw new HttpError(404, "asset not found");
    const file = resolveInside(assetsDir(), path.relative(assetsDir(), a.path));
    const size = fs.statSync(file).size;
    const headers: Record<string, string> = { "Content-Type": a.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
    if (req.nextUrl.searchParams.get("download")) headers["Content-Disposition"] = \`attachment; filename="\${encodeURIComponent(a.label.replace(/[^\\w.-]+/g, "_"))}\${path.extname(file)}"\`;
    const m = /bytes=(\\d*)-(\\d*)/.exec(req.headers.get("range") ?? "");
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": \`bytes */\${size}\` } });
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
      return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": \`bytes \${start}-\${end}/\${size}\`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
  } catch (e) {
    return errorResponse(e);
  }
}
`);

R("projects/[id]/assets/upload", `
import fs from "node:fs";
import path from "node:path";
import { HttpError, notFound, route } from "@/server/http";
import { getProject } from "@/server/projects";
import { kindFromExt, registerFile } from "@/server/assets";
import { workDir, safeFileName } from "@/server/util/paths";
import { newId } from "@/server/util/ids";
export const dynamic = "force-dynamic";
const MAX = 1024 * 1024 * 1024;
const ALLOWED = /\\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|wav|mp3|m4a|aac|flac|ogg|srt|vtt|json|txt)$/i;
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const form = await req.formData();
  const out = [];
  for (const [, v] of form.entries()) {
    if (typeof v === "string") continue;
    const name = safeFileName(v.name);
    if (!ALLOWED.test(name)) throw new HttpError(415, \`unsupported file type: \${name}\`);
    if (v.size > MAX) throw new HttpError(413, "file too large (1 GB max)");
    const tmp = path.join(workDir(), "uploads", newId("up"), name);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(await v.arrayBuffer()));
    out.push(await registerFile(tmp, { projectId: id, kind: kindFromExt(name), label: name, move: true, provenance: { source: "upload", originalName: v.name } }));
  }
  if (!out.length) throw new HttpError(400, "no files in upload");
  return out;
});
`);

R("projects/[id]/assets/import", `
import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { getProject } from "@/server/projects";
import { importFile } from "@/server/assets";
import { getSettings } from "@/server/settings";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const b = z.object({ paths: z.array(z.string().max(1000)).min(1).max(200), label: z.string().max(200).optional(), note: z.string().max(500).optional() }).parse(await body(req));
  const roots = getSettings().importRoots;
  const out = [];
  for (const p of b.paths) out.push(await importFile(p, roots, { projectId: id, label: b.label, metadata: b.note ? { note: b.note } : {} }));
  return out;
});
`);

R("projects/[id]/scenes", `
import { route } from "@/server/http";
import { listScenes } from "@/server/projects";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((req, { id }) => listScenes(id, req.nextUrl.searchParams.get("storyboard") ?? undefined));
`);

R("scenes/[id]", `
import { body, notFound, route } from "@/server/http";
import { getScene, updateScene } from "@/server/projects";
import { listAssets } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const s = getScene(id) ?? notFound("scene");
  return { scene: s, versions: listAssets(s.projectId, { sceneId: id }) };
});
export const PATCH = route<{ id: string }>(async (req, { id }) => updateScene(id, await body(req)));
`);

R("projects/[id]/plans", `
import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { getProject } from "@/server/projects";
import { listPlans, queuePlan } from "@/server/director";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => listPlans(id));
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const { brief } = z.object({ brief: z.string().min(10).max(8000) }).parse(await body(req));
  return { planId: queuePlan(id, brief) };
});
`);

R("plans/[id]", `
import { notFound, route } from "@/server/http";
import { getPlan } from "@/server/director";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => getPlan(id) ?? notFound("plan"));
`);

R("plans/[id]/accept", `
import { z } from "zod";
import { body, route } from "@/server/http";
import { acceptPlan } from "@/server/director";
export const dynamic = "force-dynamic";
const Opts = z.object({
  imagePool: z.array(z.string().max(64)).max(60).default([]),
  logoAssetId: z.string().max(64).optional(),
  logoReversedAssetId: z.string().max(64).optional(),
  musicAssetId: z.string().max(64).optional(),
  voiceover: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("asset"), assetId: z.string().max(64) }),
      z.object({ kind: z.literal("elevenlabs"), voiceId: z.string().max(60), modelId: z.string().max(60).optional(), languageCode: z.string().max(5).optional() }),
      z.object({ kind: z.literal("none") }),
    ])
    .default({ kind: "none" }),
  whisperLanguage: z.string().max(5).optional(),
  palette: z.record(z.string(), z.string()).optional(),
  direction: z.enum(["rtl", "ltr"]).optional(),
});
export const POST = route<{ id: string }>(async (req, { id }) => acceptPlan(id, Opts.parse(await body(req))));
`);

R("templates", `
import { route } from "@/server/http";
import { listTemplates } from "@/server/templates";
export const dynamic = "force-dynamic";
export const GET = route(() => listTemplates().map(({ graph: _g, ...t }) => t));
`);

R("costs", `
import { route } from "@/server/http";
import { costSummary } from "@/server/costs";
import { getDb } from "@/server/db";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  const projectId = u.get("projectId") ?? undefined;
  const runId = u.get("runId") ?? undefined;
  const ledger = getDb()
    .prepare(\`SELECT * FROM cost_ledger \${projectId ? "WHERE project_id = ?" : runId ? "WHERE run_id = ?" : ""} ORDER BY ts DESC LIMIT 300\`)
    .all(...(projectId ? [projectId] : runId ? [runId] : []));
  return { summary: costSummary({ projectId, runId }), ledger };
});
`);

R("exports", `
import { HttpError, route } from "@/server/http";
import { listExports } from "@/server/exports";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) throw new HttpError(400, "projectId required");
  return listExports(projectId).map(({ name, size, modifiedAt }) => ({ name, size, modifiedAt }));
});
`);

R("exports/file", `
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, guard, HttpError } from "@/server/http";
import { exportsDir } from "@/server/exports";
import { resolveInside } from "@/server/util/paths";
import { mimeFor } from "@/server/util/fileserver";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    guard(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    const name = req.nextUrl.searchParams.get("name");
    if (!projectId || !name) throw new HttpError(400, "projectId and name required");
    const file = resolveInside(exportsDir(projectId), path.basename(name));
    if (!fs.existsSync(file)) throw new HttpError(404, "export not found");
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: { "Content-Type": mimeFor(file), "Content-Length": String(fs.statSync(file).size), "Content-Disposition": \`attachment; filename="\${encodeURIComponent(path.basename(file))}"\` },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
`);

R("events", `
import type { NextRequest } from "next/server";
import { errorResponse, guard } from "@/server/http";
import { eventsSince, latestEventId } from "@/server/events";
export const dynamic = "force-dynamic";

/** Server-Sent Events: tails the durable events table (works across the web and worker processes). */
export async function GET(req: NextRequest) {
  try {
    guard(req);
  } catch (e) {
    return errorResponse(e);
  }
  const u = req.nextUrl.searchParams;
  const runId = u.get("runId") ?? undefined;
  const projectId = u.get("projectId") ?? undefined;
  let cursor = u.has("after") ? Number(u.get("after")) : Math.max(0, latestEventId() - 50);
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          const rows = eventsSince(cursor, { runId, projectId, limit: 200 });
          for (const r of rows) {
            cursor = r.id;
            controller.enqueue(enc.encode(\`id: \${r.id}\\nevent: event\\ndata: \${JSON.stringify(r)}\\n\\n\`));
          }
          controller.enqueue(enc.encode(\`: ping\\n\\n\`));
        } catch {
          /* db busy: try again next tick */
        }
      };
      send();
      timer = setInterval(send, 700);
      req.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
`);

console.log("routes written");
