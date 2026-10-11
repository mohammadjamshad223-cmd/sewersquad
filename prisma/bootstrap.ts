/**
 * Production bootstrap — safe to run repeatedly, never touches business data.
 *
 *   npm run db:bootstrap -- owner@yourcompany.com "Owner Name"
 *
 * - Creates any missing permissions and system roles (existing role grants are left as configured).
 * - Creates the default manifest template if no template exists yet.
 * - Creates the first Super Admin as an INVITED user and prints a one-time invitation link
 *   (valid 7 days). The person sets their password and enrolls MFA on first sign-in.
 *
 * Company profile, pricing, disposal facilities and staff are configured in the admin portal.
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { ensureSystemData } from "../src/server/services/bootstrap";

const prisma = new PrismaClient();

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  const name = nameParts.join(" ").trim();

  const { superAdminRoleId, created } = await ensureSystemData(prisma);
  for (const c of created) console.log(`Created ${c}`);

  if (!email) {
    console.log("Roles and permissions are up to date. Pass an email and name to invite the first Super Admin.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new Error('Usage: npm run db:bootstrap -- owner@yourcompany.com "Owner Name"');
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser && existingUser.status !== "INVITED") throw new Error(`${email} already exists and is ${existingUser.status}. Use the admin portal to manage it.`);

  const user = existingUser ?? (await prisma.user.create({ data: { email, name, kind: "STAFF", status: "INVITED", roleId: superAdminRoleId } }));
  const raw = randomBytes(32).toString("base64url");
  await prisma.authToken.updateMany({ where: { userId: user.id, type: "INVITATION", usedAt: null }, data: { usedAt: new Date() } });
  await prisma.authToken.create({ data: { userId: user.id, email, type: "INVITATION", tokenHash: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  await prisma.auditLog.create({ data: { action: "user.bootstrap_invite", entityType: "User", entityId: user.id, after: { email, role: "super_admin" }, reason: "Bootstrap invitation" } });

  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`\nSuper Admin invitation for ${email} (expires in 7 days, single use):\n\n  ${base}/invite/accept?token=${encodeURIComponent(raw)}\n\nTreat this link like a password. It is not stored anywhere and will not be shown again.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
