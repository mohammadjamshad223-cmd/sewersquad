import { notFound } from "next/navigation";
import { setupAvailable } from "@/server/services/bootstrap";
import { SetupForm } from "./setup-form";

export const metadata = { title: "First-time setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await setupAvailable())) notFound();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Set up Sewer Squad</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create the owner (Super Admin) account. You&apos;ll need the setup code you saved in your hosting settings as <code>SETUP_TOKEN</code>.
        This page disappears once the account exists.
      </p>
      <SetupForm />
    </div>
  );
}
