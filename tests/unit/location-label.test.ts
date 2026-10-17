import { describe, expect, it } from "vitest";
import { locationLabels } from "@/lib/location-label";

const L = (id: string, name: string, addressLine1: string) => ({ id, name, addressLine1 });

describe("location dropdown labels", () => {
  it("adds the street, or building number + street when the street repeats", () => {
    const labels = locationLabels([
      L("a", "Now & Forever Gas Station", "13600 Beechnut St"),
      L("b", "Now & Forever Gas Station", "13905 Westheimer Rd"),
      L("c", "Now & Forever Gas Station ", "13450  Westheimer Rd"),
      L("d", "Now & Forever Gas Station — W Parker Rd", "251 W Parker Rd"), // already renamed
      L("e", "Pit Stop Express #31", "22323 SW Freeway"),
      L("f", "Now & Forever Gas Station", "4223-B S Main St"),
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      a: "Now & Forever Gas Station — Beechnut St",
      b: "Now & Forever Gas Station — 13905 Westheimer Rd",
      c: "Now & Forever Gas Station — 13450 Westheimer Rd",
      d: "Now & Forever Gas Station — W Parker Rd",
      e: "Pit Stop Express #31",
      f: "Now & Forever Gas Station — S Main St",
    });
  });
});
