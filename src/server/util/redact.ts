/**
 * Secret redaction for logs, events and error messages.
 * Registered secrets are replaced verbatim; common key shapes are masked heuristically as a second line.
 */
const registered = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 8) registered.add(value);
}

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI/Anthropic style
  /\bsk_[A-Za-z0-9]{20,}\b/g, // ElevenLabs style
  /\b(xi-api-key|authorization|x-api-key|api[_-]?key|token)(["'\s:=]+)([^\s"',}]{8,})/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
];

export function redact(input: string): string {
  let out = input;
  for (const s of registered) out = out.split(s).join("[REDACTED]");
  out = out.replace(PATTERNS[0], "[REDACTED]").replace(PATTERNS[1], "[REDACTED]");
  out = out.replace(PATTERNS[2], (_m, k: string, sep: string) => `${k}${sep}[REDACTED]`);
  out = out.replace(PATTERNS[3], "Bearer [REDACTED]");
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /secret|password|api[_-]?key|token|credential/i.test(k) ? "[REDACTED]" : redactDeep(v);
    }
    return out as T;
  }
  return value;
}
