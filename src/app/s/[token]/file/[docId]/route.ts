import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/server/route";
import { storage } from "@/server/storage";
import { sharedJob } from "@/server/services/job-share";

export const dynamic = "force-dynamic";

/** A file from a job completion link. Only documents that page lists are served. */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ token: string; docId: string }> }) => {
  const { token, docId } = await ctx.params;
  const shared = await sharedJob(token);
  const doc = shared?.docs.find((d) => d.id === docId);
  const v = doc?.versions[0];
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const disp = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const signed = await storage().signedUrl(v.storageKey, { fileName: v.fileName, contentType: v.mimeType, disposition: disp, ttlSeconds: 60 });
  if (signed) return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "no-store" } });
  const bytes = await storage().get(v.storageKey);
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": v.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${disp}; filename="${v.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
});
