import { execSync } from "node:child_process";

/** Apply migrations to the dedicated test database before any integration test runs. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? "postgresql://sewersquad:sewersquad@localhost:5432/sewersquad_test?schema=public";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
