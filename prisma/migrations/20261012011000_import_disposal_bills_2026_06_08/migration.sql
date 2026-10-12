-- One-time import of Sewer Squad's disposal vendor invoices (June–August 2026), transcribed from
-- the vendors' PDF invoices. Idempotent: facilities are matched by name and only created when
-- missing; bills are unique per (facility, vendor invoice number) and skipped if present.
-- Amounts are integer cents; per-gallon rates are cents (e.g. 18.5 = $0.185/gal).
-- All bills are imported as OPEN; mark paid ones in Admin → Disposal → Bills.

DO $$
DECLARE
  les UUID;
  dse UUID;
  bill UUID;
BEGIN
  -- ── Facilities ────────────────────────────────────────────────────────────
  SELECT id INTO les FROM "DisposalFacility" WHERE name ILIKE '%liquid environmental%' ORDER BY "createdAt" LIMIT 1;
  IF les IS NULL THEN
    les := gen_random_uuid();
    INSERT INTO "DisposalFacility" (id, name, "addressLine1", city, state, "postalCode", phone, "acceptedWasteTypes", "ratePerGallonCents", status, notes, "vendorAccountNumber", "remitTo", "billingPhone", "createdAt", "updatedAt")
    VALUES (les, 'Liquid Environmental Solutions', 'Disposal site address needed', 'Houston', 'TX', '00000', '866-694-7327',
      ARRAY['Grease trap waste', 'Grit trap waste', 'Lint trap waste'], 18.5, 'ACTIVE',
      'Invoices show only the payment P.O. box, not the plant address — edit this facility and enter the disposal site address. Rates on invoices: grease trap $0.185/gal; grit and lint trap $0.29/gal. Payment terms: standing order. Customer service 1-866-MY-GREASE, customer.service@liquidenviro.com.',
      '528399', 'Accounts Receivable, Liquid Environmental Solutions, P.O. Box 733372, Dallas, TX 75373-3372', '866-694-7327 (option 3)', now(), now());
  ELSE
    UPDATE "DisposalFacility" SET
      "vendorAccountNumber" = COALESCE("vendorAccountNumber", '528399'),
      "remitTo" = COALESCE("remitTo", 'Accounts Receivable, Liquid Environmental Solutions, P.O. Box 733372, Dallas, TX 75373-3372'),
      "billingPhone" = COALESCE("billingPhone", '866-694-7327 (option 3)'),
      "updatedAt" = now()
    WHERE id = les;
  END IF;

  SELECT id INTO dse FROM "DisposalFacility" WHERE name ILIKE '%downstream%' ORDER BY "createdAt" LIMIT 1;
  IF dse IS NULL THEN
    dse := gen_random_uuid();
    INSERT INTO "DisposalFacility" (id, name, "addressLine1", city, state, "postalCode", phone, "acceptedWasteTypes", "ratePerGallonCents", status, notes, "vendorAccountNumber", "remitTo", "billingPhone", "createdAt", "updatedAt")
    VALUES (dse, 'DownStream Environmental', '3737 Walnut Bend Ln', 'Houston', 'TX', '77042', '(713) 490-7940',
      ARRAY['Grease trap waste'], 15, 'ACTIVE',
      'Grease disposal $0.15/gal on invoices. Pressure-wash disposal: $175 minimum for 300 gal or less, $0.25/gal above 300 gal (per invoice notice). Terms: COD. Service requests (713) 490-7940.',
      '40-0009661', 'DownStream Environmental, P.O. Box 53988, Lafayette, LA 70505-3988', '(713) 413-9400', now(), now());
  ELSE
    UPDATE "DisposalFacility" SET
      "vendorAccountNumber" = COALESCE("vendorAccountNumber", '40-0009661'),
      "remitTo" = COALESCE("remitTo", 'DownStream Environmental, P.O. Box 53988, Lafayette, LA 70505-3988'),
      "billingPhone" = COALESCE("billingPhone", '(713) 413-9400'),
      "updatedAt" = now()
    WHERE id = dse;
  END IF;

  -- ── Liquid Environmental Solutions (customer 528399) ──────────────────────
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3293936', '2026-06-30', '2026-06-13', '260618-3321', 'OPEN', 37000, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 2000, 18.5, 37000, ARRAY['194401', '194402'], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3303588', '2026-06-30', '2026-06-30', '260701-1573', 'OPEN', 23200, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Grit trap disposal', 'Grit trap waste', 800, 29, 23200, ARRAY['194406'], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3333212', '2026-07-26', '2026-07-11', '260713-0922', 'OPEN', 18500, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 1000, 18.5, 18500, ARRAY['194417'], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3333214', '2026-07-26', '2026-07-11', '260713-0923', 'OPEN', 18500, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 1000, 18.5, 18500, ARRAY['194416'], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3369602', '2026-08-14', '2026-08-06', '260807-1237', 'OPEN', 58000, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Lint trap disposal', 'Lint trap waste', 2000, 29, 58000, ARRAY['194433'], 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3369711', '2026-08-14', '2026-08-08', '260810-0802', 'OPEN', 32375, 'Imported from vendor invoice PDF.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 1750, 18.5, 32375, ARRAY['194437', '194438'], 0);
  END IF;

  -- ── DownStream Environmental (customer 40-0009661, COD) ───────────────────
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '0196809-IN', '2026-07-13', '2026-07-13', '2026-07-02', '0213803', 'OPEN', 30000, 'Imported from vendor invoice PDF. Terms COD — mark paid if already paid.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194408'], '2026-07-02', 0),
           (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194407'], '2026-07-02', 1);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '0196810-IN', '2026-07-13', '2026-07-13', '2026-07-02', '0214000', 'OPEN', 22500, 'Imported from vendor invoice PDF. Terms COD — mark paid if already paid.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1500, 15, 22500, ARRAY['194409'], '2026-07-02', 0);
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '0196920-IN', '2026-07-14', '2026-07-14', '2026-07-08', '0214350', 'OPEN', 30000, 'Imported from vendor invoice PDF. Terms COD — mark paid if already paid.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder")
    VALUES (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194412'], '2026-07-08', 0),
           (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194410'], '2026-07-08', 1);
  END IF;
END $$;
