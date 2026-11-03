import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships WASM and expects to be loaded by Node directly, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The SQL migrations are read from disk at runtime in local (PGlite) mode.
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
