import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (server-rendered, shareable, keyboard accessible as links). */
export function Tabs({ tabs, active, basePath, extra }: { tabs: { key: string; label: string; count?: number }[]; active: string; basePath: string; extra?: Record<string, string> }) {
  return (
    <nav aria-label="Sections" className="mb-5 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const qs = new URLSearchParams({ ...(extra ?? {}), ...(t.key === tabs[0]!.key ? {} : { tab: t.key }) }).toString();
          return (
            <li key={t.key}>
              <Link
                href={qs ? `${basePath}?${qs}` : basePath}
                aria-current={active === t.key ? "page" : undefined}
                className={cn("-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13.5px] font-medium", active === t.key ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
                {t.count !== undefined && <span className="rounded-full bg-subtle px-1.5 text-[11px] tabular-nums text-muted-foreground">{t.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
