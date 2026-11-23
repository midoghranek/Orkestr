import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Heavy server-only packages are loaded from node_modules at runtime, never bundled.
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "playwright", "esbuild"],
  poweredByHeader: false,
  turbopack: { root: path.resolve(import.meta.dirname) },
  typedRoutes: false,
};

export default config;
