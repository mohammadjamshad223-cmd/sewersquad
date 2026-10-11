import { requireStaffPage } from "@/server/authz/guards";
import { AccountSettings } from "@/components/portal/account-settings";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Account & security" };

export default async function Account() {
  const actor = await requireStaffPage();
  return (
    <div className="max-w-4xl">
      <PageHeader title="Account & security" />
      <AccountSettings actor={actor} />
    </div>
  );
}
