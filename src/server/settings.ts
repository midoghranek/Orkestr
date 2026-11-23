import { z } from "zod";
import { getDb, json } from "./db";

export const SettingsSchema = z.object({
  /** Max concurrently running node jobs in the worker. */
  concurrency: z.number().int().min(1).max(8).default(2),
  /** Hard cap for a single paid node without explicit approval. 0 = every paid node needs approval. */
  autoApproveUnderUsd: z.number().min(0).max(100).default(0),
  /** Model used by the AI Director. */
  directorModel: z.string().max(80).default("opus"),
  /** Per-plan budget cap for the AI Director call itself. */
  directorMaxUsd: z.number().min(0.05).max(20).default(3),
  /** Folders the user may import media from (read-only). */
  importRoots: z.array(z.string().max(400)).max(20).default([]),
  /** Optional: effective USD per character on the user's ElevenLabs plan (used for estimates only). */
  elevenlabsUsdPerChar: z.number().min(0).max(1).nullable().default(null),
  defaultVoiceId: z.string().max(60).nullable().default(null),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = json(r.value_json, null);
  return SettingsSchema.parse(raw);
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const merged = SettingsSchema.parse({ ...getSettings(), ...patch });
  const st = getDb().prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
  );
  for (const [k, v] of Object.entries(merged)) st.run(k, JSON.stringify(v), Date.now());
  return merged;
}
