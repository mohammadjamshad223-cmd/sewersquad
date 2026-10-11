import { peekAuthToken } from "@/server/auth/tokens";
import { Alert } from "@/components/ui/misc";
import { SetPasswordForm } from "../../set-password-form";
import { acceptInviteAction } from "../../actions";

export const metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invite = token ? await peekAuthToken(token, "INVITATION") : null;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome to Sewer Squad</h1>
      {invite && token ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a password for <span className="font-medium text-foreground">{invite.email}</span>.
          </p>
          <SetPasswordForm token={token} action={acceptInviteAction} cta="Create account" />
        </>
      ) : (
        <Alert tone="warning" className="mt-6" title="Invitation invalid or expired">
          Invitations expire after 7 days. Ask your Sewer Squad contact to send a new one.
        </Alert>
      )}
    </div>
  );
}
