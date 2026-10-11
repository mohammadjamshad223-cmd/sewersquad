import Link from "next/link";
import { requireDriverPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { AccountSettings } from "@/components/portal/account-settings";
import { Card, CardBody } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DRIVER_SECONDARY } from "@/components/shell/nav-config";
import { logoutAction } from "@/app/(auth)/actions";
import { formatDateKey } from "@/lib/dates";

export const metadata = { title: "Profile" };

export default async function DriverProfile() {
  const actor = await requireDriverPage();
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: actor.driverId }, include: { defaultVehicle: true } });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="grid grid-cols-2 gap-2">
        {DRIVER_SECONDARY.map((i) => (
          <Button key={i.href} asChild variant="secondary" size="xl"><Link href={i.href}><i.icon /> {i.label}</Link></Button>
        ))}
      </div>
      <Card>
        <CardBody>
          <DescriptionList items={[{ label: "Employee #", value: driver.employeeNumber }, { label: "Territory", value: driver.territory }, { label: "Assigned truck", value: driver.defaultVehicle?.unitNumber }, { label: "License", value: [driver.licenseClass, driver.licenseExpiry ? `exp. ${formatDateKey(driver.licenseExpiry)}` : null].filter(Boolean).join(" · ") || null }]} />
        </CardBody>
      </Card>
      <AccountSettings actor={actor} />
      <form action={logoutAction}><Button type="submit" variant="danger-outline" size="xl" className="w-full">Sign out</Button></form>
    </div>
  );
}
