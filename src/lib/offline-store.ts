/**
 * Encrypted on-device storage for driver drafts and queued photos (client only).
 *
 * - Data is stored in IndexedDB, encrypted with AES-GCM.
 * - The key is a NON-EXTRACTABLE WebCrypto key persisted in IndexedDB: script on this origin can
 *   use it but cannot read the raw key material, and the data is unreadable if copied off the
 *   device's browser profile. This protects against casual inspection of the stored files; it is
 *   not a defense against malware running inside the signed-in browser.
 * - Nothing is deleted until the server confirms it was saved.
 */
const DB_NAME = "sewersquad-offline";
const DB_VERSION = 1;

type Store = "keys" | "drafts" | "photos";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["keys", "drafts", "photos"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const existing = await tx<CryptoKey | undefined>("keys", "readonly", (s) => s.get("main"));
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await tx("keys", "readwrite", (s) => s.put(key, "main"));
    return key;
  })();
  return keyPromise;
}

async function encrypt(data: ArrayBuffer): Promise<{ iv: Uint8Array; ct: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await getKey(), data);
  return { iv, ct };
}

async function decrypt(rec: { iv: Uint8Array; ct: ArrayBuffer }): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, await getKey(), rec.ct);
}

export function offlineAvailable() {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

// ── Drafts ───────────────────────────────────────────────────────────────────

export async function saveLocalDraft<T>(jobId: string, value: T) {
  const enc = await encrypt(new TextEncoder().encode(JSON.stringify({ value, savedAt: Date.now() })).buffer as ArrayBuffer);
  await tx("drafts", "readwrite", (s) => s.put(enc, jobId));
}

export async function loadLocalDraft<T>(jobId: string): Promise<{ value: T; savedAt: number } | null> {
  const rec = await tx<{ iv: Uint8Array; ct: ArrayBuffer } | undefined>("drafts", "readonly", (s) => s.get(jobId));
  if (!rec) return null;
  try {
    return JSON.parse(new TextDecoder().decode(await decrypt(rec)));
  } catch {
    return null;
  }
}

export async function clearLocalDraft(jobId: string) {
  await tx("drafts", "readwrite", (s) => s.delete(jobId));
}

// ── Photo queue ──────────────────────────────────────────────────────────────

export type QueuedPhoto = { id: string; jobId: string; phase: "BEFORE" | "AFTER" | "ISSUE"; assetId: string | null; name: string; type: string; createdAt: number };

export async function queuePhoto(meta: Omit<QueuedPhoto, "id" | "createdAt">, blob: Blob): Promise<QueuedPhoto> {
  const id = crypto.randomUUID();
  const full: QueuedPhoto = { ...meta, id, createdAt: Date.now() };
  const enc = await encrypt(await blob.arrayBuffer());
  await tx("photos", "readwrite", (s) => s.put({ meta: full, ...enc }, id));
  return full;
}

export async function listQueuedPhotos(jobId: string): Promise<(QueuedPhoto & { blob: Blob })[]> {
  const all = await tx<{ meta: QueuedPhoto; iv: Uint8Array; ct: ArrayBuffer }[]>("photos", "readonly", (s) => s.getAll());
  const mine = all.filter((r) => r.meta.jobId === jobId).sort((a, b) => a.meta.createdAt - b.meta.createdAt);
  const out = [];
  for (const r of mine) {
    try {
      out.push({ ...r.meta, blob: new Blob([await decrypt(r)], { type: r.meta.type }) });
    } catch {
      /* undecryptable (key reset) — leave in place for support rather than discard silently */
    }
  }
  return out;
}

export async function removeQueuedPhoto(id: string) {
  await tx("photos", "readwrite", (s) => s.delete(id));
}

// ── Image compression ────────────────────────────────────────────────────────

/** Downscale to ≤1600px JPEG for faster uploads on cellular. Falls back to the original file. */
export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
