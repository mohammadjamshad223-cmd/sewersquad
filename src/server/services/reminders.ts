import "server-only";
import { prisma } from "../db";
import { addDays, dateFromKey, formatDateKey, formatWindow, todayKey } from "@/lib/dates";
import { companyTimeZone, getSetting } from "./settings";
import { customerRecipientsForLocation, notify } from "./notifications";

/** Service reminders at configured offsets (default 14 / 7 / 1 days). Deduplicated per job+offset. */
export async function sendServiceReminders() {
  const tz = await companyTimeZone();
  const { serviceReminderOffsetsDays } = await getSetting("scheduling");
  const today = todayKey(tz);
  let sent = 0;
  for (const offset of serviceReminderOffsetsDays) {
    const day = addDays(today, offset);
    const jobs = await prisma.job.findMany({
      where: { scheduledDate: dateFromKey(day), status: { in: ["SCHEDULED", "ASSIGNED", "ACCEPTED"] }, location: { status: "ACTIVE" } },
      include: { location: true },
    });
    for (const j of jobs) {
      const ids = await notify(prisma, {
        userIds: await customerRecipientsForLocation(prisma, j.organizationId, j.locationId),
        contacts: { organizationId: j.organizationId, locationId: j.locationId },
        type: "service.reminder",
        title: offset === 1 ? `Reminder: service tomorrow at ${j.location.name}` : `Upcoming service in ${offset} days — ${j.location.name}`,
        body: `${formatDateKey(day, "long")}, ${formatWindow(j.windowStart, j.windowEnd)}. ${j.location.accessInstructions ? "Please make sure access instructions are still accurate." : "Please make sure the equipment is accessible."}`,
        link: `/customer/services/${j.id}`,
        entityType: "Job",
        entityId: j.id,
        dedupeKey: `job:${j.id}:reminder:${offset}:${day}`,
      });
      sent += ids.length;
    }
  }
  return { sent };
}
