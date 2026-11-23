import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { freshEnv } from "../helpers";
import { closeDb } from "@/server/db";
import { PathSecurityError, resolveInside, safeFileName, isUnderAny } from "@/server/util/paths";
import { redact, redactDeep, registerSecret } from "@/server/util/redact";
import { runAllowed, ProcessNotAllowedError } from "@/server/util/proc";
import { getCredential, listCredentials, setCredential } from "@/server/credentials";
import { createProject } from "@/server/projects";
import { importFile } from "@/server/assets";

let dataDir: string;
beforeAll(() => {
  dataDir = freshEnv("security");
  closeDb();
});

describe("path security", () => {
  it("keeps resolved paths inside the base", () => {
    const base = path.join(dataDir, "assets");
    expect(resolveInside(base, "a/b.png")).toBe(path.join(base, "a", "b.png"));
    expect(() => resolveInside(base, "../secret.key")).toThrow(PathSecurityError);
    expect(() => resolveInside(base, "a/../../x")).toThrow(PathSecurityError);
    expect(() => resolveInside(base, path.resolve("/etc/passwd"))).toThrow(PathSecurityError);
    expect(() => resolveInside(base, "file.txt:stream")).toThrow(PathSecurityError);
    expect(() => resolveInside(base, "a\0b")).toThrow(PathSecurityError);
  });

  it("sanitises file names", () => {
    expect(safeFileName("../../evil name?.mp4")).toBe("evil-name-.mp4");
    expect(safeFileName("كافيه-ad")).toBe("كافيه-ad");
  });

  it("only imports from allowed roots", async () => {
    const p = createProject({ name: "Sec" });
    const allowed = path.join(dataDir, "imports");
    fs.mkdirSync(allowed, { recursive: true });
    const ok = path.join(allowed, "ok.txt");
    fs.writeFileSync(ok, "hello");
    const outside = path.join(dataDir, "outside.txt");
    fs.writeFileSync(outside, "nope");
    expect(isUnderAny(ok, [allowed])).toBe(true);
    await expect(importFile(outside, [allowed], { projectId: p.id })).rejects.toThrow(/outside the allowed/);
    const a = await importFile(ok, [allowed], { projectId: p.id });
    expect(a.sha256).toHaveLength(64);
    expect(a.path.startsWith(path.join(dataDir, "assets"))).toBe(true);
  });
});

describe("process allowlist", () => {
  it("refuses executables that were not registered by discovery", async () => {
    await expect(runAllowed("cmd", ["/c", "echo pwned"])).rejects.toBeInstanceOf(ProcessNotAllowedError);
  });
});

describe("secrets", () => {
  it("redacts registered secrets and common key shapes", () => {
    registerSecret("supersecretvalue123");
    expect(redact("token supersecretvalue123 here")).not.toContain("supersecretvalue123");
    expect(redact("xi-api-key: sk_abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
    expect(redact("Authorization: Bearer abc.def.ghijklmnopqrstu")).toContain("[REDACTED]");
    expect(redactDeep({ apiKey: "x", nested: { password: "y", ok: "fine" } })).toEqual({ apiKey: "[REDACTED]", nested: { password: "[REDACTED]", ok: "fine" } });
  });

  it("encrypts credentials at rest and only exposes a hint", async () => {
    await setCredential("elevenlabs", "sk_test_0123456789abcdef");
    expect(await getCredential("elevenlabs")).toBe("sk_test_0123456789abcdef");
    const db = (await import("@/server/db")).getDb();
    const row = db.prepare("SELECT ciphertext FROM credentials WHERE provider='elevenlabs'").get() as { ciphertext: string };
    expect(row.ciphertext).not.toContain("0123456789");
    expect(listCredentials()[0].hint).toBe("sk_…cdef");
    await expect(setCredential("elevenlabs", "has space here")).rejects.toThrow();
  });
});
