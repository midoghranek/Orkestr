/**
 * The Orkestr adapter contract. Every external tool (CLI, API, library) is wrapped by one adapter.
 * Adapters describe only operations they have verified; the registry stores what discovery found.
 */

export type AdapterKind = "local-cli" | "api" | "library" | "ai-model" | "mock";

export type CostModel =
  | { model: "free"; note?: string }
  | { model: "per_unit"; usdPerUnit: number; unit: string; source: string; asOf: string; note?: string }
  | { model: "unknown"; note: string };

export interface CapabilitySpec {
  /** Globally unique capability id, `<adapter>.<operation>`. */
  id: string;
  adapter: string;
  operation: string;
  label: string;
  description: string;
  inputFormats: string[];
  outputFormats: string[];
  paid: boolean;
  cost: CostModel;
  /** How this was verified: what we actually ran or read. */
  verifiedBy: string;
  /** Extra prerequisites (model downloads, credentials) beyond the adapter's health. */
  requires?: string[];
  limitations?: string[];
}

export interface Discovery {
  found: boolean;
  version?: string;
  path?: string;
  details?: Record<string, unknown>;
  reason?: string;
}

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unconfigured";

export interface Health {
  status: HealthStatus;
  message: string;
  checkedAt: number;
  latencyMs?: number;
  /** Capabilities ready right now (subset of capabilities()). */
  readyCapabilities: string[];
  /** Capability id -> reason it is not ready. */
  blocked: Record<string, string>;
}

export interface CostEstimate {
  usd: number | null;
  known: boolean;
  basis: string;
  unit?: string;
  quantity?: number;
}

export interface ArtifactOut {
  /** Absolute path in the node's work dir; the engine moves it into the asset store. */
  file: string;
  kind: "image" | "video" | "audio" | "subtitle" | "json" | "text" | "document";
  label?: string;
  port: string;
  metadata?: Record<string, unknown>;
}

export interface ExecContext {
  signal: AbortSignal;
  workDir: string;
  projectId: string;
  runId: string;
  nodeRunId: string;
  progress: (fraction: number, message?: string) => void;
  log: (level: "info" | "warn" | "error" | "debug", message: string, data?: unknown) => void;
}

export interface ExecResult {
  artifacts: ArtifactOut[];
  /** Non-file outputs (text/json) keyed by port. */
  values?: Record<string, unknown>;
  cost?: { usd: number | null; known: boolean; unit?: string; quantity?: number; tokensIn?: number; tokensOut?: number; note?: string };
  /** Provider job handle (for remote cancellation / audit). */
  providerJobId?: string;
}

export type AdapterErrorCode =
  | "NOT_AVAILABLE"
  | "NOT_CONFIGURED"
  | "AUTH"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "CANCELLED"
  | "RATE_LIMIT"
  | "QUOTA"
  | "PROVIDER"
  | "TOOL_FAILED"
  | "INVALID_OUTPUT"
  | "UNSUPPORTED";

const RETRYABLE: Record<AdapterErrorCode, boolean> = {
  NOT_AVAILABLE: false,
  NOT_CONFIGURED: false,
  AUTH: false,
  INVALID_INPUT: false,
  TIMEOUT: true,
  CANCELLED: false,
  RATE_LIMIT: true,
  QUOTA: false,
  PROVIDER: true,
  TOOL_FAILED: true,
  INVALID_OUTPUT: true,
  UNSUPPORTED: false,
};

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;
  constructor(code: AdapterErrorCode, message: string, details?: unknown, retryable?: boolean) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.retryable = retryable ?? RETRYABLE[code];
    this.details = details;
  }
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, retryable: this.retryable, details: this.details };
  }
}

export function normalizeError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  if (err instanceof Error) {
    if (err.name === "AbortError") return new AdapterError("CANCELLED", "cancelled");
    if (err.name === "ZodError") return new AdapterError("INVALID_INPUT", err.message);
    if (err.name === "PathSecurityError") return new AdapterError("INVALID_INPUT", err.message);
    if (err.name === "ProcessNotAllowedError") return new AdapterError("NOT_AVAILABLE", err.message);
    return new AdapterError("TOOL_FAILED", err.message);
  }
  return new AdapterError("TOOL_FAILED", String(err));
}

export interface ToolAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind: AdapterKind;
  readonly homepage?: string;
  discover(): Promise<Discovery>;
  validateConfig(): Promise<{ ok: boolean; issues: string[] }>;
  healthCheck(): Promise<Health>;
  capabilities(): CapabilitySpec[];
  estimateCost(operation: string, params: Record<string, unknown>): Promise<CostEstimate>;
  execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult>;
  /** Provider-side cancellation for remote jobs. Local processes are cancelled through ctx.signal. */
  cancel?(providerJobId: string): Promise<void>;
  /** Re-list artifacts for a provider job (remote providers that hold outputs). */
  artifacts?(providerJobId: string): Promise<ArtifactOut[]>;
}

export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AdapterError("CANCELLED", "cancelled");
}
