import { requireStaffPage } from "@/server/authz/guards";
import { importPreview } from "@/server/services/records-import";
import { PageHeader } from "@/components/ui/misc";
import { ImportRunner } from "./runner";

export const metadata = { title: "Import your records" };
export const maxDuration = 60;

export default async function ImportPage() {
  await requireStaffPage("settings.write");
  const preview = await importPreview();
  return (
    <div>
      <PageHeader title="Import your records" description="One-time import of what you ran before the portal: customers, invoices 001–072, proposals and quotes, service reports and 90-day service schedules." breadcrumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Import records" }]} />
      <ImportRunner preview={preview} />
    </div>
  );
}
