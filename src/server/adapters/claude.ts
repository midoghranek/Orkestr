import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allowExecutable, runAllowed, runFile, which } from "../util/proc";
import { REVIEW_SYSTEM, WRITE_SYSTEM } from "../prompts";
import {
  AdapterError,
  type CapabilitySpec,
  type CostEstimate,
  type Discovery,
  type ExecContext,
  type ExecResult,
  type Health,
  type ToolAdapter,
} from "./types";

/**
 * Model abstraction for the AI Director and AI review nodes, backed by the local Claude Code CLI
 * (`claude -p`) using the user's existing login. The model gets NO tools (`--tools ""`), no MCP
 * servers and no session persistence: it can only return JSON validated against our schema.
 * Its output is data — Orkestr never executes model-authored code or shell strings.
 */
export interface StructuredCall<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
  maxBudgetUsd?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Images the model may look at (absolute paths). Passed via --add-dir and referenced in the prompt. */
  attachDir?: string;
}

export interface StructuredResult<T> {
  data: T;
  costUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  model: string;
  durationMs: number;
}

interface ClaudeJson {
  is_error: boolean;
  subtype: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
  duration_ms?: number;
}

export const DEFAULT_MODEL = process.env.ORKESTR_DIRECTOR_MODEL ?? "opus";

export class ClaudeAdapter implements ToolAdapter {
  readonly id = "claude";
  readonly name = "Claude (Claude Code CLI)";
  readonly kind = "ai-model" as const;
  readonly homepage = "https://docs.claude.com/en/docs/claude-code";
  private version?: string;

  private bin(): string | undefined {
    return process.env.ORKESTR_CLAUDE_BIN ?? which("claude");
  }

