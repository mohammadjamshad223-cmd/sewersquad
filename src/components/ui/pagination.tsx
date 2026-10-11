import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Server-side pagination links that preserve the current query string. */
export function Pagination({ page, pageSize, total, searchParams, basePath }: { page: number; pageSize: number; total: number; searchParams: Record<string, string | undefined>; basePath: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "inline-flex h-8 items-center gap-1 rounded-md border bg-surface px-2.5 text-[13px] hover:bg-subtle";
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-[13px] text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkCls} href={href(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" /> Prev
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-40")} aria-disabled>
            <ChevronLeft className="h-4 w-4" /> Prev
          </span>
        )}
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link className={linkCls} href={href(page + 1)} aria-label="Next page">
            Next <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-40")} aria-disabled>
            Next <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  );
}

export function parsePage(v: string | undefined) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
