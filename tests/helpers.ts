import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Graph } from "@/shared/schema";

/** Fresh isolated data dir + DB for each test. Must run before importing server modules' getDb(). */
export function freshEnv(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `orkestr-${name}-`));
  process.env.ORKESTR_DATA_DIR = dir;
  process.env.ORKESTR_DB = path.join(dir, "test.db");
  process.env.ORKESTR_ENABLE_MOCK = "1";
  return dir;
}

export function mock(id: string, params: Record<string, unknown> = {}, extra: Partial<Graph["nodes"][number]> = {}): Graph["nodes"][number] {
  return { id, type: "test.mock", params: { key: id, ...params }, position: { x: 0, y: 0 }, retry: { backoffMs: 1 }, ...extra };
}

export function edge(source: string, target: string, sourceHandle = "out", targetHandle = "in"): Graph["edges"][number] {
  return { id: `${source}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle };
}
