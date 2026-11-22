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

/** Copy a stored asset to data/exports/<project>/<name><ext>. Existing files get a numeric suffix (never overwritten). */
export function exportDeliverable(projectId: string, file: string, name: string): string {
  const dir = exportsDir(projectId);
  const ext = path.extname(file);
  let target = resolveInside(dir, `${safeFileName(name)}${ext}`);
  for (let i = 2; fs.existsSync(target); i++) target = resolveInside(dir, `${safeFileName(name)}-v${i}${ext}`);
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
