import "server-only";
import { prisma } from "../db";
import { verifyJobShareToken } from "../share";

/** What a customer sees from a completion link: customer-visible paperwork for one completed job. */
export async function sharedJob(token: string) {
  const jobId = verifyJobShareToken(token);
  if (!jobId) return null;
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: "COMPLETED" },
    include: {
      location: { select: { name: true, addressLine1: true, city: true, state: true, postalCode: true } },
      organization: { select: { name: true } },
      serviceRecord: { include: { assetRecords: true } },
      manifest: { select: { id: true, manifestNumber: true } },
      invoices: { where: { status: { notIn: ["DRAFT", "VOID"] } }, select: { id: true, invoiceNumber: true, totalCents: true, balanceCents: true, dueDate: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!job) return null;
  const invoice = job.invoices[0] ?? null;
  const docs = await prisma.document.findMany({
    where: { deletedAt: null, visibility: "CUSTOMER", OR: [{ jobId: job.id, type: { in: ["SERVICE_PHOTO", "MANIFEST", "MANIFEST_OFFICIAL"] } }, ...(invoice ? [{ invoiceId: invoice.id, type: "INVOICE" as const }] : [])] },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  return { job, invoice, docs: docs.filter((d) => d.versions[0]) };
}
