"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { announceSuccess } from "@/components/ui/form";
import { compressImage } from "@/lib/offline-store";
import { attachJobFilesAction } from "@/app/admin/_actions/billing";

const KINDS = [
  { value: "AFTER", label: "After photos" },
  { value: "BEFORE", label: "Before photos" },
  { value: "MANIFEST", label: "Signed / scanned manifest" },
  { value: "DOCUMENT", label: "Other document" },
] as const;

/** Office upload of photos and files onto a job. Photos are downscaled in the browser first. */
export function JobFilesForm({ jobId, completed }: { jobId: string; completed: boolean }) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [kind, setKind] = React.useState<(typeof KINDS)[number]["value"]>("AFTER");
  const [pending, start] = React.useTransition();
  const isPhoto = kind === "BEFORE" || kind === "AFTER";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const picked = Array.from((form.elements.namedItem("files") as HTMLInputElement).files ?? []);
    if (!picked.length) return void toast.error("Choose at least one file.");
    start(async () => {
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("kind", kind);
      fd.set("title", (form.elements.namedItem("title") as HTMLInputElement).value);
      const visible = form.elements.namedItem("visible") as HTMLInputElement | null;
      if (!visible || visible.checked) fd.set("visible", "on");
      for (const f of picked) {
        const blob = f.type.startsWith("image/") ? await compressImage(f) : f;
        fd.append("files", blob, blob === f ? f.name : f.name.replace(/\.\w+$/, "") + ".jpg");
      }
      const res = await attachJobFilesAction({ ok: true }, fd);
      if (res.ok) {
        announceSuccess(res);
        formRef.current?.reset();
        setKind("AFTER");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-[13px] font-medium">
        <span>What are you adding?</span>
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
      </label>
      <label className="space-y-1.5 text-[13px] font-medium">
        <span>Title <span className="font-normal text-muted-foreground">(optional)</span></span>
        <Input name="title" maxLength={120} placeholder={isPhoto ? "e.g. Interceptor after pumping" : "e.g. City inspection report"} />
      </label>
      <label className="space-y-1.5 text-[13px] font-medium sm:col-span-2">
        <span>Files <span className="font-normal text-muted-foreground">(up to 10 · {isPhoto ? "photos" : "PDF or photos"})</span></span>
        <Input name="files" type="file" multiple accept={isPhoto ? "image/*" : "application/pdf,image/*"} />
      </label>
      {isPhoto && !completed ? (
        <p className="text-[13px] text-muted-foreground sm:col-span-2">Before and after photos are shared with the customer when the job is approved.</p>
      ) : (
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <Checkbox name="visible" defaultChecked />
          <span>Visible to the customer</span>
        </label>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} {pending ? "Uploading…" : "Add to job"}
        </Button>
      </div>
    </form>
  );
}
