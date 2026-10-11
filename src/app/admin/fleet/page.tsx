import { redirect } from "next/navigation";
export default function Fleet() {
  redirect("/admin/drivers?tab=fleet");
}
