import { NextResponse, type NextRequest } from "next/server";
import { zipSync } from "fflate";
import { assertSignedIn } from "@/server/authz/guards";
import { documentBytes } from "@/server/services/documents";
import { storage } from "@/server/storage";
import { route } from "@/server/route";
import { badRequest } from "@/server/errors";
import { rateLimit } from "@/server/auth/rate-limit";

export const dynamic = "force-dynamic";
const MAX_FILES = 100;
const MAX_BYTES = 150 * 1024 * 1024;

/** Bulk download. Each file is individually authorized; any unauthorized id fails the request. */
export const POST = route(async (req: NextRequest) => {
  const actor = await assertSignedIn();
  await rateLimit(`zip:${actor.userId}`, 20, 3600);
  const form = await req.formData();
  const ids = form.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) throw badRequest("Select at least one document.");
  if (ids.length > MAX_FILES) throw badRequest(`Select at most ${MAX_FILES} documents.`);
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const id of [...new Set(ids)]) {
    const { version } = await documentBytes(actor, id);
    const bytes = await storage().get(version.storageKey);
    total += bytes.byteLength;
    if (total > MAX_BYTES) throw badRequest("Selection is too large for one download. Select fewer files.");
    let name = version.fileName;
    for (let i = 2; files[name]; i++) name = version.fileName.replace(/(\.\w+)?$/, `-${i}$1`);
    files[name] = bytes;
  }
  const zip = zipSync(files, { level: 0 }); // PDFs/images are already compressed
  return new NextResponse(zip as unknown as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="sewer-squad-documents-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "no-store" },
  });
});
