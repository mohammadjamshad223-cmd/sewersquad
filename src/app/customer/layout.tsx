import { AppShell } from "@/components/shell/app-shell";
import { LocationSwitcher } from "@/components/shell/location-switcher";
import { logoutAction } from "@/app/(auth)/actions";
import { customerContext } from "@/server/customer-context";
import { unreadCount } from "@/server/services/notifications";
import { ORG_ROLE_LABEL } from "@/lib/status";
import { EmptyState } from "@/components/ui/misc";
import { Building2 } from "lucide-react";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { actor, scope, selectedLocationId } = await customerContext();
  const unread = await unreadCount(actor.userId);
  const primaryOrg = scope.organizations[0];
  return (
    <AppShell
      portal="customer"
      user={{ name: actor.name, email: actor.email, roleLabel: primaryOrg ? `${ORG_ROLE_LABEL[primaryOrg.role]} · ${primaryOrg.name}` : "Customer" }}
      permissions={[]}
      unread={unread}
      logoutAction={logoutAction}
      topbarSlot={<LocationSwitcher locations={scope.locations} selectedId={selectedLocationId} orgName={primaryOrg?.name ?? ""} allowAll />}
    >
      {scope.locations.length === 0 ? (
        <EmptyState icon={Building2} title="No locations assigned yet" description="Your account isn't linked to any service locations. Contact Sewer Squad and we'll get you set up." />
      ) : (
        children
      )}
    </AppShell>
  );
}
