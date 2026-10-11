import { customerContext } from "@/server/customer-context";
import { NotificationsPage } from "@/components/portal/notifications-page";
import { parsePage } from "@/components/ui/pagination";

export const metadata = { title: "Notifications" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { actor } = await customerContext();
  return <NotificationsPage userId={actor.userId} page={parsePage((await searchParams).page)} basePath="/customer/notifications" />;
}
