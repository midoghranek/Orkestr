import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { redact } from "./redact";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  input?: string;
  /** Max bytes captured per stream; output beyond is truncated (process keeps running). */
  maxOutputBytes?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

/**
 * Allowlist of executables Orkestr may launch. Every spawn goes through `runAllowed`,
 * always with an argv array and `shell: false` — never string concatenation into a shell.
 */
const allowlist = new Map<string, string>();

export function allowExecutable(name: string, absPath: string): void {
  allowlist.set(name, absPath);
}

export function allowedExecutable(name: string): string | undefined {
  return allowlist.get(name);
}

export function listAllowed(): Record<string, string> {
  return Object.fromEntries(allowlist);
}

export class ProcessNotAllowedError extends Error {
  constructor(name: string) {
    super(`executable not in allowlist: ${name}`);
    this.name = "ProcessNotAllowedError";
  }
}

function assertArgs(args: string[]): void {
  for (const a of args) {
    if (typeof a !== "string") throw new TypeError("argv entries must be strings");
    if (a.includes("\0")) throw new TypeError("NUL byte in argument");
  }
}

export function runAllowed(name: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const exe = allowlist.get(name);
  if (!exe) return Promise.reject(new ProcessNotAllowedError(name));
  return runFile(exe, args, opts);
}

/** Low-level: run an absolute executable path. Internal use by discovery and `runAllowed` only. */
export function runFile(exe: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  assertArgs(args);
  const max = opts.maxOutputBytes ?? 8 * 1024 * 1024;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: "", stderr: "aborted before start", durationMs: 0, timedOut: false, aborted: true });
      return;
    }
    let child;
    try {
      child = spawn(exe, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const kill = () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 3000).unref();
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      if (stdout.length < max) stdout += c;
      opts.onStdout?.(c);
    });
    child.stderr.on("data", (c: string) => {
      if (stderr.length < max) stderr += c;
      opts.onStderr?.(c);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr: redact(stderr), durationMs: Date.now() - started, timedOut, aborted });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Find an executable on PATH (Windows aware). Returns absolute path or undefined. */
export function which(cmd: string): string | undefined {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + (cmd.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext.toLowerCase()));
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined;
}
