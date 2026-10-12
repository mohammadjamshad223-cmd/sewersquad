import { STANDARD_WARRANTY } from "@/server/services/service-reports";

/** Quick-insert sections, worded like the owner's reports. */
export const REPORT_PRESETS = [
  { title: "Service Performed", body: "Sewer Squad Services LLC was dispatched to the above location to " },
  { title: "Service Overview", body: "Sewer Squad Services LLC inspected " },
  { title: "Findings", body: "" },
  { title: "Recommended Service", body: "We recommend " },
  { title: "Recommended Corrective Action", body: "• " },
  { title: "Pricing", body: "• " },
  { title: "Our Warranty", body: STANDARD_WARRANTY },
];
