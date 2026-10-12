"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileCheck2, RotateCcw, Send, XCircle } from "lucide-react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { finalizeReportAction, setProposalStatusAction } from "@/app/admin/_actions/paperwork";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

function StatusButton({ id, status, children, variant = "secondary" }: { id: string; status: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <ActionForm action={setProposalStatusAction as Act} refresh>
      <input type="hidden" name="proposalId" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton size="sm" variant={variant}>{children}</SubmitButton>
    </ActionForm>
  );
}

export function ProposalStatusActions({ id, status, word }: { id: string; status: string; word: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && <StatusButton id={id} status="SENT" variant="primary"><Send /> Mark sent</StatusButton>}
      {status === "SENT" && (
        <>
          <StatusButton id={id} status="ACCEPTED" variant="primary"><CheckCircle2 /> Accepted</StatusButton>
          <FormDialog trigger={<Button size="sm" variant="secondary"><XCircle /> Declined</Button>} title={`Mark ${word} declined`}>
            {(close) => (
              <ActionForm action={setProposalStatusAction as Act} className="space-y-4" onSuccess={close} refresh>
                <input type="hidden" name="proposalId" value={id} />
                <input type="hidden" name="status" value="DECLINED" />
                <Field label="Reason (optional)" name="note"><Input placeholder="Went with another vendor" /></Field>
                <SubmitButton>Mark declined</SubmitButton>
              </ActionForm>
            )}
          </FormDialog>
        </>
      )}
      {status !== "DRAFT" && <StatusButton id={id} status="DRAFT" variant="ghost"><RotateCcw /> Back to draft</StatusButton>}
    </div>
  );
}

export function FinalizeReportButton({ id, final }: { id: string; final: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant={final ? "secondary" : "primary"} disabled={pending} onClick={() => start(async () => { const r = await finalizeReportAction(id); if (!r.ok) setError(r.error ?? "Could not finalize."); else router.refresh(); })}>
        <FileCheck2 /> {final ? "Re-file PDF" : "Finalize & share with customer"}
      </Button>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}
