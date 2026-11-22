import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { dataDir } from "./util/paths";
import { registerSecret } from "./util/redact";

/**
 * Local credential store: AES-256-GCM, key in data/secret.key (created with owner-only permissions
 * where the OS supports it). Secrets never leave the server: the API only returns a masked hint.
 */
export const PROVIDERS = ["elevenlabs", "fal", "runway", "higgsfield"] as const;
export type Provider = (typeof PROVIDERS)[number];

function masterKey(): Buffer {
  const f = path.join(dataDir(), "secret.key");
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  const key = Buffer.from(fs.readFileSync(f, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("data/secret.key is corrupt (expected 32 bytes)");
  return key;
}

export function hintFor(secret: string): string {
  return secret.length <= 8 ? "••••" : `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

export async function setCredential(provider: Provider, secret: string): Promise<void> {
  if (!PROVIDERS.includes(provider)) throw new Error("unknown provider");
  const s = secret.trim();
  if (s.length < 8 || s.length > 512 || /\s/.test(s)) throw new Error("credential looks malformed");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  getDb()
    .prepare(
      `INSERT INTO credentials (provider, ciphertext, iv, tag, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, tag=excluded.tag, hint=excluded.hint, updated_at=excluded.updated_at`,
    )
    .run(provider, ct.toString("base64"), iv.toString("base64"), tag.toString("base64"), hintFor(s), Date.now());
  registerSecret(s);
}

export async function getCredential(provider: Provider): Promise<string | undefined> {
  const row = getDb().prepare("SELECT ciphertext, iv, tag FROM credentials WHERE provider = ?").get(provider) as
    | { ciphertext: string; iv: string; tag: string }
    | undefined;
  if (!row) return undefined;
  const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(row.iv, "base64"));
  d.setAuthTag(Buffer.from(row.tag, "base64"));
  const out = Buffer.concat([d.update(Buffer.from(row.ciphertext, "base64")), d.final()]).toString("utf8");
  registerSecret(out);
  return out;
}

export function deleteCredential(provider: Provider): void {
  getDb().prepare("DELETE FROM credentials WHERE provider = ?").run(provider);
}

export function listCredentials(): { provider: string; hint: string; updatedAt: number; source: "store" | "env" }[] {
  const rows = getDb().prepare("SELECT provider, hint, updated_at FROM credentials").all() as { provider: string; hint: string; updated_at: number }[];
  const out: { provider: string; hint: string; updatedAt: number; source: "store" | "env" }[] = rows.map((r) => ({ provider: r.provider, hint: r.hint, updatedAt: r.updated_at, source: "store" as const }));
  if (process.env.ELEVENLABS_API_KEY && !out.some((o) => o.provider === "elevenlabs"))
    out.push({ provider: "elevenlabs", hint: hintFor(process.env.ELEVENLABS_API_KEY), updatedAt: 0, source: "env" });
  return out;
}
