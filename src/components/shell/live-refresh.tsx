"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Lightweight real-time updates via efficient polling (works on serverless hosting where
 * long-lived connections are unreliable). The server returns a version token derived from the
 * latest relevant change for this user; when it changes we re-render server components.
 * Pauses while the tab is hidden, backs off on errors, and resumes on reconnect.
 */
export function LiveRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const version = React.useRef<string | null>(null);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && navigator.onLine) {
        try {
          const res = await fetch("/api/live", { cache: "no-store", credentials: "same-origin" });
          if (res.ok) {
            const { v } = (await res.json()) as { v: string };
            if (version.current && v !== version.current) router.refresh();
            version.current = v;
            failures = 0;
          } else if (res.status === 401) {
            stopped = true;
            return;
          } else failures++;
        } catch {
          failures++;
        }
      }
      timer = setTimeout(tick, Math.min(intervalMs * 2 ** failures, 5 * 60_000));
    };

    const wake = () => {
      clearTimeout(timer);
      void tick();
    };
    timer = setTimeout(tick, 1500);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [router, intervalMs]);

  return null;
}
