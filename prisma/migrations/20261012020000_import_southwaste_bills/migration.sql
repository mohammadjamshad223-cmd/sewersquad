-- Import of Southwaste Disposal invoices (July–August 2026). Matches the vendor's open-receivables
-- statement: 16 invoices, $3,562.35. Eight were transcribed from the invoice PDFs (gallons, rate,
-- manifests). The other eight come from the statement only, so they carry the amount and invoice
-- date, with no gallons; add details from their PDFs when available. Idempotent like the previous import.

DO $$
DECLARE
  sw UUID;
  bill UUID;
BEGIN
  SELECT id INTO sw FROM "DisposalFacility" WHERE name ILIKE '%southwaste%' ORDER BY "createdAt" LIMIT 1;
  IF sw IS NULL THEN
    sw := gen_random_uuid();
    INSERT INTO "DisposalFacility" (id, name, "addressLine1", city, state, "postalCode", phone, "acceptedWasteTypes", "ratePerGallonCents", status, notes, "vendorAccountNumber", "remitTo", "billingPhone", "createdAt", "updatedAt")
    VALUES (sw, 'Southwaste Disposal', '16290 Katy Frwy, Suite 250', 'Houston', 'TX', '77094', '(210) 621-2411',
      ARRAY['Grease trap waste'], 17, 'ACTIVE',
      'Grease disposal $0.17/gal. Address is the Houston office printed on invoices; confirm the plant address. Terms: COD on early invoices, Net 15 from 7/21/2026. Service requests (210) 621-2411; invoice questions (713) 413-9400. Checks payable to Southwaste Disposal; reference the invoice #.',
      '02-0034975', 'Southwaste Disposal, LLC., P.O. Box 53988, Lafayette, LA 70505-3988', '(713) 413-9400', now(), now());
  ELSE
    UPDATE "DisposalFacility" SET
      "vendorAccountNumber" = COALESCE("vendorAccountNumber", '02-0034975'),
      "remitTo" = COALESCE("remitTo", 'Southwaste Disposal, LLC., P.O. Box 53988, Lafayette, LA 70505-3988'),
      "billingPhone" = COALESCE("billingPhone", '(713) 413-9400'),
      "updatedAt" = now()
    WHERE id = sw;
  END IF;


  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1244338-IN', '2026-07-15', '2026-07-15', '2026-07-09', '0999558', 'OPEN', 20400, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1200, 17, 20400, ARRAY['194413'], '2026-07-09', 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1244965-IN', '2026-07-17', '2026-07-17', '2026-07-10', '0999831', 'OPEN', 33150, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1200, 17, 20400, ARRAY['194415'], '2026-07-10', 0),
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 750, 17, 12750, ARRAY['194411'], '2026-07-10', 1);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1245429-IN', '2026-07-21', '2026-08-05', '2026-07-16', '1001379', 'OPEN', 34000, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 2000, 17, 34000, ARRAY['194418'], '2026-07-16', 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1246968-IN', '2026-07-27', '2026-08-11', '2026-07-21', '1002846', 'OPEN', 17510, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 30, 17, 510, ARRAY['194420'], '2026-07-21', 0),
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1000, 17, 17000, ARRAY['194419'], '2026-07-21', 1);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1248444-IN', '2026-07-30', '2026-08-14', '2026-07-24', '1021005', 'OPEN', 13175, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 25, 17, 425, ARRAY['194422'], '2026-07-24', 0),
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 750, 17, 12750, ARRAY['194421'], '2026-07-24', 1);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1248468-IN', '2026-07-30', '2026-08-14', '2026-07-27', '1021808', 'OPEN', 17000, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1000, 17, 17000, ARRAY['194426'], '2026-07-27', 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1250594-IN', '2026-07-31', '2026-08-15', '2026-07-29', '1022857', 'OPEN', 20400, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1200, 17, 20400, ARRAY['194423'], '2026-07-29', 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1250656-IN', '2026-07-31', '2026-08-15', '2026-07-30', NULL, 'OPEN', 12750, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 750, 17, 12750, ARRAY['194428'], '2026-07-30', 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1252128-IN', '2026-08-10', 'OPEN', 29750, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 29750, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1252150-IN', '2026-08-10', 'OPEN', 22100, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 22100, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1255475-IN', '2026-08-17', 'OPEN', 14025, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 14025, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1255491-IN', '2026-08-17', 'OPEN', 19550, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 19550, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1255569-IN', '2026-08-17', 'OPEN', 34000, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 34000, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1261253-IN', '2026-08-31', 'OPEN', 34000, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 34000, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1261272-IN', '2026-08-31', 'OPEN', 20400, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 20400, ARRAY[]::TEXT[], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, sw, '1261435-IN', '2026-08-31', 'OPEN', 14025, 'From the open-receivables statement; invoice PDF not yet on file (no gallons or manifests).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal (per statement)', 14025, ARRAY[]::TEXT[], 0);
  END IF;
END $$;
