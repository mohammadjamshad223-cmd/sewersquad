"use client";

/**
 * Minimal Google Maps JavaScript API loader + the few types this app uses.
 * One browser key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY), restricted in Google Cloud to this site's
 * domain, with the Maps JavaScript API and Geocoding API enabled.
 */
export type LatLng = { lat: number; lng: number };

type GLatLng = { lat(): number; lng(): number };
export type GMap = { fitBounds(b: GBounds, padding?: number): void; setCenter(c: LatLng): void; setZoom(z: number): void };
type GBounds = { extend(p: LatLng): void };
type GMarker = { addListener(ev: "click", fn: () => void): void; setMap(m: GMap | null): void };
type GInfoWindow = { setContent(c: string | HTMLElement): void; open(opts: { map: GMap; anchor: GMarker }): void; close(): void };
type GeocodeResult = { geometry: { location: GLatLng }; partial_match?: boolean };
type Geocoder = { geocode(req: { address: string; componentRestrictions?: { country: string } }): Promise<{ results: GeocodeResult[] }> };

export type GoogleMaps = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
  LatLngBounds: new () => GBounds;
  Marker: new (opts: Record<string, unknown>) => GMarker;
  InfoWindow: new (opts?: Record<string, unknown>) => GInfoWindow;
  Geocoder: new () => Geocoder;
  Polyline: new (opts: Record<string, unknown>) => { setMap(m: GMap | null): void };
  SymbolPath: { CIRCLE: number };
};

declare global {
  interface Window {
    google?: { maps: { importLibrary(name: string): Promise<Record<string, unknown>> } & Record<string, unknown> };
    __ssMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

const KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim();
export const mapsEnabled = KEY.length > 0;

let loading: Promise<GoogleMaps> | null = null;
let authFailed = false;
let lastError: string | null = null;
const authListeners = new Set<(why: string) => void>();

/**
 * Google only says *why* it rejected a key in the browser console ("Google Maps JavaScript API
 * error: RefererNotAllowedMapError"). Each code maps to the one setting to change in Google Cloud.
 */
const FIXES: Record<string, string> = {
  RefererNotAllowedMapError: "this website isn't on the key's allowed list. In Google Cloud → Credentials → your key → Website restrictions, add https://portal.sewersquadservices.com/*",
  ApiNotActivatedMapError: "the Maps JavaScript API is not turned on. In Google Cloud → APIs & Services → Library, enable “Maps JavaScript API” (and “Geocoding API”).",
  ApiTargetBlockedMapError: "the key's API restrictions don't include Maps. In Google Cloud → Credentials → your key → API restrictions, allow “Maps JavaScript API” and “Geocoding API”.",
  BillingNotEnabledMapError: "billing isn't turned on for the Google Cloud project. Link a billing account (Google's free monthly credit covers normal use).",
  InvalidKeyMapError: "the key itself is wrong. Copy it again from Google Cloud → Credentials into the Vercel variable NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, then redeploy.",
  MissingKeyMapError: "no key was sent. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Vercel, then redeploy.",
  ExpiredKeyMapError: "the key has expired or was deleted. Create a new one in Google Cloud → Credentials and update Vercel.",
  DeletedApiProjectMapError: "the Google Cloud project for this key was deleted. Create a new key and update Vercel.",
  OverQuotaMapError: "the daily usage limit was reached. Raise the quota in Google Cloud → APIs & Services → Quotas.",
};

export function mapsErrorMessage(code: string | null) {
  const fix = code ? FIXES[code] : null;
  return fix ? `Google rejected the Maps key (${code}): ${fix}` : `Google rejected the Maps key${code ? ` (${code})` : ""}. Check that the key allows https://portal.sewersquadservices.com/*, has the Maps JavaScript API enabled, and billing is on.`;
}

/** Subscribe to Google's "invalid key / referrer not allowed" callback. Receives a plain-language fix. */
export function onMapsAuthFailure(fn: (why: string) => void) {
  if (authFailed) fn(mapsErrorMessage(lastError));
  authListeners.add(fn);
  return () => void authListeners.delete(fn);
}

function watchConsoleForMapsErrors() {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const m = /Google Maps JavaScript API (?:error|warning): (\w+)/.exec(args.map(String).join(" "));
      if (m && m[1] && (FIXES[m[1]] || !lastError)) {
        lastError = m[1];
        if (authFailed) authListeners.forEach((fn) => fn(mapsErrorMessage(lastError)));
      }
      original(...args);
    };
  }
}

export function loadGoogleMaps(): Promise<GoogleMaps> {
  if (!mapsEnabled) return Promise.reject(new Error("Maps are not configured."));
  loading ??= new Promise<GoogleMaps>((resolve, reject) => {
    watchConsoleForMapsErrors();
    window.gm_authFailure = () => {
      authFailed = true;
      // Google logs the error code right around this callback; report after it lands.
      setTimeout(() => authListeners.forEach((fn) => fn(mapsErrorMessage(lastError))), 0);
    };
    window.__ssMapsReady = async () => {
      try {
        const g = window.google!.maps;
        const [maps, marker, geocoding, core] = await Promise.all(["maps", "marker", "geocoding", "core"].map((l) => g.importLibrary(l)));
        const pick = (name: string) => core![name] ?? maps![name] ?? marker![name] ?? geocoding![name] ?? g[name];
        resolve({
          Map: pick("Map"),
          Marker: pick("Marker"),
          InfoWindow: pick("InfoWindow"),
          Geocoder: pick("Geocoder"),
          LatLngBounds: pick("LatLngBounds"),
          Polyline: pick("Polyline"),
          SymbolPath: pick("SymbolPath"),
        } as unknown as GoogleMaps);
      } catch (e) {
        reject(e);
      }
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=__ssMapsReady`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Google Maps could not be loaded. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Address → coordinates (US only). Returns null when Google has no confident match. */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const g = await loadGoogleMaps();
  try {
    const { results } = await new g.Geocoder().geocode({ address, componentRestrictions: { country: "US" } });
    const best = results.find((r) => !r.partial_match) ?? null;
    if (!best) return null;
    return { lat: best.geometry.location.lat(), lng: best.geometry.location.lng() };
  } catch {
    return null; // ZERO_RESULTS and similar come back as rejections
  }
}
