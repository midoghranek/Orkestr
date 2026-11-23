import path from "node:path";
import fs from "node:fs";

/** Root of the repository (where package.json lives). */
export const ROOT_DIR = process.env.ORKESTR_ROOT ? path.resolve(process.env.ORKESTR_ROOT) : process.cwd();

/** Data directory: SQLite database, asset store, secret key, render cache. Never committed. */
export function dataDir(): string {
  const dir = process.env.ORKESTR_DATA_DIR ? path.resolve(process.env.ORKESTR_DATA_DIR) : path.join(ROOT_DIR, "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function assetsDir(): string {
  const dir = path.join(dataDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function workDir(): string {
  const dir = path.join(dataDir(), "work");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSecurityError";
  }
}

/**
 * Resolve `candidate` and guarantee it stays inside `base`.
 * Rejects absolute paths outside base, `..` traversal, NUL bytes and Windows device/alt-stream tricks.
 */
export function resolveInside(base: string, candidate: string): string {
  if (typeof candidate !== "string" || candidate.length === 0) throw new PathSecurityError("empty path");
  if (candidate.includes("\0")) throw new PathSecurityError("NUL byte in path");
  // Alternate data streams (file.txt:stream) — only the drive-letter colon is allowed.
  const withoutDrive = candidate.replace(/^[a-zA-Z]:/, "");
  if (withoutDrive.includes(":")) throw new PathSecurityError("colon in path");
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, candidate);
  const rel = path.relative(resolvedBase, resolved);
  if (rel === "" ) return resolved;
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new PathSecurityError(`path escapes ${resolvedBase}`);
  return resolved;
}

/** Allowed roots for importing user files (read-only). Configurable in settings; defaults are conservative. */
export function isUnderAny(p: string, roots: string[]): boolean {
  const abs = path.resolve(p);
  return roots.some((r) => {
    const rel = path.relative(path.resolve(r), abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

export function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|-+$/g, "");
  return (cleaned || "file").slice(0, 120);
}
