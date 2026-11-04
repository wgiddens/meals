// Runs database migrations at build time when DATABASE_URL is set (hosted
// deployments). Locally, with the embedded database, migrations are applied
// automatically on first use, so this is a no-op there.
//
// Set SEED_ON_BUILD=true to also load the starter recipes. The seed skips
// recipes that already exist, so leaving it on is harmless.
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set; skipping migrations (embedded database migrates itself).");
  process.exit(0);
}

function run(args) {
  const result = spawnSync("npx", args, { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["drizzle-kit", "migrate"]);
if (process.env.SEED_ON_BUILD === "true") {
  run(["tsx", "--tsconfig", "tsconfig.json", "src/db/seed.ts"]);
}
