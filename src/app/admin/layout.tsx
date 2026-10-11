import { requireStaffPage } from "@/server/authz/guards";
import { AppShell } from "@/components/shell/app-shell";
import { logoutAction } from "@/app/(auth)/actions";
import { unreadCount } from "@/server/services/notifications";
import { prisma } from "@/server/db";
import { SYSTEM_ROLES } from "@/server/authz/permissions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffPage();
  const perms = [...actor.permissions];
  const [unread, emergencies, review, support] = await Promise.all([
    unreadCount(actor.userId),
    perms.includes("emergencies.manage") ? prisma.emergencyRequest.count({ where: { status: { in: ["SUBMITTED", "ACKNOWLEDGED", "CONTACTING_CUSTOMER", "AWAITING_APPROVAL"] } } }) : 0,
    perms.includes("jobs.approve") ? prisma.job.count({ where: { status: "SUBMITTED" } }) : 0,
    perms.includes("support.manage") ? prisma.supportTicket.count({ where: { status: "OPEN" } }) : 0,
  ]);
  const roleLabel = SYSTEM_ROLES[actor.roleKey as keyof typeof SYSTEM_ROLES]?.name ?? "Staff";
  return (
    <AppShell
      portal="admin"
      user={{ name: actor.name, email: actor.email, roleLabel }}
      permissions={perms}
      badges={{ emergencies, review, support }}
      unread={unread}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
