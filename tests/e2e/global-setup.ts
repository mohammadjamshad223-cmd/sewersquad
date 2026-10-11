import { execSync } from "node:child_process";

/** Reset the demo dataset so every e2e run starts from the same state. */
export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED) return;
  execSync("npm run -s db:seed", { stdio: "inherit" });
}
