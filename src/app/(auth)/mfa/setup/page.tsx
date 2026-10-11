import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { MfaSetup } from "./mfa-setup";

export const metadata = { title: "Set up two-factor authentication" };

export default async function MfaSetupPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mfaEnabled) redirect("/");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Set up two-factor authentication</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {actor.mfaEnrollmentRequired ? "Your role requires an authenticator app. " : ""}
        Scan the code with Google Authenticator, 1Password, Authy or a similar app.
      </p>
      <MfaSetup />
    </div>
  );
}
