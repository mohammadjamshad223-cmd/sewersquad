import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ className, title, description, action, children }: { className?: string; title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b px-5 py-4", className)}>
      <div className="min-w-0">
        {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t bg-subtle/50 px-5 py-3", className)} {...props} />;
}
