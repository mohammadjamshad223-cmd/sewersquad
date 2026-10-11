"use client";

import { Upload } from "lucide-react";
import { ActionForm, ActionButton, Field, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { archiveDocumentAction, replaceDocumentAction, setDocumentVisibilityAction, uploadDocumentAction } from "@/app/admin/_actions/billing";

export function UploadDialog({ orgs }: { orgs: { id: string; name: string; locations: { id: string; name: string }[] }[] }) {
  return (
    <FormDialog trigger={<Button><Upload /> Upload</Button>} title="Upload document" description="PDF, images, DOCX/XLSX or CSV. Files are scanned by type and stored privately." size="lg">
      {(close) => (
        <ActionForm action={uploadDocumentAction} className="grid gap-4 sm:grid-cols-2" encType="multipart/form-data" onSuccess={close}>
          <Field label="File" name="file" required className="sm:col-span-2"><Input type="file" /></Field>
          <Field label="Title" name="title" required className="sm:col-span-2"><Input /></Field>
          <Field label="Type" name="type" required><Select>{[["CONTRACT", "Contract"], ["AGREEMENT", "Customer agreement"], ["PERMIT", "Permit"], ["INSPECTION", "Inspection document"], ["EQUIPMENT_PHOTO", "Equipment photo"], ["DISPOSAL_TICKET", "Disposal ticket"], ["MANIFEST_OFFICIAL", "Official manifest"], ["OTHER", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Visibility" name="visibility" required><Select defaultValue="INTERNAL"><option value="INTERNAL">Internal only</option><option value="CUSTOMER">Shared with customer</option></Select></Field>
          <Field label="Customer" name="organizationId"><Select><option value="">None (company document)</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
          <Field label="Location" name="locationId" hint="Optional — customer location users only see their locations' documents."><Select><option value="">Organization level</option>{orgs.flatMap((o) => o.locations.map((l) => <option key={l.id} value={l.id}>{o.name} — {l.name}</option>))}</Select></Field>
          <div className="sm:col-span-2"><SubmitButton>Upload</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DocActions({ id, visibility, canWrite, canDelete, replaceable }: { id: string; visibility: string; canWrite: boolean; canDelete: boolean; replaceable: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {canWrite && <ActionButton size="sm" variant="ghost" action={() => setDocumentVisibilityAction(id, visibility === "CUSTOMER" ? "INTERNAL" : "CUSTOMER")} successMessage="Visibility updated.">{visibility === "CUSTOMER" ? "Make internal" : "Share"}</ActionButton>}
      {canWrite && replaceable && (
        <FormDialog trigger={<Button size="sm" variant="ghost">New version</Button>} title="Upload new version" description="The previous version is kept in history.">
          {(close) => (
            <ActionForm action={replaceDocumentAction} className="space-y-3" encType="multipart/form-data" onSuccess={close}>
              <input type="hidden" name="documentId" value={id} />
              <Field label="File" name="file" required><Input type="file" /></Field>
              <Field label="Change note" name="note"><Input /></Field>
              <SubmitButton>Upload version</SubmitButton>
            </ActionForm>
          )}
        </FormDialog>
      )}
      {canDelete && replaceable && <ActionButton size="sm" variant="ghost" className="text-danger" confirm="Archive this document? It will be hidden but kept for the audit trail." action={() => archiveDocumentAction(id, "Archived from document library")} successMessage="Archived.">Archive</ActionButton>}
    </div>
  );
}
