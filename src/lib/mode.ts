"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Simple mode (default) vs Studio Pro. Both show the same projects, engine and runs; Pro only reveals the
 * technical surfaces (flow editor, queue, storyboard, logs). Stored per browser — a viewing preference, not data.
 */
export type Mode = "simple" | "pro";
const KEY = "orkestr.mode";
const listeners = new Set<() => void>();

function read(): Mode {
  try {
    return window.localStorage.getItem(KEY) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function setMode(m: Mode) {
  try {
    window.localStorage.setItem(KEY, m);
  } catch {
    /* private mode: the toggle still works for this page view */
  }
  current = m;
  for (const l of listeners) l();
}

let current: Mode | null = null;

export function useMode(): [Mode, (m: Mode) => void] {
  const mode = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => e.key === KEY && ((current = read()), cb());
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => (current ??= read()),
    () => "simple" as Mode,
  );
  return [mode, useCallback((m: Mode) => setMode(m), [])];
}
