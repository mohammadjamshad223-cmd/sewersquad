import { NextResponse, type NextRequest } from "next/server";
import { assertSignedIn } from "@/server/authz/guards";
import { documentBytes } from "@/server/services/documents";
import { storage } from "@/server/storage";
import { route } from "@/server/route";
import { prisma } from "@/server/db";
import { markInvoiceViewed } from "@/server/services/invoices";

export const dynamic = "force-dynamic";

/**
 * Authorized document download. Every request re-checks access. S3 storage redirects to a
 * 60-second signed URL; local storage streams through this handler. Never cached publicly.
 */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await assertSignedIn();
  const { id } = await ctx.params;
  const v = req.nextUrl.searchParams.get("v");
  const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const { doc, version } = await documentBytes(actor, id, v ? Number(v) : undefined);
  if (actor.kind === "CUSTOMER" && doc.type === "INVOICE" && doc.invoiceId) await markInvoiceViewed(doc.invoiceId);
  // Inline rendering only for formats the browser can display safely.
  const inlineOk = version.mimeType === "application/pdf" || version.mimeType.startsWith("image/");
  const disp = disposition === "inline" && inlineOk ? "inline" : "attachment";

  const signed = await storage().signedUrl(version.storageKey, { fileName: version.fileName, contentType: version.mimeType, disposition: disp, ttlSeconds: 60 });
  if (signed) return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "no-store" } });

  const bytes = await storage().get(version.storageKey);
  void prisma; // (access already audited by authorization; downloads are not logged per-request to limit noise)
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": version.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${disp}; filename="${version.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
});
