import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { dataDir, resolveInside, safeFileName } from "./util/paths";

export function exportsDir(projectId: string): string {
  const row = getDb().prepare("SELECT slug FROM projects WHERE id = ?").get(projectId) as { slug: string } | undefined;
  const dir = resolveInside(path.join(dataDir(), "exports"), safeFileName(row?.slug ?? projectId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const sameBytes = (a: string, b: string) => {
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  return sa.size === sb.size && crypto.createHash("sha256").update(fs.readFileSync(a)).digest("hex") === crypto.createHash("sha256").update(fs.readFileSync(b)).digest("hex");
};

/**
 * Copy a stored asset to data/exports/<project>/<name><ext>. Idempotent: identical content reuses the existing
 * file; different content gets a -v2, -v3… suffix (an export is never overwritten).
 */
export function exportDeliverable(projectId: string, file: string, name: string): string {
  const dir = exportsDir(projectId);
  const ext = path.extname(file);
  let target = resolveInside(dir, `${safeFileName(name)}${ext}`);
  for (let i = 2; fs.existsSync(target); i++) {
    if (sameBytes(file, target)) return target;
    target = resolveInside(dir, `${safeFileName(name)}-v${i}${ext}`);
  }
  fs.copyFileSync(file, target);
  return target;
}

export function listExports(projectId: string): { name: string; path: string; size: number; modifiedAt: number }[] {
  const dir = exportsDir(projectId);
  return fs
    .readdirSync(dir)
    .map((n) => {
      const p = path.join(dir, n);
      const s = fs.statSync(p);
      return { name: n, path: p, size: s.size, modifiedAt: s.mtimeMs };
    })
    .filter((f) => f.size > 0)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}
