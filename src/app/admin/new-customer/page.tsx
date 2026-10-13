import { requireStaffPage } from "@/server/authz/guards";
import { PageHeader } from "@/components/ui/misc";
import { todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { NewCustomerForm } from "./new-customer-form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ name?: string; contact?: string; email?: string; phone?: string; lead?: string }> }) {
  const sp = await searchParams;
  await requireStaffPage(["customers.write"]);
  const tz = await companyTimeZone();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New Customer" description="Add the customer and schedule their service in one step." />
      <NewCustomerForm today={todayKey(tz)} prefill={{ name: sp.name ?? "", contactName: sp.contact ?? "", email: sp.email ?? "", phone: sp.phone ?? "" }} leadId={sp.lead && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : undefined} />
    </div>
  );
}