  async discover(): Promise<Discovery> {
    const bin = this.bin();
    if (!bin) return { found: false, reason: "claude CLI not found on PATH" };
    allowExecutable("claude", bin);
    const r = await runFile(bin, ["--version"], { timeoutMs: 20_000 });
    this.version = /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1];
    return { found: r.code === 0, version: this.version, path: bin };
  }

  async validateConfig() {
    return { ok: !!this.bin(), issues: this.bin() ? [] : ["install Claude Code and log in"] };
  }

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const d = await this.discover();
    if (!d.found) return { status: "unavailable", message: d.reason ?? "missing", checkedAt: t, readyCapabilities: [], blocked: {} };
    // No model call here (it would cost tokens); --help proves the flags we rely on exist.
    const h = await runAllowed("claude", ["--help"], { timeoutMs: 20_000 });
    const needed = ["--json-schema", "--tools", "--no-session-persistence", "--max-budget-usd", "--output-format"];
    const missing = needed.filter((f) => !h.stdout.includes(f));
    return {
      status: missing.length ? "degraded" : "healthy",
      message: missing.length ? `claude ${this.version} lacks ${missing.join(", ")}` : `claude ${this.version}: structured, tool-less planning available`,
      checkedAt: t,
      latencyMs: Date.now() - t,
      readyCapabilities: missing.length ? [] : this.capabilities().map((c) => c.id),
      blocked: {},
    };
  }

  capabilities(): CapabilitySpec[] {
    const cost = { model: "unknown" as const, note: "Billed to your Claude plan/API; the CLI reports total_cost_usd per call, which Orkestr records." };
    const base = { adapter: "claude", paid: true, cost, verifiedBy: "claude -p --json-schema smoke call in Phase 0 (returned structured_output + total_cost_usd)" };
    return [
      { ...base, id: "claude.plan", operation: "plan", label: "AI Director plan", description: "Brief → script, storyboard, shot list (schema-validated JSON).", inputFormats: ["text"], outputFormats: ["json"] },
      { ...base, id: "claude.write", operation: "write", label: "AI copy / script", description: "Schema-validated text generation (scripts, prompts, captions copy).", inputFormats: ["text", "json"], outputFormats: ["json", "text"] },
      { ...base, id: "claude.review", operation: "review", label: "AI visual / QA review", description: "Inspect extracted frames and metadata, return structured findings.", inputFormats: ["image", "json"], outputFormats: ["json"], limitations: ["Advisory only — never replaces human creative approval"] },
    ];
  }

  async estimateCost(): Promise<CostEstimate> {
    return { usd: null, known: false, basis: "token-based; actual cost reported by the CLI after the call" };
  }

  async structured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
    const d = await this.discover();
    if (!d.found) throw new AdapterError("NOT_AVAILABLE", d.reason ?? "claude CLI missing");
    const schema = z.toJSONSchema(call.schema, { target: "draft-7", io: "output" });
    const args = [
      "-p",
      call.prompt,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--system-prompt",
      call.system,
      "--model",
      call.model ?? DEFAULT_MODEL,
      "--no-session-persistence",
      "--strict-mcp-config",
      "--max-budget-usd",
      String(call.maxBudgetUsd ?? 2),
    ];
    if (call.attachDir) args.push("--tools", "Read", "--add-dir", call.attachDir, "--allowedTools", "Read");
    else args.push("--tools", "");
    const r = await runAllowed("claude", args, { signal: call.signal, timeoutMs: call.timeoutMs ?? 10 * 60_000, cwd: call.attachDir ?? process.cwd() });
    if (r.aborted) throw new AdapterError("CANCELLED", "planning cancelled");
    if (r.timedOut) throw new AdapterError("TIMEOUT", "model call timed out");
    let j: ClaudeJson;
    try {
      j = JSON.parse(r.stdout) as ClaudeJson;
    } catch {
      throw new AdapterError("PROVIDER", `claude CLI returned non-JSON (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 400)}`, undefined, true);
    }
    if (j.is_error) {
      const msg = j.result ?? j.subtype;
      if (/budget/i.test(String(j.subtype) + msg)) throw new AdapterError("QUOTA", `model budget cap reached: ${msg}`);
      if (/auth|login/i.test(msg)) throw new AdapterError("AUTH", msg);
      throw new AdapterError("PROVIDER", `model error: ${msg}`, undefined, true);
    }
    const parsed = call.schema.safeParse(j.structured_output ?? (j.result ? JSON.parse(j.result) : undefined));
    if (!parsed.success) throw new AdapterError("INVALID_OUTPUT", `model output failed schema validation: ${parsed.error.message.slice(0, 600)}`, undefined, true);
    const u = j.usage ?? {};
    return {
      data: parsed.data,
      costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
      tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
      model: Object.keys(j.modelUsage ?? {})[0] ?? call.model ?? DEFAULT_MODEL,
      durationMs: j.duration_ms ?? r.durationMs,
    };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const Findings = z.object({
      verdict: z.enum(["pass", "needs_changes", "fail"]),
      summary: z.string(),
      issues: z.array(z.object({ severity: z.enum(["info", "minor", "major", "critical"]), category: z.string(), detail: z.string(), frame: z.string().optional() })),
    });
    if (operation === "review") {
      const p = z.object({ images: z.array(z.string()).min(1).max(24), brief: z.string().max(4000), checklist: z.array(z.string()).default([]), model: z.string().optional(), maxBudgetUsd: z.number().max(10).default(1) }).parse(params);
      const dir = path.join(ctx.workDir, "review");
      fs.mkdirSync(dir, { recursive: true });
      const names = p.images.map((img, i) => {
        const n = `frame-${String(i + 1).padStart(2, "0")}${path.extname(img)}`;
        fs.copyFileSync(img, path.join(dir, n));
        return n;
      });
      ctx.progress(0.2, "AI reviewing frames");
      const res = await this.structured({
        system: REVIEW_SYSTEM,
        prompt: `Brief:\n${p.brief}\n\nChecklist:\n${p.checklist.map((c) => `- ${c}`).join("\n") || "- visual artifacts\n- branding\n- text legibility\n- subtitle problems"}\n\nFrames in this directory: ${names.join(", ")}. Read each one, then return findings.`,
        schema: Findings,
        model: p.model ?? "sonnet",
        maxBudgetUsd: p.maxBudgetUsd,
        signal: ctx.signal,
        attachDir: dir,
      });
      const f = path.join(ctx.workDir, "ai-review.json");
      fs.writeFileSync(f, JSON.stringify(res.data, null, 2));
      return {
        artifacts: [{ file: f, kind: "json", port: "report", label: `AI review: ${res.data.verdict}` }],
        values: { report: res.data },
        cost: { usd: res.costUsd, known: res.costUsd !== null, tokensIn: res.tokensIn, tokensOut: res.tokensOut, note: res.model },
      };
    }
    if (operation === "write") {
      const p = z.object({ instruction: z.string().min(1).max(8000), context: z.string().max(20000).default(""), model: z.string().optional(), maxBudgetUsd: z.number().max(10).default(1) }).parse(params);
      const res = await this.structured({
        system: WRITE_SYSTEM,
        prompt: `${p.instruction}\n\nContext:\n${p.context}`,
        schema: z.object({ text: z.string() }),
        model: p.model ?? "sonnet",
        maxBudgetUsd: p.maxBudgetUsd,
        signal: ctx.signal,
      });
      const f = path.join(ctx.workDir, "copy.txt");
      fs.writeFileSync(f, res.data.text);
      return { artifacts: [{ file: f, kind: "text", port: "text" }], values: { text: res.data.text }, cost: { usd: res.costUsd, known: res.costUsd !== null, tokensIn: res.tokensIn, tokensOut: res.tokensOut, note: res.model } };
    }
    throw new AdapterError("UNSUPPORTED", `claude adapter: use the AI Director for planning; no operation ${operation}`);
  }
}
