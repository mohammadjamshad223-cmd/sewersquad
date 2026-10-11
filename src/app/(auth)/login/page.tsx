import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, homePathFor } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { Alert } from "@/components/ui/misc";
import { setupAvailable } from "@/server/services/bootstrap";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const actor = await getActor();
  if (actor && (!actor.mfaEnabled || actor.mfaVerified) && !actor.mfaEnrollmentRequired) redirect(homePathFor(actor));
  const sp = await searchParams;
  const firstRun = await setupAvailable();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Customer, driver and staff access.</p>
      {firstRun && (
        <Alert tone="info" className="mt-6" title="No owner account yet">
          This portal hasn&apos;t been set up. <Link href="/setup" className="font-medium text-brand hover:underline">Create the owner account</Link> with your setup code.
        </Alert>
      )}
      {sp.reset && (
        <Alert tone="success" className="mt-6" title="Password updated">
          Sign in with your new password.
        </Alert>
      )}
      <LoginForm next={sp.next} />
      <p className="mt-6 text-[13px] text-muted-foreground">
        Access is by invitation. Need an account? Contact your Sewer Squad representative.
      </p>
      <p className="mt-2 text-[13px]">
        <Link href="/forgot-password" className="font-medium text-brand hover:underline">
          Forgot your password?
        </Link>
      </p>
    </div>
  );
}
