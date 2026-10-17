import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff } from "./helpers";
import { createLocation, locationSchema } from "@/server/services/customers";
import { disambiguateLocationNames } from "@/server/services/location-names";

describe("locations that share a name get their street added", () => {
  let admin: Awaited<ReturnType<typeof staff>>;
  let orgId: string;
  const add = (name: string, addressLine1: string) => createLocation(admin, orgId, locationSchema.parse({ name, addressLine1, city: "Houston", state: "TX", postalCode: "77002" }));
  // Sorted in JS: database collation differs between machines.
  const names = async () => (await prisma.serviceLocation.findMany({ where: { organizationId: orgId } })).map((l) => l.name).sort((a, b) => a.localeCompare(b, "en"));

  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    admin = await staff("admin");
    orgId = (await prisma.organization.create({ data: { name: "Now & Forever", accountNumber: "SS-1" } })).id;
  });

  it("adds the street, falls back to the full street address when the street repeats, and leaves unique names alone", async () => {
    await add("Now & Forever Gas Station", "251 W Parker Rd");
    await add("Corner Store", "1 Elm St");
    expect(await names()).toEqual(["Corner Store", "Now & Forever Gas Station"]); // no duplicates yet
    await add("Now & Forever Gas Station", "13905 Westheimer Rd");
    await add("Now & Forever Gas Station", "13450 Westheimer Rd");
    await add("now & forever gas station ", "4223-B S Main St");
    expect(await names()).toEqual([
      "Corner Store",
      "Now & Forever Gas Station — 13450 Westheimer Rd",
      "Now & Forever Gas Station — 13905 Westheimer Rd",
      "now & forever gas station — S Main St",
      "Now & Forever Gas Station — W Parker Rd",
    ].sort((a, b) => a.localeCompare(b, "en")));
    expect(await disambiguateLocationNames(prisma)).toBe(0); // safe to run again
    // Look-alike names (non-breaking or double spaces) are treated as the same name.
    await prisma.serviceLocation.create({ data: { organizationId: orgId, code: "L-X", name: "Corner\u00a0 Store", addressLine1: "9 Oak Ave", city: "Houston", postalCode: "77002" } });
    await disambiguateLocationNames(prisma);
    expect((await names()).filter((n) => n.startsWith("Corner"))).toEqual(["Corner Store — Elm St", "Corner Store — Oak Ave"]);
  });
});

describe("the deploy migration", () => {
  it("runs the same statement as the app", async () => {
    const { readFileSync } = await import("node:fs");
    const { DISAMBIGUATE_LOCATION_NAMES_SQL } = await import("@/server/services/location-names");
    const file = readFileSync("prisma/migrations/20261018000000_location_street_names_again/migration.sql", "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(file.trim().replace(/;$/, "")).toBe(DISAMBIGUATE_LOCATION_NAMES_SQL.trim());
  });
});
