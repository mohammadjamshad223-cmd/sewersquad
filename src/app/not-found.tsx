import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">It may have moved, or you may not have access to this record.</p>
      <Button asChild className="mt-6" variant="secondary">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </main>
  );
}
