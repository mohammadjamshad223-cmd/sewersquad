import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Never import this module from client components.
 * Optional provider credentials are allowed to be absent: features degrade to an explicit
 * "not configured" state instead of pretending to work.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z.string().min(32, "APP_ENCRYPTION_KEY must be at least 32 characters"),
  CRON_SECRET: z.string().min(8).optional(),
  REQUIRE_ADMIN_MFA: z.enum(["true", "false"]).default("true"),
  /** Enables the one-time /setup page that creates the first Super Admin. Remove after setup. */
  SETUP_TOKEN: z.string().min(16, "SETUP_TOKEN must be at least 16 characters").optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  /** Self-hosted single server with a persistent disk (or local production testing) only. */
  ALLOW_LOCAL_STORAGE: z.enum(["true", "false"]).default("false"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_ENABLE_ACH: z.enum(["true", "false"]).default("false"),
  /** Live keys (sk_live_…) stay disabled until the test-mode checklist in docs/integrations.md is signed off. */
  STRIPE_LIVE_APPROVED: z.enum(["true", "false"]).default("false"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const integrations = {
  stripe: () => {
    const e = env();
    if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET) return false;
    return !e.STRIPE_SECRET_KEY.startsWith("sk_live_") || e.STRIPE_LIVE_APPROVED === "true";
  },
  email: () => Boolean(env().RESEND_API_KEY && env().EMAIL_FROM),
  sms: () => Boolean(env().TWILIO_ACCOUNT_SID && env().TWILIO_AUTH_TOKEN && env().TWILIO_FROM_NUMBER),
  s3: () => env().STORAGE_DRIVER === "s3" && Boolean(env().S3_BUCKET),
  maps: () => Boolean(env().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
};
