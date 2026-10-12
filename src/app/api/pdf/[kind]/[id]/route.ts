import type { NextRequest } from "next/server";
import { assertSignedIn, assertStaffActor } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { route } from "@/server/route";
import { notFound } from "@/server/errors";
import { isUuid } from "@/server/params";

export const dynamic = "force-dynamic";

/** Staff preview of a document exactly as it prints (drafts included). Customers get filed PDFs via /api/documents. */
export const GET = route(async (_req: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) => {
  const actor = await assertSignedIn();
  const { kind, id } = await ctx.params;
  if (actor.kind !== "STAFF" || !isUuid(id)) throw notFound();
  let bytes: Uint8Array;
  let name: string;
  if (kind === "invoice") {
    assertStaffActor(actor, "invoices.read");
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound();
    bytes = await (await import("@/server/pdf/invoice-pdf")).renderInvoicePdf(prisma, id);
    name = `Invoice ${inv.invoiceNumber}`;
  } else if (kind === "proposal") {
    assertStaffActor(actor, "invoices.read");
    const p = await prisma.proposal.findUnique({ where: { id } });
    if (!p) throw notFound();
    bytes = await (await import("@/server/pdf/proposal-pdf")).renderProposalPdf(prisma, id);
    name = `${p.kind === "QUOTE" ? "Quote" : "Proposal"} ${p.number}`;
  } else if (kind === "report") {
    assertStaffActor(actor, "jobs.read");
    const r = await prisma.serviceReport.findUnique({ where: { id } });
    if (!r) throw notFound();
    bytes = await (await import("@/server/pdf/report-pdf")).renderReportPdf(prisma, id);
    name = `Service Report ${r.number}`;
  } else throw notFound();
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name.replace(/[^\w .-]/g, "")}.pdf"`, "Cache-Control": "private, no-store" } });
});
