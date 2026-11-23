import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getCredential } from "../credentials";
import { registerSecret } from "../util/redact";
import {
  AdapterError,
  checkAborted,
  type CapabilitySpec,
  type CostEstimate,
  type Discovery,
  type ExecContext,
  type ExecResult,
  type Health,
  type ToolAdapter,
} from "./types";

/**
 * ElevenLabs text-to-speech over the public REST API (api.elevenlabs.io/v1).
 * Billing is in characters/credits against the account's plan; the USD value of a character depends
 * on the plan, so Orkestr reports the exact character count and labels USD as unknown unless the
 * user enters their plan's effective rate in Settings.
 */
const API = "https://api.elevenlabs.io/v1";

export const ELEVEN_MODELS = ["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5"] as const;

async function key(): Promise<string | undefined> {
  const k = process.env.ELEVENLABS_API_KEY ?? (await getCredential("elevenlabs"));
  registerSecret(k);
  return k;
}

function mapStatus(status: number, body: string): AdapterError {
  if (status === 401 || status === 403) return new AdapterError("AUTH", `ElevenLabs rejected the API key (${status})`);
  if (status === 429) return new AdapterError("RATE_LIMIT", "ElevenLabs rate limit", undefined, true);
  if (status === 402 || /quota|credits/i.test(body)) return new AdapterError("QUOTA", `ElevenLabs quota/credits exhausted: ${body.slice(0, 200)}`);
  if (status >= 500) return new AdapterError("PROVIDER", `ElevenLabs ${status}`, undefined, true);
  return new AdapterError("INVALID_INPUT", `ElevenLabs ${status}: ${body.slice(0, 300)}`);
}

export class ElevenLabsAdapter implements ToolAdapter {
  readonly id = "elevenlabs";
  readonly name = "ElevenLabs";
  readonly kind = "api" as const;
  readonly homepage = "https://elevenlabs.io/docs/api-reference/text-to-speech/convert";

  async discover(): Promise<Discovery> {
    const k = await key();
    return k ? { found: true, details: { credential: "configured" } } : { found: false, reason: "No ElevenLabs API key (Settings → Credentials)" };
  }

