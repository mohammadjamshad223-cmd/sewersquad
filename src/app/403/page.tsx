import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Your role does not include this permission. Ask a Sewer Squad administrator if you need access.</p>
      <Button asChild className="mt-6" variant="secondary">
        <Link href="/">Go to your dashboard</Link>
      </Button>
    </main>
  );
}
