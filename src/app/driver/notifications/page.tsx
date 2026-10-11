import { requireDriverPage } from "@/server/authz/guards";
import { NotificationsPage } from "@/components/portal/notifications-page";
import { parsePage } from "@/components/ui/pagination";

export const metadata = { title: "Notifications" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireDriverPage();
  return <NotificationsPage userId={actor.userId} page={parsePage((await searchParams).page)} basePath="/driver/notifications" />;
}
