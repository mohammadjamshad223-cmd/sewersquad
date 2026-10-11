import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/** Period-over-period change. Shown only when a previous value exists. */
export function Delta({ value, previous, invert = false }: { value: number; previous: number; invert?: boolean }) {
  if (!previous) return <span className="text-muted-foreground">No prior-period data</span>;
  const pct = ((value - previous) / previous) * 100;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={good ? "text-success" : "text-danger"}>
      <Icon className="inline h-3.5 w-3.5" aria-hidden /> {Math.abs(pct).toFixed(1)}% <span className="text-muted-foreground">vs last month</span>
    </span>
  );
}
