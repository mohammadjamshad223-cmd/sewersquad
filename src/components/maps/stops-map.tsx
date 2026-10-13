"use client";

import * as React from "react";
import { Loader2, MapPinOff } from "lucide-react";
import { loadGoogleMaps, onMapsAuthFailure, type GMap } from "./google-maps";

export type MapPoint = { id: string; lat: number; lng: number; title: string; subtitle?: string; color: string; href?: string; /** Short marker label, e.g. the stop number. */ label?: string };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Google map with one colored dot per point; click a dot for its name and a link. */
/** `route` joins the points in order with a line (the day's stop order). */
export function StopsMap({ points, height = 420, label, route = false }: { points: MapPoint[]; height?: number; label: string; route?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = React.useState("");
  const key = `${route}|` + points.map((p) => `${p.id}:${p.lat},${p.lng}:${p.color}:${p.label ?? ""}`).join("|");

  React.useEffect(() => onMapsAuthFailure((why) => {
    setState("error");
    setError(why);
  }), []);

  React.useEffect(() => {
    let cancelled = false;
    const markers: { setMap(m: GMap | null): void }[] = [];
    let line: { setMap(m: GMap | null): void } | null = null;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !ref.current) return;
        const map = new g.Map(ref.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "cooperative",
          // Quiet basemap so the stops stand out.
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
            { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
          ],
        });
        if (route && points.length > 1) {
          line = new g.Polyline({ map, path: points.map((p) => ({ lat: p.lat, lng: p.lng })), strokeColor: "#002957", strokeOpacity: 0.55, strokeWeight: 3, geodesic: true });
        }
        const info = new g.InfoWindow();
        const bounds = new g.LatLngBounds();
        for (const p of points) {
          const m = new g.Marker({
            map,
            position: { lat: p.lat, lng: p.lng },
            title: p.title,
            icon: { path: g.SymbolPath.CIRCLE, scale: p.label ? 12 : 8, fillColor: p.color, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
            ...(p.label ? { label: { text: p.label, color: "#ffffff", fontSize: "12px", fontWeight: "700" } } : {}),
          });
          m.addListener("click", () => {
            info.setContent(
              `<div style="font:13px Inter,system-ui,sans-serif;color:#0f172a;max-width:220px"><strong>${escapeHtml(p.title)}</strong>` +
                (p.subtitle ? `<div style="color:#64748b;margin-top:2px">${escapeHtml(p.subtitle)}</div>` : "") +
                (p.href ? `<div style="margin-top:6px"><a href="${escapeHtml(p.href)}" style="color:#002957;font-weight:600">Open</a></div>` : "") +
                `</div>`,
            );
            info.open({ map, anchor: m });
          });
          markers.push(m);
          bounds.extend({ lat: p.lat, lng: p.lng });
        }
        if (points.length === 1) {
          map.setCenter({ lat: points[0]!.lat, lng: points[0]!.lng });
          map.setZoom(15);
        } else if (points.length > 1) map.fitBounds(bounds, 48);
        else {
          map.setCenter({ lat: 29.7604, lng: -95.3698 });
          map.setZoom(10);
        }
        setState((s) => (s === "error" ? s : "ready"));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState("error");
        setError(e instanceof Error ? e.message : "Google Maps could not be loaded.");
      });
    return () => {
      cancelled = true;
      markers.forEach((m) => m.setMap(null));
      line?.setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="relative overflow-hidden rounded-md border bg-subtle" style={{ height }}>
      <div ref={ref} className="h-full w-full" role="region" aria-label={label} />
      {state !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-subtle p-6 text-center text-[13px] text-muted-foreground">
          {state === "loading" ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading map…</span>
          ) : (
            <span className="flex max-w-sm flex-col items-center gap-2"><MapPinOff className="h-5 w-5" aria-hidden />{error}</span>
          )}
        </div>
      )}
    </div>
  );
}
