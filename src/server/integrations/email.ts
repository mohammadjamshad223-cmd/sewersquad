import "server-only";
import { env, integrations } from "../env";
import { logger } from "../logger";
import { brand } from "@/config/brand";

export type EmailMessage = { to: string; subject: string; text: string; html?: string; replyTo?: string; attachments?: { filename: string; content: Uint8Array }[] };
export type SendResult = { status: "sent"; providerId: string | null } | { status: "skipped"; reason: string } | { status: "failed"; error: string; /** Recipient opted out (SMS STOP). */ unsubscribed?: boolean; /** Retrying will not help. */ permanent?: boolean };

/** Sends through Resend's HTTP API. Returns "skipped" (never "sent") when not configured. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!integrations.email()) {
    if (env().NODE_ENV !== "production") {
      logger.info("email.not_configured.preview", { to: msg.to, subject: msg.subject, text: msg.text });
    }
    return { status: "skipped", reason: "Email provider not configured (RESEND_API_KEY / EMAIL_FROM)." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env().EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? renderEmailHtml(msg.subject, msg.text),
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
      }),
      signal: AbortSignal.timeout(msg.attachments?.length ? 30_000 : 10_000),
    });
    if (!res.ok) return { status: "failed", error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", providerId: body.id ?? null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmailHtml(title: string, text: string, cta?: { label: string; url: string }, footer?: string) {
  const logoUrl = `${env().APP_URL.replace(/\/$/, "")}${brand.logoPath}`;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = cta
    ? `<p style="margin:22px 0"><a href="${escapeHtml(cta.url)}" style="background:${brand.colors.primary};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:${brand.colors.text}">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${brand.colors.border};border-radius:12px">
  <tr><td style="height:4px;background:${brand.colors.accent};border-radius:12px 12px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:18px 28px;border-bottom:1px solid ${brand.colors.border}"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brand.name)}" width="157" height="48" style="display:block;border:0;height:48px;width:auto;color:${brand.colors.primary};font-weight:700;font-size:18px"></td></tr>
  <tr><td style="padding:28px"><h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>${paragraphs}${button}</td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid ${brand.colors.border};font-size:12px;color:${brand.colors.muted}">${escapeHtml(footer ?? `You are receiving this because you have an account with ${brand.name}. Manage notification preferences in your account settings.`)}</td></tr>
  </table></td></tr></table></body></html>`;
}
