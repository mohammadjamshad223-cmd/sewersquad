import { Download, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/** Links to the authorized document endpoint (never a raw storage URL). */
export function DocLink({ id, children, download = true, className, version }: { id: string; children?: React.ReactNode; download?: boolean; className?: string; version?: number }) {
  const qs = new URLSearchParams();
  if (download) qs.set("download", "1");
  if (version) qs.set("v", String(version));
  const href = `/api/documents/${id}${qs.toString() ? `?${qs}` : ""}`;
  return (
    <a href={href} target={download ? undefined : "_blank"} rel="noopener" className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline", className)}>
      {download ? <Download className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
      {children ?? (download ? "Download" : "View")}
    </a>
  );
}
