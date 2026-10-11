// Integration tests run against DATABASE_URL_TEST (a dedicated database that is truncated).
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://sewersquad:sewersquad@localhost:5432/sewersquad_test?schema=public";
process.env.APP_ENCRYPTION_KEY ??= "test-key-0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_URL ??= "http://localhost:3000";
process.env.REQUIRE_ADMIN_MFA ??= "false";
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = "./storage-test";

import { vi } from "vitest";

// Next.js request APIs are unavailable outside a request; provide an in-memory cookie jar.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
    has: (k: string) => jar.has(k),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));
