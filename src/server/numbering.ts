import "server-only";
import type { Db } from "./db";
import { getSetting } from "./services/settings";

/**
 * Human-readable, unique, gap-tolerant reference numbers backed by an atomic Postgres counter.
 * Safe under concurrency: INSERT ... ON CONFLICT DO UPDATE is a single atomic statement.
 */
export async function nextSequence(db: Db, key: string, start = 1): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "NumberSequence" ("key", "value") VALUES (${key}, ${start})
    ON CONFLICT ("key") DO UPDATE SET "value" = "NumberSequence"."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}

const year = () => new Date().getUTCFullYear();
const pad = (n: number, w: number) => String(n).padStart(w, "0");

export const numbers = {
  account: async (db: Db) => `SS-${await nextSequence(db, "account", 10001)}`,
  location: async (db: Db) => `LOC-${await nextSequence(db, "location", 10001)}`,
  asset: async (db: Db) => `AS-${pad(await nextSequence(db, "asset"), 6)}`,
  plan: async (db: Db) => `SP-${pad(await nextSequence(db, "plan"), 5)}`,
  job: async (db: Db) => `J-${year()}-${pad(await nextSequence(db, `job-${year()}`), 6)}`,
  manifest: async (db: Db) => {
    // Continue the owner's ticket numbers when a start number is set in Settings → Company.
    const start = (await getSetting("hauler", db)).manifestStartNumber;
    if (start > 0) {
      const rows = await db.$queryRaw<{ value: number }[]>`
        INSERT INTO "NumberSequence" ("key", "value") VALUES ('manifest-ticket', ${start})
        ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("NumberSequence"."value" + 1, ${start})
        RETURNING "value"`;
      return String(rows[0]!.value);
    }
    return `MF-${year()}-${pad(await nextSequence(db, `manifest-${year()}`), 6)}`;
  },
  // Continues the owner's paper numbering (001–072 were issued before the portal).
  invoice: async (db: Db) => pad(await nextSequence(db, "invoice", 73), 3),
  proposal: async (db: Db) => `P-${pad(await nextSequence(db, "proposal", 70), 3)}`,
  quote: async (db: Db) => `Q-${pad(await nextSequence(db, "quote", 61), 3)}`,
  report: async (db: Db) => `R-${pad(await nextSequence(db, "report", 1), 3)}`,
  payment: async (db: Db) => `PAY-${year()}-${pad(await nextSequence(db, `payment-${year()}`), 6)}`,
  emergency: async (db: Db) => `ER-${year()}-${pad(await nextSequence(db, `emergency-${year()}`), 5)}`,
  ticket: async (db: Db) => `T-${pad(await nextSequence(db, "ticket", 1001), 5)}`,
  disposal: async (db: Db) => `DE-${year()}-${pad(await nextSequence(db, `disposal-${year()}`), 5)}`,
  issue: async (db: Db) => `IR-${pad(await nextSequence(db, "issue", 1), 5)}`,
  lead: async (db: Db) => `L-${pad(await nextSequence(db, "lead", 1001), 5)}`,
  employee: async (db: Db) => `D-${pad(await nextSequence(db, "employee", 101), 4)}`,
};
