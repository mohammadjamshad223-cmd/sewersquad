import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { checkoutReturnStatus } from "@/server/services/payments";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";

export const metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

/**
 * Post-checkout landing page. It only READS state: invoices are updated exclusively by verified
 * Stripe webhooks, so arriving here never marks anything paid.
 */
export default async function PaymentReturn({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { actor } = await customerContext();
  const { session_id } = await searchParams;
  const p = session_id ? await checkoutReturnStatus(actor, session_id) : null;
  const state = !p ? "unknown" : p.status === "SUCCEEDED" ? "done" : p.status === "FAILED" || p.status === "CANCELLED" ? "failed" : "pending";
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="space-y-4 py-8 text-center">
          {state === "done" && <CheckCircle2 className="mx-auto h-10 w-10 text-success" />}
          {state === "pending" && <Clock className="mx-auto h-10 w-10 text-info" />}
          {(state === "failed" || state === "unknown") && <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />}
          <h1 className="text-xl font-semibold">
            {state === "done" ? "Payment received" : state === "pending" ? "Payment submitted — confirming" : state === "failed" ? "Payment not completed" : "We couldn't find that payment"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {state === "done" && `${formatCents(p!.amountCents)} was applied to ${p!.allocations.map((a) => a.invoice.invoiceNumber).join(", ")}. Your receipt is available in Payment history.`}
            {state === "pending" && "We're waiting for confirmation from our payment processor. Card payments usually confirm within a minute; bank payments can take several business days. This page refreshes automatically."}
            {state === "failed" && (p!.failureReason ?? "The payment did not go through. Your invoices remain open.")}
            {state === "unknown" && "If you completed a payment, it will appear in your payment history once confirmed."}
          </p>
          {state === "pending" && <meta httpEquiv="refresh" content="8" />}
          <div className="flex justify-center gap-2">
            <Button asChild variant="secondary"><Link href="/customer/invoices">Back to invoices</Link></Button>
            <Button asChild><Link href="/customer/payments">Payment history</Link></Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
