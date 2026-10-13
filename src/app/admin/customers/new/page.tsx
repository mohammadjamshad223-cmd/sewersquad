import { redirect } from "next/navigation";

/** Customers are added together with their first service from the New Customer window. */
export default function NewCustomerRedirect() {
  redirect("/admin/new-customer");
}
