import Image from "next/image";
import { notFound } from "next/navigation";
import { Download, FileText, Phone } from "lucide-react";
import { brand } from "@/config/brand";
import { sharedJob } from "@/server/services/job-share";
import { getSetting, companyTimeZone } from "@/server/services/settings";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { formatCents } from "@/lib/money";
import { formatDateKey, instantToDateKey, keyFromDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your service paperwork", robots: { index: false, follow: false } };

export default async function SharedJob({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await sharedJob(token);
  if (!shared) notFound();
  const { job, invoice, docs } = shared;
  const [company, tz] = await Promise.all([getSetting("company"), companyTimeZone()]);
  const gallons = job.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0;
  const photos = docs.filter((d) => d.type === "SERVICE_PHOTO");
  const papers = docs.filter((d) => d.type !== "SERVICE_PHOTO");
  const file = (id: string, download = false) => `/s/${token}/file/${id}${download ? "?download=1" : ""}`;
  const label = (d: (typeof docs)[number]) => (d.type === "INVOICE" ? `Invoice ${invoice?.invoiceNumber ?? ""}` : d.type === "MANIFEST" ? `Waste manifest ${job.manifest?.manifestNumber ?? ""}` : d.title);

  return (
    <main className="min-h-screen bg-subtle">
      <div className="h-1.5 bg-accent" aria-hidden />
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <Image src={brand.logoPath} alt={brand.name} width={brand.logoSize.width} height={brand.logoSize.height} priority className="h-12 w-auto" />
        <section className="rounded-xl border bg-surface p-5 shadow-card">
          <p className="text-[13px] font-medium uppercase tracking-wide text-accent-strong">Service completed</p>
          <h1 className="mt-1 text-xl font-semibold">{job.location.name}</h1>
          <p className="text-[14px] text-muted-foreground">{job.location.addressLine1}, {job.location.city}, {job.location.state} {job.location.postalCode}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Service</dt><dd className="font-medium">{SERVICE_TYPE_LABEL[job.serviceType] ?? "Service"}</dd></div>
            <div><dt className="text-muted-foreground">Date</dt><dd className="font-medium">{formatDateKey(job.completedAt ? instantToDateKey(job.completedAt, tz) : keyFromDate(job.scheduledDate), "long")}</dd></div>
            {gallons > 0 && <div><dt className="text-muted-foreground">Gallons removed</dt><dd className="font-medium tabular-nums">{gallons.toLocaleString()}</dd></div>}
          </dl>
        </section>

        {invoice && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-5 shadow-card">
            <div>
              <p className="text-[13px] text-muted-foreground">Invoice {invoice.invoiceNumber}</p>
              <p className="text-2xl font-semibold tabular-nums">{invoice.balanceCents > 0 ? formatCents(invoice.balanceCents) : "Paid"}</p>
              {invoice.balanceCents > 0 && invoice.dueDate && <p className="text-[13px] text-muted-foreground">Due {formatDateKey(keyFromDate(invoice.dueDate), "long")}</p>}
            </div>
            {company.phone && <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-[14px] font-semibold text-white"><Phone className="h-4 w-4" />Call to pay</a>}
          </section>
        )}

        {papers.length > 0 && (
          <section className="rounded-xl border bg-surface shadow-card">
            <h2 className="border-b px-5 py-3 text-[15px] font-semibold">Paperwork</h2>
            <ul className="divide-y">
              {papers.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <a href={file(d.id)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-[14px] font-medium hover:text-brand"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{label(d)}</span></a>
                  <a href={file(d.id, true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-subtle"><Download className="h-3.5 w-3.5" />Download</a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {photos.length > 0 && (
          <section className="rounded-xl border bg-surface shadow-card">
            <h2 className="border-b px-5 py-3 text-[15px] font-semibold">Photos</h2>
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {photos.map((p) => (
                <a key={p.id} href={file(p.id)} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-md border bg-subtle">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file(p.id)} alt={p.title} loading="lazy" className="aspect-square w-full object-cover transition group-hover:opacity-90" />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">{p.photoPhase === "BEFORE" ? "Before" : "After"}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <p className="text-center text-[13px] text-muted-foreground">
          {company.name}{company.phone ? <> · <a className="font-medium text-brand" href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}>{company.phone}</a></> : null}{company.email ? <> · <a className="font-medium text-brand" href={`mailto:${company.email}`}>{company.email}</a></> : null}
        </p>
      </div>
    </main>
  );
}
