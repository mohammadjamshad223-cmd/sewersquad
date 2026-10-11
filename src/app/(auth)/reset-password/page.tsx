import Link from "next/link";
import { peekAuthToken } from "@/server/auth/tokens";
import { Alert } from "@/components/ui/misc";
import { SetPasswordForm } from "../set-password-form";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valid = token ? await peekAuthToken(token, "PASSWORD_RESET") : null;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      {valid && token ? (
        <SetPasswordForm token={token} action={resetPasswordAction} cta="Update password" />
      ) : (
        <>
          <Alert tone="warning" className="mt-6" title="Link invalid or expired">
            Reset links expire after one hour and can be used once.
          </Alert>
          <p className="mt-6 text-[13px]">
            <Link href="/forgot-password" className="font-medium text-brand hover:underline">
              Request a new link
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
