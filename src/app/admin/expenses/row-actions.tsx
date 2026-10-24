"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteExpenseAction, setExpenseReimbursedAction } from "@/app/admin/_actions/expenses";

export function ReimburseButton({ id, reimbursed, name }: { id: string; reimbursed: boolean; name: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button size="sm" variant={reimbursed ? "ghost" : "secondary"} disabled={pending} onClick={() => start(async () => {
      const res = await setExpenseReimbursedAction(id, !reimbursed);
      if (!res.ok) return void toast.error(res.error);
      toast.success(reimbursed ? "Marked as still owed." : `Marked as paid back to ${name}.`);
      router.refresh();
    })}>{reimbursed ? "Undo" : "Mark paid back"}</Button>
  );
}

export function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button size="sm" variant="ghost" aria-label="Delete cost" className="text-danger" disabled={pending} onClick={() => {
      if (!confirm("Delete this cost? It will no longer count toward your costs.")) return;
      start(async () => {
        const res = await deleteExpenseAction(id);
        if (!res.ok) return void toast.error(res.error);
        toast.success("Cost deleted.");
        router.refresh();
      });
    }}><Trash2 /></Button>
  );
}
