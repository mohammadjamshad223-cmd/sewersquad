"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { GeocodeDeniedError, geocodeAddress, mapsEnabled } from "./google-maps";
import { saveLocationCoordinatesAction } from "@/app/admin/_actions/customers";

export type GeocodeItem = { id: string; name: string; address: string };

/**
 * Finds map positions for locations that have an address but no coordinates, in the background,
 * using the browser's Google Maps key. Runs once per page view, at most `limit` lookups.
 */
export function AutoGeocode({ items, limit = 25 }: { items: GeocodeItem[]; limit?: number }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<{ working: boolean; done: number; failed: string[]; denied?: string }>({ working: false, done: 0, failed: [] });
  const ids = items.map((i) => i.id).join(",");

  React.useEffect(() => {
    if (!mapsEnabled || items.length === 0) return;
    let cancelled = false;
    (async () => {
      setStatus({ working: true, done: 0, failed: [] });
      let saved = 0;
      const failed: string[] = [];
      for (const item of items.slice(0, limit)) {
        if (cancelled) return;
        let pos: Awaited<ReturnType<typeof geocodeAddress>> = null;
        try {
          pos = await geocodeAddress(item.address);
        } catch (e) {
          if (e instanceof GeocodeDeniedError) {
            if (!cancelled) setStatus({ working: false, done: saved, failed, denied: e.message });
            return;
          }
        }
        if (!pos) {
          failed.push(item.name);
          continue;
        }
        const res = await saveLocationCoordinatesAction(item.id, pos.lat, pos.lng);
        if (!res.ok) break; // e.g. no permission to edit locations: stop quietly
        saved++;
        setStatus({ working: true, done: saved, failed });
        await new Promise((r) => setTimeout(r, 150)); // stay well under Google's rate limit
      }
      if (cancelled) return;
      setStatus({ working: false, done: saved, failed });
      if (saved > 0) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (status.denied) return <p role="alert" className="text-[12px] font-medium text-danger">{status.denied} Until then, stops without saved coordinates can&apos;t be placed on the map.</p>;
  if (!mapsEnabled || (!status.working && status.failed.length === 0)) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground">
      {status.working ? (
        <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Finding map positions from addresses… {status.done > 0 && `(${status.done} placed)`}</>
      ) : (
        <>Couldn&apos;t place {status.failed.length === 1 ? `"${status.failed[0]}"` : `${status.failed.length} locations`} on the map. Check the address, or enter latitude and longitude on the location.</>
      )}
    </p>
  );
}
