// Runs database migrations at build time when DATABASE_URL is set (hosted
// deployments). Locally, with the embedded database, migrations are applied
// automatically on first use, so this is a no-op there.
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set; skipping migrations (embedded database migrates itself).");
  process.exit(0);
}

const result = spawnSync("npx", ["drizzle-kit", "migrate"], { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
