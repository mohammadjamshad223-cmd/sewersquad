import Link from "next/link";
import { verifyEmailToken } from "@/server/services/auth";
import { Alert } from "@/components/ui/misc";
import { AppError } from "@/server/errors";

export const metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let error: string | null = null;
  if (!token) error = "Missing verification token.";
  else {
    try {
      await verifyEmailToken(token);
    } catch (e) {
      error = e instanceof AppError ? e.message : "Verification failed.";
    }
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold">Email verification</h1>
      {error ? (
        <Alert tone="warning" className="mt-6" title="Could not verify">
          {error}
        </Alert>
      ) : (
        <Alert tone="success" className="mt-6" title="Email verified">
          Your email address has been updated. Use it the next time you sign in.
        </Alert>
      )}
      <p className="mt-6 text-[13px]">
        <Link href="/" className="font-medium text-brand hover:underline">
          Continue
        </Link>
      </p>
    </div>
  );
}
