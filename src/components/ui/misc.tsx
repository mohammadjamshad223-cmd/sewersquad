import * as React from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                {b.href ? (
                  <Link href={b.href} className="hover:text-foreground">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-foreground">{b.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "danger" | "warning" | "success" | "brand";
  href?: string;
  footer?: React.ReactNode;
}) {
  const toneCls = { neutral: "text-muted-foreground bg-subtle", danger: "text-danger bg-danger-soft", warning: "text-warning bg-warning-soft", success: "text-success bg-success-soft", brand: "text-brand bg-brand-soft" }[tone];
  const inner = (
    <div className="flex h-full flex-col rounded-lg border bg-surface p-4 shadow-card transition-colors">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", toneCls)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg hover:[&>div]:border-brand/30">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function DescriptionList({ items, className, columns = 2 }: { items: { label: string; value: React.ReactNode }[]; className?: string; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{it.label}</dt>
          <dd className="mt-1 break-words text-sm">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = "info", title, children, icon: Icon, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: React.ReactNode; icon?: LucideIcon; className?: string }) {
  const cls = { info: "border-info/20 bg-info-soft text-info", warning: "border-warning/25 bg-warning-soft text-warning", danger: "border-danger/20 bg-danger-soft text-danger", success: "border-success/20 bg-success-soft text-success" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 text-foreground">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("text-[13px] text-foreground/80", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