  async validateConfig() {
    const k = await key();
    return { ok: !!k, issues: k ? [] : ["ELEVENLABS_API_KEY not configured"] };
  }

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const k = await key();
    if (!k) return { status: "unconfigured", message: "No API key configured — voiceover nodes using ElevenLabs are disabled.", checkedAt: t, readyCapabilities: [], blocked: { "elevenlabs.tts": "no API key" } };
    // /user/subscription is a read-only call: no characters are spent.
    const r = await fetch(`${API}/user/subscription`, { headers: { "xi-api-key": k } }).catch((e: Error) => e);
    if (r instanceof Error) return { status: "degraded", message: `network: ${r.message}`, checkedAt: t, readyCapabilities: [], blocked: { "elevenlabs.tts": "network" } };
    if (!r.ok) {
      const e = mapStatus(r.status, await r.text());
      return { status: "degraded", message: e.message, checkedAt: t, readyCapabilities: [], blocked: { "elevenlabs.tts": e.code } };
    }
    const sub = (await r.json()) as { tier?: string; character_count?: number; character_limit?: number };
    const left = sub.character_limit !== undefined && sub.character_count !== undefined ? sub.character_limit - sub.character_count : undefined;
    return {
      status: "healthy",
      message: `ElevenLabs ${sub.tier ?? "account"}; characters used ${sub.character_count ?? "?"}/${sub.character_limit ?? "?"}${left !== undefined ? ` (${left} left)` : ""}`,
      checkedAt: t,
      latencyMs: Date.now() - t,
      readyCapabilities: ["elevenlabs.tts", "elevenlabs.voices"],
      blocked: {},
    };
  }

  capabilities(): CapabilitySpec[] {
    return [
      {
        id: "elevenlabs.tts",
        adapter: "elevenlabs",
        operation: "tts",
        label: "Voiceover (ElevenLabs)",
        description: "Multilingual text-to-speech (incl. Arabic) with a chosen voice and model; MP3 44.1 kHz.",
        inputFormats: ["text"],
        outputFormats: ["mp3"],
        paid: true,
        cost: { model: "unknown", note: "Charged per character against your ElevenLabs plan; USD/character depends on the plan. Orkestr reports the exact character count." },
        verifiedBy: "REST contract from the official API reference; health check calls GET /v1/user/subscription (no spend)",
        requires: ["ElevenLabs API key"],
        limitations: ["Egyptian Arabic pronunciation must be verified by listening; the brand name may need a phonetic respelling"],
      },
      {
        id: "elevenlabs.voices",
        adapter: "elevenlabs",
        operation: "voices",
        label: "List voices",
        description: "List the account's voices (read-only).",
        inputFormats: [],
        outputFormats: ["json"],
        paid: false,
        cost: { model: "free", note: "Read-only API call." },
        verifiedBy: "REST contract (GET /v1/voices)",
        requires: ["ElevenLabs API key"],
      },
    ];
  }

  async estimateCost(operation: string, params: Record<string, unknown>): Promise<CostEstimate> {
    if (operation !== "tts") return { usd: 0, known: true, basis: "read-only" };
    const chars = String(params.text ?? "").length;
    const rate = typeof params.usdPerCharacter === "number" ? params.usdPerCharacter : undefined;
    return rate
      ? { usd: chars * rate, known: true, basis: `user-entered plan rate ${rate} USD/char`, unit: "character", quantity: chars }
      : { usd: null, known: false, basis: "ElevenLabs bills characters against your plan; USD unknown", unit: "character", quantity: chars };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const k = await key();
    if (!k) throw new AdapterError("NOT_CONFIGURED", "ElevenLabs API key not configured");
    if (operation === "voices") {
      const r = await fetch(`${API}/voices`, { headers: { "xi-api-key": k }, signal: ctx.signal });
      if (!r.ok) throw mapStatus(r.status, await r.text());
      const f = path.join(ctx.workDir, "voices.json");
      fs.writeFileSync(f, await r.text());
      return { artifacts: [{ file: f, kind: "json", port: "voices" }] };
    }
    if (operation !== "tts") throw new AdapterError("UNSUPPORTED", `elevenlabs has no operation ${operation}`);
    const p = z
      .object({
        text: z.string().min(1).max(10_000),
        voiceId: z.string().regex(/^[A-Za-z0-9]{10,40}$/, "voice id from your ElevenLabs voice list"),
        modelId: z.enum(ELEVEN_MODELS).default("eleven_multilingual_v2"),
        languageCode: z.string().regex(/^[a-z]{2}$/).optional(),
        stability: z.number().min(0).max(1).default(0.45),
        similarityBoost: z.number().min(0).max(1).default(0.8),
        style: z.number().min(0).max(1).default(0.2),
        speed: z.number().min(0.7).max(1.2).default(1),
        seed: z.number().int().min(0).max(4294967295).optional(),
      })
      .parse(params);
    checkAborted(ctx.signal);
    ctx.progress(0.1, "requesting speech");
    const r = await fetch(`${API}/text-to-speech/${p.voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      signal: ctx.signal,
      headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: p.text,
        model_id: p.modelId,
        ...(p.languageCode ? { language_code: p.languageCode } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        voice_settings: { stability: p.stability, similarity_boost: p.similarityBoost, style: p.style, speed: p.speed, use_speaker_boost: true },
      }),
    }).catch((e: Error) => {
      if (e.name === "AbortError") throw new AdapterError("CANCELLED", "cancelled");
      throw new AdapterError("PROVIDER", `network: ${e.message}`, undefined, true);
    });
    if (!r.ok) throw mapStatus(r.status, await r.text());
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000) throw new AdapterError("INVALID_OUTPUT", "ElevenLabs returned an unexpectedly small audio file");
    const f = path.join(ctx.workDir, "voiceover.mp3");
    fs.writeFileSync(f, buf);
    const requestId = r.headers.get("request-id") ?? undefined;
    return {
      artifacts: [{ file: f, kind: "audio", port: "audio", label: `ElevenLabs ${p.modelId} — listen to verify pronunciation`, metadata: { voiceId: p.voiceId, modelId: p.modelId, requestId } }],
      cost: { usd: null, known: false, unit: "character", quantity: p.text.length, note: "characters billed against the ElevenLabs plan" },
      providerJobId: requestId,
    };
  }
}
