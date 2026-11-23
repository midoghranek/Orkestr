"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const b = data as { error?: string; details?: { path: string; message: string }[]; issues?: { message: string }[] } | undefined;
    const detail = b?.details?.map((d) => `${d.path}: ${d.message}`).join("; ") ?? b?.issues?.filter(Boolean).map((i) => i.message).slice(0, 3).join("; ");
    throw new ApiError(res.status, `${b?.error ?? res.statusText}${detail ? ` — ${detail}` : ""}`, data);
  }
  return data as T;
}

/**
 * Data hook: fetch + refresh on an interval and whenever a matching server event arrives.
 * Keeps the previous data while refreshing (no loading flashes / blocking overlays).
 */
export function useApi<T>(path: string | null, opts: { refreshMs?: number; events?: (e: OrkEvent) => boolean } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const inflight = useRef(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p || inflight.current) return;
    inflight.current = true;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(!!path);
    setData(undefined);
    void reload();
  }, [path, reload]);

  useEffect(() => {
    if (!opts.refreshMs || !path) return;
    const t = setInterval(() => void reload(), opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, path, reload]);

  const filter = opts.events;
  useEvents(
    useCallback(
      (e: OrkEvent) => {
        if (filter?.(e)) void reload();
      },
      [filter, reload],
    ),
    !!filter && !!path,
  );

  return { data, error, loading, reload, setData };
}

export interface OrkEvent {
  id: number;
  run_id: string | null;
  node_run_id: string | null;
  project_id: string | null;
  level: "debug" | "info" | "warn" | "error";
  type: string;
  message: string;
  data_json: string | null;
  ts: number;
}

type Listener = (e: OrkEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let lastId = 0;

function ensureSource() {
  if (source || typeof window === "undefined") return;
  source = new EventSource(`/api/events${lastId ? `?after=${lastId}` : ""}`);
  source.addEventListener("event", (m) => {
    const e = JSON.parse((m as MessageEvent).data) as OrkEvent;
    lastId = Math.max(lastId, e.id);
    for (const l of listeners) l(e);
  });
  source.onerror = () => {
    source?.close();
    source = null;
    setTimeout(() => listeners.size && ensureSource(), 2000);
  };
}

/** Subscribe to the global server-sent event stream (one shared connection per tab). */
export function useEvents(fn: Listener, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    listeners.add(fn);
    ensureSource();
    return () => {
      listeners.delete(fn);
      if (!listeners.size) {
        source?.close();
        source = null;
      }
    };
  }, [fn, enabled]);
}

export function fmtUsd(v: number | null | undefined, known = true): string {
  if (!known || v === null || v === undefined) return "unknown";
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDur(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export const assetUrl = (id: string) => `/api/assets/${id}/file`;
