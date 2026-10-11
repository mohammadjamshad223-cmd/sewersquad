"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, Search, User, X } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { brand } from "@/config/brand";
import { ADMIN_NAV, CUSTOMER_NAV, type NavGroup } from "./nav-config";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { LiveRefresh } from "./live-refresh";

type ShellProps = {
  portal: "admin" | "customer";
  user: { name: string; email: string; roleLabel: string };
  permissions: string[];
  badges?: Record<string, number>;
  unread: number;
  topbarSlot?: React.ReactNode;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
};

const COLLAPSE_KEY = "ss.sidebar.collapsed";

export function AppShell({ portal, user, permissions, badges = {}, unread, topbarSlot, logoutAction, children }: ShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const groups: NavGroup[] = (portal === "admin" ? ADMIN_NAV : CUSTOMER_NAV)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.permission || (Array.isArray(i.permission) ? i.permission.some((p) => permissions.includes(p)) : permissions.includes(i.permission))),
    }))
    .filter((g) => g.items.length > 0);

  const notificationsHref = portal === "admin" ? "/admin/notifications" : "/customer/notifications";
  const profileHref = portal === "admin" ? "/admin/account" : "/customer/settings";

  const nav = (isCollapsed: boolean) => (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label && !isCollapsed && <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const count = item.badgeKey ? badges[item.badgeKey] ?? 0 : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors",
                      active ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-subtle hover:text-foreground",
                      isCollapsed && "justify-center px-0",
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {count > 0 && (
                      <span
                        className={cn(
                          "rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-5 text-white tabular-nums",
                          isCollapsed && "absolute ml-6 -mt-5 px-1 text-[10px] leading-4",
                        )}
                        aria-label={`${count} pending`}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-surface transition-[width] duration-200 lg:flex", collapsed ? "w-[68px]" : "w-60")}>
        <div className={cn("flex h-14 items-center border-b px-4", collapsed && "justify-center px-0")}>
          <Link href={portal === "admin" ? "/admin/dashboard" : "/customer/dashboard"} aria-label={`${brand.name} home`}>
            {collapsed ? <Image src={brand.markPath} alt="" width={28} height={28} /> : <Image src={brand.logoPath} alt={brand.name} width={140} height={27} className="h-7 w-auto" />}
          </Link>
        </div>
        {nav(collapsed)}
        <div className="border-t p-3">
          <button onClick={toggle} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-subtle", collapsed && "justify-center px-0")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-pop">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <Image src={brand.logoPath} alt={brand.name} width={140} height={27} className="h-7 w-auto" />
              <button onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 hover:bg-subtle" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-md p-1.5 hover:bg-subtle lg:hidden" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">{portal === "admin" ? <GlobalSearch /> : topbarSlot}</div>
          <Link href={notificationsHref} className="relative rounded-md p-2 text-muted-foreground hover:bg-subtle hover:text-foreground" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />}
          </Link>
          <Dropdown>
            <DropdownTrigger className="flex items-center gap-2 rounded-md p-1 hover:bg-subtle" aria-label="Account menu">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-brand-foreground">{initials(user.name)}</span>
              <span className="hidden text-left md:block">
                <span className="block text-[13px] font-medium leading-4">{user.name}</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">{user.roleLabel}</span>
              </span>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownLabel>
                <span className="block text-foreground">{user.name}</span>
                <span className="block font-normal">{user.email}</span>
              </DropdownLabel>
              <DropdownSeparator />
              <DropdownItem asChild>
                <Link href={profileHref}>
                  <User /> Account &amp; security
                </Link>
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem onSelect={() => void logoutAction()}>
                <LogOut /> Sign out
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
      <LiveRefresh />
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customers, invoices, manifests, jobs…"
        aria-label="Global search"
        className="h-9 w-full rounded-md border border-transparent bg-subtle pl-8 pr-14 text-sm placeholder:text-muted-foreground focus:border-input focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-surface px-1.5 text-[11px] text-muted-foreground sm:block">⌘K</kbd>
    </form>
  );
}
