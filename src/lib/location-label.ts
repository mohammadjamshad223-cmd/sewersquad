/**
 * Dropdown labels for locations: when two locations read the same, add the street
 * ("Now & Forever Gas Station — Beechnut St"); when they're also on the same street, add the
 * building number too ("— 13905 Westheimer Rd"). Works whatever is stored, and doesn't repeat a
 * street the name already ends with.
 */
export type LabelledLocation = { id: string; name: string; addressLine1?: string | null };

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const streetOf = (addr: string) => addr.normalize("NFKC").replace(/\s+/g, " ").trim().replace(/^\d+[0-9A-Za-z-]*\s+/, "");

/** The name without a " — street" / " — address" suffix that matches its own address. */
function baseName(name: string, addr: string) {
  const clean = name.normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const tail of [streetOf(addr), addr.normalize("NFKC").replace(/\s+/g, " ").trim()]) {
    if (tail && norm(clean).endsWith(` — ${norm(tail)}`)) return clean.slice(0, clean.length - tail.length - 3).trim();
  }
  return clean;
}

export function locationLabels<T extends LabelledLocation>(locations: T[]): Map<string, string> {
  const rows = locations.map((l) => {
    const addr = (l.addressLine1 ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    return { id: l.id, addr, street: streetOf(addr), base: baseName(l.name, addr) };
  });
  const count = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  const byName = count((r) => norm(r.base));
  const byStreet = count((r) => `${norm(r.base)}|${norm(r.street)}`);
  return new Map(
    rows.map((r) => {
      if ((byName.get(norm(r.base)) ?? 0) < 2 || !r.addr) return [r.id, locations.find((l) => l.id === r.id)!.name.trim()];
      const tag = !r.street || (byStreet.get(`${norm(r.base)}|${norm(r.street)}`) ?? 0) > 1 ? r.addr : r.street;
      return [r.id, `${r.base} — ${tag}`];
    }),
  );
}

/** Convenience: the same list with a `label` on each item. */
export function withLocationLabels<T extends LabelledLocation>(locations: T[]): (T & { label: string })[] {
  const labels = locationLabels(locations);
  return locations.map((l) => ({ ...l, label: labels.get(l.id)! }));
}
