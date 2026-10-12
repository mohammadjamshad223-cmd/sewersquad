import "server-only";
import { prisma } from "../db";

/** Customers with their locations, for the proposal and report pickers. */
export function customerPickerData() {
  return prisma.organization.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, locations: { where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, addressLine1: true, city: true, state: true, postalCode: true, manifestFee: true } } },
  });
}
