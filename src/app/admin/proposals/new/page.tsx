import { requireStaffPage } from "@/server/authz/guards";
import { getSetting, companyTimeZone } from "@/server/services/settings";
import { customerPickerData } from "@/server/services/paperwork-data";
import { defaultProposalNote } from "@/server/services/proposals";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ProposalEditor } from "@/components/admin/proposal-editor";
import { todayKey } from "@/lib/dates";

export const metadata = { title: "New proposal" };

export default async function NewProposal({ searchParams }: { searchParams: Promise<{ kind?: string; org?: string; location?: string }> }) {
  await requireStaffPage("invoices.write");
  const sp = await searchParams;
  const [orgs, billing, tz] = await Promise.all([customerPickerData(), getSetting("billing"), companyTimeZone()]);
  const kind = sp.kind === "QUOTE" ? "QUOTE" : "PROPOSAL";
  const org = orgs.find((o) => o.id === sp.org);
  const loc = org?.locations.find((l) => l.id === sp.location) ?? (org?.locations.length === 1 ? org.locations[0] : undefined);
  const word = kind === "QUOTE" ? "quote" : "proposal";
  return (
    <div>
      <PageHeader title={`New ${word}`} breadcrumbs={[{ label: "Proposals & Quotes", href: "/admin/proposals" }, { label: "New" }]} />
      <Card><CardBody>
        <ProposalEditor
          manifestFeeBps={billing.manifestFeeBps}
          orgs={orgs}
          init={{
            kind,
            organizationId: org?.id ?? "",
            locationId: loc?.id ?? "",
            preparedFor: loc?.name ?? org?.name ?? "",
            addressLine1: loc?.addressLine1 ?? "",
            city: loc?.city ?? "Houston",
            state: loc?.state ?? "TX",
            postalCode: loc?.postalCode ?? "",
            date: todayKey(tz),
            scopeTitle: "Grease Trap Pumping & Disposal",
            scopeSubtitle: "",
            intro: `Sewer Squad Services LLC is pleased to ${kind === "QUOTE" ? "quote" : "propose"} the following scope of work for the location above.`,
            note: defaultProposalNote(billing.manifestFeeBps).replace("This proposal", `This ${word}`),
            priceNote: "",
            sections: [{ title: "", subtotalLabel: "", lines: [{ kind: "PER_GALLON", description: "Grease trap pumping & disposal", quantity: "", unitPrice: "" }, ...(loc && loc.manifestFee !== "NONE" && loc.manifestFee !== "WAIVED" ? [{ kind: "MANIFEST_FEE", description: loc.manifestFee === "CITY_OF_HOUSTON" ? "City of Houston manifest fee" : "Manifest fee", quantity: "1", unitPrice: "0" }] : [{ kind: "MANIFEST_FEE", description: "Manifest fee", quantity: "1", unitPrice: "0" }])] }],
          }}
        />
      </CardBody></Card>
    </div>
  );
}
