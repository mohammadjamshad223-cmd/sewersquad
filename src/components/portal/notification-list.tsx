"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction } from "@/app/account/actions";

type Item = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string; when: string };

export function NotificationList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = items.filter((i) => !i.readAt).length;
  const mark = (ids: string[] | "all") => start(async () => {
    await markNotificationsReadAction(ids);
    router.refresh();
  });
  if (items.length === 0) return <EmptyState icon={Bell} title="You're all caught up" description="Notifications about services, documents and billing will appear here." />;
  return (
    <div>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <p className="text-[13px] text-muted-foreground">{unread} unread</p>
        <Button variant="ghost" size="sm" disabled={pending || unread === 0} onClick={() => mark("all")}>
          <CheckCheck /> Mark all read
        </Button>
      </div>
      <ul className="divide-y">
        {items.map((n) => (
          <li key={n.id} className={cn("flex gap-3 px-5 py-4", !n.readAt && "bg-brand-soft/40")}>
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{n.title}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{n.body}</p>
              <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                <span>{n.when}</span>
                {n.link && (
                  <Link href={n.link} onClick={() => !n.readAt && mark([n.id])} className="font-medium text-brand hover:underline">
                    Open
                  </Link>
                )}
                {!n.readAt && (
                  <button className="hover:text-foreground" onClick={() => mark([n.id])}>
                    Mark read
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
