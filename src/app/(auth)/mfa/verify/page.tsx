import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { MfaVerifyForm } from "./verify-form";

export const metadata = { title: "Two-factor verification" };

export default async function MfaVerifyPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.mfaEnabled || actor.mfaVerified) redirect("/");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Two-factor verification</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter the code from your authenticator app, or a recovery code.</p>
      <MfaVerifyForm />
    </div>
  );
}
