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
  /** Live keys (sk_live_… or restricted rk_live_…) stay disabled until the test-mode checklist in docs/integrations.md is signed off. */
  STRIPE_LIVE_APPROVED: z.enum(["true", "false"]).default("false"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  /** Messaging Service SID (MG…) linked to the approved A2P campaign. Preferred over a bare From number. */
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),

  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),

  /**
   * Key for the read-only agent API (/api/v1). Requests must send "Authorization: Bearer <key>".
   * Keys shorter than 32 characters are ignored (the API then refuses everything) rather than
   * failing the whole app.
   */
  AGENT_API_KEY: z.string().optional(),
  /** Signing secret (whsec_…) of the Resend "email.received" webhook that turns forwarded emails into leads. */
  RESEND_INBOUND_WEBHOOK_SECRET: z.string().optional(),
  /** Our own mailboxes, comma separated. Mail they send is matched to leads as "contacted". */
  LEAD_INBOXES: z.string().default("sewersquadservices@gmail.com,sales@sewersquadservices.com"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Trim whitespace and one pair of matching surrounding quotes; blank becomes undefined. */
export function cleanValue(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  let s = v.trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]) s = s.slice(1, -1).trim();
  return s === "" ? undefined : s;
}

/** For admin diagnostics: shows which key is in use without revealing it (like Stripe's dashboard). */
export function maskSecret(v: string | undefined): string {
  if (!v) return "not set";
  const prefix = v.match(/^[a-z]+_(live|test)_/)?.[0] ?? v.slice(0, 3);
  return `${prefix}…${v.slice(-4)}`;
}

export function env(): Env {
  if (cached) return cached;
  // Values pasted into hosting dashboards often carry stray spaces or newlines; blank means unset.
  const cleaned = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, cleanValue(v)]),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Secret (sk_) and restricted (rk_) keys both come in test and live variants. */
export function isLiveStripeKey(key: string | undefined) {
  return /^(sk|rk)_live_/.test(key?.trim() ?? "");
}

export const integrations = {
  stripe: () => {
    const e = env();
    if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET) return false;
    return !isLiveStripeKey(e.STRIPE_SECRET_KEY) || e.STRIPE_LIVE_APPROVED === "true";
  },
  email: () => Boolean(env().RESEND_API_KEY && env().EMAIL_FROM),
  leadsInbound: () => Boolean(env().RESEND_API_KEY && env().RESEND_INBOUND_WEBHOOK_SECRET),
  sms: () => Boolean(env().TWILIO_ACCOUNT_SID && env().TWILIO_AUTH_TOKEN && (env().TWILIO_MESSAGING_SERVICE_SID || env().TWILIO_FROM_NUMBER)),
  s3: () => env().STORAGE_DRIVER === "s3" && Boolean(env().S3_BUCKET),
  maps: () => Boolean(env().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
};
