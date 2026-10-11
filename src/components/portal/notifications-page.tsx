import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { listNotifications } from "@/server/services/notifications";
import { formatInstant } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { NotificationList } from "./notification-list";

export async function NotificationsPage({ userId, page, basePath }: { userId: string; page: number; basePath: string }) {
  const [{ items, total, pageSize }, tz] = await Promise.all([listNotifications(userId, { page }), companyTimeZone()]);
  return (
    <div>
      <PageHeader title="Notifications" description="Updates about your services, documents, billing and account." />
      <Card>
        <NotificationList items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(), when: formatInstant(n.createdAt, tz) }))} />
        {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={{}} basePath={basePath} />}
      </Card>
    </div>
  );
}
