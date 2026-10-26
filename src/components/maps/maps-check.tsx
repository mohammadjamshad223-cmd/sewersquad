"use client";

import * as React from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { geocodeAddress, GeocodeDeniedError, loadGoogleMaps, mapsEnabled, mapsKeyHint, onMapsAuthFailure } from "./google-maps";

type Step = { label: string; ok: boolean | null; detail?: string };

/**
 * Runs the same steps the maps use, in this browser, against Google: key present in this deploy,
 * script loads, Google accepts the key for this website, and address lookups work. Each failure
 * says what to change in Google Cloud.
 */
export function MapsCheck({ testAddress }: { testAddress: string }) {
  const [steps, setSteps] = React.useState<Step[] | null>(null);
  const [running, setRunning] = React.useState(false);
  const mapRef = React.useRef<HTMLDivElement>(null);

  const run = async () => {
    setRunning(true);
    const out: Step[] = [];
    const push = (s: Step) => { out.push(s); setSteps([...out]); };
    const site = `${window.location.origin}/*`;
    if (!mapsEnabled) {
      push({ label: "Maps key in this deploy", ok: false, detail: "No key. In Vercel → Settings → Environment Variables add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Production), then Redeploy — the key is built in when the site is deployed." });
      setRunning(false);
      return;
    }
    push({ label: "Maps key in this deploy", ok: true, detail: `Key ending ${mapsKeyHint}. If that's not the key you expect, update it in Vercel and Redeploy.` });

    let authError: string | null = null;
    const stop = onMapsAuthFailure((why) => { authError = why; });
    try {
      const g = await loadGoogleMaps();
      push({ label: "Google Maps script loads", ok: true });
      // Google only checks the key against this website when a map is drawn.
      new g.Map(mapRef.current!, { center: { lat: 29.76, lng: -95.37 }, zoom: 10 });
      await new Promise((r) => setTimeout(r, 4000));
      push(authError ? { label: "Google accepts the key for this website", ok: false, detail: `${authError} The website to allow is ${site}` } : { label: "Google accepts the key for this website", ok: true, detail: `Allowed for ${site}` });
    } catch (e) {
      push({ label: "Google Maps script loads", ok: false, detail: `${e instanceof Error ? e.message : "Couldn't load."} If you use an ad or content blocker, allow maps.googleapis.com.` });
    } finally {
      stop();
    }

    if (!authError && out.every((s) => s.ok)) {
      try {
        const pos = await geocodeAddress(testAddress);
        push(pos ? { label: "Address lookups (Geocoding API)", ok: true, detail: `Found ${testAddress}` } : { label: "Address lookups (Geocoding API)", ok: false, detail: `Google returned no match for “${testAddress}”. Lookups work, but check your company address in Settings → Company.` });
      } catch (e) {
        push({ label: "Address lookups (Geocoding API)", ok: false, detail: e instanceof GeocodeDeniedError ? e.message : String(e) });
      }
    }
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={run} disabled={running}>{running ? <><Loader2 className="animate-spin" /> Testing…</> : "Test Google Maps"}</Button>
        <p className="text-[13px] text-muted-foreground">Checks the key, this website&apos;s permission and address lookups, right here in your browser.</p>
      </div>
      {steps && (
        <ul className="space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-2 text-[13px]">
              {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <span><span className="font-medium">{s.label}</span>{s.detail ? <span className="block text-muted-foreground">{s.detail}</span> : null}</span>
            </li>
          ))}
          {!running && steps.every((s) => s.ok) && <li className="text-[13px] font-medium text-success">Everything works. If a map still looks empty, the stops may be missing addresses.</li>}
        </ul>
      )}
      <div ref={mapRef} aria-hidden className="h-24 w-full overflow-hidden rounded-md border" style={{ display: steps ? "block" : "none" }} />
    </div>
  );
}
