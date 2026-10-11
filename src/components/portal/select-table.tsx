"use client";

import * as React from "react";

/** Checkbox selection helpers for tables inside a form (bulk pay / bulk download). */
export function SelectAll({ name, label = "Select all" }: { name: string; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 accent-[hsl(var(--brand))]"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => {
          if (!c.disabled) c.checked = e.currentTarget.checked;
        });
        form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

export function SelectionCount({ name, suffix = "selected" }: { name: string; suffix?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setCount(form.querySelectorAll(`input[type=checkbox][name="${name}"]:checked`).length);
    form.addEventListener("change", update);
    update();
    return () => form.removeEventListener("change", update);
  }, [name]);
  return (
    <span ref={ref} className="text-[13px] text-muted-foreground" aria-live="polite">
      {count} {suffix}
    </span>
  );
}
