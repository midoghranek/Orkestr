import type { NextConfig } from "next";

const config: NextConfig = {
  // Heavy server-only packages are loaded from node_modules at runtime, never bundled.
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "playwright", "esbuild"],
  poweredByHeader: false,
  typedRoutes: false,
};

export default config;
