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
const authListeners = new Set<() => void>();

/** Subscribe to Google's "invalid key / referrer not allowed" callback. */
export function onMapsAuthFailure(fn: () => void) {
  if (authFailed) fn();
  authListeners.add(fn);
  return () => void authListeners.delete(fn);
}

export function loadGoogleMaps(): Promise<GoogleMaps> {
  if (!mapsEnabled) return Promise.reject(new Error("Maps are not configured."));
  loading ??= new Promise<GoogleMaps>((resolve, reject) => {
    window.gm_authFailure = () => {
      authFailed = true;
      authListeners.forEach((fn) => fn());
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
