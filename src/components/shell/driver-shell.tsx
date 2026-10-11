"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bell, Building2, WifiOff } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { brand } from "@/config/brand";
import { DRIVER_NAV } from "./nav-config";
import { LiveRefresh } from "./live-refresh";

/** Mobile-first driver layout: compact top bar, large bottom tab bar for gloved / one-handed use. */
export function DriverShell({ driverName, truck, unread, officeHref, children }: { driverName: string; truck: string | null; unread: number; officeHref?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Image src={brand.markPath} alt={brand.name} width={30} height={30} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-semibold">{driverName}</p>
            <p className="truncate text-[12px] text-muted-foreground">{truck ? `Truck ${truck}` : "No truck assigned"}</p>
          </div>
          {officeHref && (
            <Link href={officeHref} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-brand hover:bg-brand-soft">
              <Building2 className="h-4 w-4" aria-hidden /> Office
            </Link>
          )}
          <Link href="/driver/notifications" className="relative rounded-lg p-2.5 hover:bg-subtle" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface" />}
          </Link>
        </div>
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-[13px] font-medium text-warning">
            <WifiOff className="h-4 w-4" /> Offline — drafts are kept on this device and sync when you reconnect.
          </div>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4">
        {children}
      </main>
      <nav aria-label="Driver" className="fixed inset-x-0 bottom-0 z-30 border-t bg-surface pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {DRIVER_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium", active ? "text-brand" : "text-muted-foreground")}
                >
                  <item.icon className={cn("h-6 w-6", active && "stroke-[2.25]")} aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <LiveRefresh intervalMs={30_000} />
    </div>
  );
}
