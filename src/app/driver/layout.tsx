import { requireDriverPage } from "@/server/authz/guards";
import { DriverShell } from "@/components/shell/driver-shell";
import { unreadCount } from "@/server/services/notifications";
import { prisma } from "@/server/db";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireDriverPage();
  const [unread, driver] = await Promise.all([
    unreadCount(actor.userId),
    prisma.driver.findUnique({ where: { id: actor.driverId }, select: { defaultVehicle: { select: { unitNumber: true } } } }),
  ]);
  return (
    <DriverShell driverName={actor.name} truck={driver?.defaultVehicle?.unitNumber ?? null} unread={unread}>
      {children}
    </DriverShell>
  );
}
