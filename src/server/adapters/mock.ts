import fs from "node:fs";
import path from "node:path";
import { AdapterError, checkAborted, type CapabilitySpec, type ExecContext, type ExecResult, type Health, type ToolAdapter } from "./types";

/**
 * Deterministic adapter for engine tests ONLY. Registered when ORKESTR_ENABLE_MOCK=1 (tests).
 * It is never shown as a real integration: its capabilities are tagged `mock.*` and the UI badges them.
 */
export interface MockBehavior {
  /** Fail the first N attempts of a given key with a retryable error. */
  failTimes?: Record<string, number>;
  /** Always fail for keys. */
  failAlways?: string[];
  /** Delay ms per execution. */
  delayMs?: number;
}

export const mockState: { behavior: MockBehavior; calls: Record<string, number>; executions: string[] } = {
  behavior: {},
  calls: {},
  executions: [],
};

export function resetMock(behavior: MockBehavior = {}): void {
  mockState.behavior = behavior;
  mockState.calls = {};
  mockState.executions = [];
}

export class MockAdapter implements ToolAdapter {
  readonly id = "mock";
  readonly name = "Mock (tests only)";
  readonly kind = "mock" as const;

  async discover() {
    return { found: true, version: "test" };
  }
  async validateConfig() {
    return { ok: true, issues: [] };
  }
  async healthCheck(): Promise<Health> {
    return { status: "healthy", message: "mock adapter (tests only)", checkedAt: Date.now(), readyCapabilities: this.capabilities().map((c) => c.id), blocked: {} };
  }
  capabilities(): CapabilitySpec[] {
    const base = { adapter: "mock", inputFormats: ["any"], outputFormats: ["text"], cost: { model: "free" as const }, verifiedBy: "unit tests" };
    return [
      { ...base, id: "mock.text", operation: "text", label: "Mock text", description: "Emit deterministic text", paid: false },
      { ...base, id: "mock.paid", operation: "paid", label: "Mock paid op", description: "Pretend-paid op for approval tests", paid: true, cost: { model: "per_unit", usdPerUnit: 0.5, unit: "call", source: "test fixture", asOf: "2026-11-23" } },
    ];
  }
  async estimateCost(operation: string) {
    return operation === "paid" ? { usd: 0.5, known: true, basis: "fixture" } : { usd: 0, known: true, basis: "fixture" };
  }
  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const key = String(params.key ?? ctx.nodeRunId);
    mockState.calls[key] = (mockState.calls[key] ?? 0) + 1;
    mockState.executions.push(key);
    const { behavior } = mockState;
    if (behavior.delayMs) {
      const end = Date.now() + behavior.delayMs;
      while (Date.now() < end) {
        checkAborted(ctx.signal);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    if (behavior.failAlways?.includes(key)) throw new AdapterError("TOOL_FAILED", `mock failure for ${key}`, undefined, false);
    const failN = behavior.failTimes?.[key] ?? 0;
    if (mockState.calls[key] <= failN) throw new AdapterError("PROVIDER", `transient mock failure ${mockState.calls[key]}/${failN} for ${key}`, undefined, true);
    const inputs = (params.inputs as string[] | undefined) ?? [];
    const text = `${params.text ?? key}${inputs.length ? `<${inputs.join("+")}>` : ""}`;
    const f = path.join(ctx.workDir, "out.txt");
    fs.writeFileSync(f, text);
    return { artifacts: [{ file: f, kind: "text", port: "out" }], values: { out: text }, cost: operation === "paid" ? { usd: 0.5, known: true } : undefined };
  }
}
