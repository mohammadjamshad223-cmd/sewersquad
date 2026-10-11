"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, Select } from "./input";
import { Button } from "./button";

/** URL-driven filter bar. Each control writes to the query string so results are server-rendered and shareable. */
export function FilterBar({
  search,
  selects = [],
  dates,
  children,
}: {
  search?: { placeholder: string; param?: string };
  selects?: { param: string; label: string; options: { value: string; label: string }[] }[];
  dates?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(sp.get(search?.param ?? "q") ?? "");

  const update = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, sp],
  );

  React.useEffect(() => {
    const param = search?.param ?? "q";
    if ((sp.get(param) ?? "") === q) return;
    const t = setTimeout(() => update({ [param]: q || null }), 300);
    return () => clearTimeout(t);
  }, [q, search?.param, sp, update]);

  const active = selects.some((s) => sp.get(s.param)) || sp.get("from") || sp.get("to") || q;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      {search && (
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} className="pl-8" />
        </div>
      )}
      {selects.map((s) => (
        <Select key={s.param} aria-label={s.label} value={sp.get(s.param) ?? ""} onChange={(e) => update({ [s.param]: e.target.value || null })} className="w-auto min-w-[150px]">
          <option value="">{s.label}: All</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}
      {dates && (
        <>
          <Input type="date" aria-label="From date" value={sp.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} className="w-auto" />
          <span className="text-muted-foreground" aria-hidden>
            –
          </span>
          <Input type="date" aria-label="To date" value={sp.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} className="w-auto" />
        </>
      )}
      {children}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            router.replace(pathname);
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
