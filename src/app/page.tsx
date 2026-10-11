import { redirect } from "next/navigation";
import { getActor, homePathFor } from "@/server/auth/session";

export default async function Home() {
  const actor = await getActor();
  redirect(actor ? homePathFor(actor) : "/login");
}
