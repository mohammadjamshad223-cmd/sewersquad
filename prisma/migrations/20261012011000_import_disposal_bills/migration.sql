-- Sewer Squad's disposal vendor invoices (June–September 2026), from the owner's spreadsheet
-- "Disposal Invoices LES Downstream Hurst" (compiled 10/11/2026 from vendor emails), with gallons,
-- rates and manifest numbers from the vendor invoice PDFs where those were provided.
-- 39 invoices, $11,024.93, all open. Idempotent: facilities matched by name, bills unique per
-- (facility, vendor invoice #). Amounts are integer cents; per-gallon rates are cents (18.5 = $0.185).

DO $$
DECLARE
  les UUID;
  dse UUID;
  hst UUID;
  bill UUID;
BEGIN

  SELECT id INTO les FROM "DisposalFacility" WHERE name ILIKE '%liquid environmental%' ORDER BY "createdAt" LIMIT 1;
  IF les IS NULL THEN
    les := gen_random_uuid();
    INSERT INTO "DisposalFacility" (id, name, "addressLine1", city, state, "postalCode", phone, "acceptedWasteTypes", "ratePerGallonCents", status, notes, "vendorAccountNumber", "remitTo", "billingPhone", "createdAt", "updatedAt")
    VALUES (les, 'Liquid Environmental Solutions (LES)', '250 Gellhorn Dr', 'Houston', 'TX', '77013', '866-694-7327', ARRAY['Grease trap waste', 'Grit trap waste', 'Lint trap waste'], 18.5, 'ACTIVE', 'Grease $0.185/gal; grit and lint trap $0.29/gal. Account status: past due per the 9/21/2026 collections notice. Customer service 1-866-MY-GREASE, customer.service@liquidenviro.com.', '528399', 'Accounts Receivable, Liquid Environmental Solutions, P.O. Box 733372, Dallas, TX 75373-3372', '866-694-7327 (option 3)', now(), now());
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
    VALUES (dse, 'Downstream (Southwaste)', '3737 Walnut Bend Ln', 'Houston', 'TX', '77042', '(713) 490-7940', ARRAY['Grease trap waste'], 15, 'ACTIVE', 'Grease $0.15/gal. Pressure-wash disposal: $175 minimum for 300 gal or less, $0.25/gal above 300 gal. Account status: past due; account suspended — Southwaste will clear it after Hurst is paid. The account reopens for disposal once its balance is $0.', '40-0009661', 'Southwaste Disposal, LLC., P.O. Box 53988, Lafayette, LA 70505-3988', '(713) 413-9400', now(), now());
  ELSE
    UPDATE "DisposalFacility" SET
      "vendorAccountNumber" = COALESCE("vendorAccountNumber", '40-0009661'),
      "remitTo" = COALESCE("remitTo", 'Southwaste Disposal, LLC., P.O. Box 53988, Lafayette, LA 70505-3988'),
      "billingPhone" = COALESCE("billingPhone", '(713) 413-9400'),
      "updatedAt" = now()
    WHERE id = dse;
  END IF;

  SELECT id INTO hst FROM "DisposalFacility" WHERE name ILIKE '%hurst%' ORDER BY "createdAt" LIMIT 1;
  IF hst IS NULL THEN
    hst := gen_random_uuid();
    INSERT INTO "DisposalFacility" (id, name, "addressLine1", city, state, "postalCode", phone, "acceptedWasteTypes", "ratePerGallonCents", status, notes, "vendorAccountNumber", "remitTo", "billingPhone", "createdAt", "updatedAt")
    VALUES (hst, 'Hurst (Southwaste)', '16290 Katy Frwy, Suite 250', 'Houston', 'TX', '77094', '(210) 621-2411', ARRAY['Grease trap waste'], 17, 'ACTIVE', 'Grease $0.17/gal. Address is the Houston office printed on Southwaste invoices; confirm the plant address. Account status: on credit hold. Repayment plan proposed 10/7/2026 (clear Hurst first, then Downstream; payments due Friday of the listed week): 10/9 $1,050.60 · 10/23 $930.75 · 11/6 $896.75 · 11/20 $684.25. The account reopens for disposal once its balance is $0. Checks payable to Southwaste Disposal; reference the invoice #.', '02-34975', 'Southwaste Disposal, LLC., P.O. Box 53988, Lafayette, LA 70505-3988', '(713) 413-9400', now(), now());
  ELSE
    UPDATE "DisposalFacility" SET
      "vendorAccountNumber" = COALESCE("vendorAccountNumber", '02-34975'),
      "remitTo" = COALESCE("remitTo", 'Southwaste Disposal, LLC., P.O. Box 53988, Lafayette, LA 70505-3988'),
      "billingPhone" = COALESCE("billingPhone", '(713) 413-9400'),
      "updatedAt" = now()
    WHERE id = hst;
  END IF;

  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3293936', '2026-06-30', NULL, '2026-06-13', '260618-3321', NULL, 'OPEN', 37000, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 2000, 18.5, 37000, ARRAY['194401', '194402']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3303588', '2026-07-05', NULL, '2026-06-30', '260701-1573', NULL, 'OPEN', 23200, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Grit trap disposal', 'Grit trap waste', 800, 29, 23200, ARRAY['194406']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3333212', '2026-07-25', NULL, '2026-07-11', '260713-0922', NULL, 'OPEN', 18500, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 1000, 18.5, 18500, ARRAY['194417']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3333214', '2026-07-25', NULL, '2026-07-11', '260713-0923', NULL, 'OPEN', 18500, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 1000, 18.5, 18500, ARRAY['194416']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3369602', '2026-08-29', NULL, '2026-08-06', '260807-1237', NULL, 'OPEN', 58000, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Lint trap disposal', 'Lint trap waste', 2000, 29, 58000, ARRAY['194433']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3369711', '2026-08-29', NULL, '2026-08-08', '260810-0802', NULL, 'OPEN', 32375, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Grease trap disposal', 'Grease trap waste', 1750, 18.5, 32375, ARRAY['194437', '194438']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3225916', '2026-09-08', NULL, NULL, NULL, NULL, 'OPEN', 37000, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 37000, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3225940', '2026-09-08', NULL, NULL, NULL, NULL, 'OPEN', 58145, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 58145, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3368631', '2026-09-08', NULL, NULL, NULL, NULL, 'OPEN', 21750, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 21750, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3163571', '2026-09-14', NULL, NULL, NULL, NULL, 'OPEN', 37000, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 37000, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3164351', '2026-09-14', NULL, NULL, NULL, NULL, 'OPEN', 44863, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 44863, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3164356', '2026-09-14', NULL, NULL, NULL, NULL, 'OPEN', 33300, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 33300, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, les, 'SVC3164823', '2026-09-14', NULL, NULL, NULL, NULL, 'OPEN', 16500, 'From your disposal invoice spreadsheet; line details not on file. Source: LES Collections ''Account Status'' email, 9/21/2026 (overdue total $4,361.33).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 16500, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0196809', '2026-07-13', '2026-08-12', '2026-07-02', '0213803', NULL, 'OPEN', 30000, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194408']::TEXT[], '2026-07-02', 0),
      (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194407']::TEXT[], '2026-07-02', 1);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0196810', '2026-07-13', '2026-08-12', '2026-07-02', '0214000', NULL, 'OPEN', 22500, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1500, 15, 22500, ARRAY['194409']::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0196920', '2026-07-14', '2026-08-13', '2026-07-08', '0214350', NULL, 'OPEN', 30000, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194412']::TEXT[], '2026-07-08', 0),
      (gen_random_uuid(), bill, 'Disposal — grease', 'Grease trap waste', 1000, 15, 15000, ARRAY['194410']::TEXT[], '2026-07-08', 1);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0201317', '2026-08-17', '2026-09-16', NULL, NULL, NULL, 'OPEN', 30000, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 30000, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0201295', '2026-08-17', '2026-09-16', NULL, NULL, NULL, 'OPEN', 52500, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 52500, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0202123', '2026-08-21', '2026-09-20', NULL, NULL, NULL, 'OPEN', 41250, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 41250, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0202067', '2026-08-21', '2026-09-20', NULL, NULL, NULL, 'OPEN', 16125, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 16125, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0202668', '2026-08-27', '2026-09-26', NULL, NULL, NULL, 'OPEN', 15000, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 15000, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0202685', '2026-08-27', '2026-09-26', NULL, NULL, NULL, 'OPEN', 20250, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 20250, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, dse, '40-0203559', '2026-08-31', '2026-09-30', NULL, NULL, NULL, 'OPEN', 52500, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''Account Past Due'' statement, 10/5/2026 (total $3,101.25).', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 52500, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1244338-IN', '2026-07-15', '2026-07-15', '2026-07-09', '0999558', '2026-10-09', 'OPEN', 20400, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1200, 17, 20400, ARRAY['194413']::TEXT[], '2026-07-09', 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1244965-IN', '2026-07-17', '2026-07-17', '2026-07-10', '0999831', '2026-10-09', 'OPEN', 33150, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1200, 17, 20400, ARRAY['194415']::TEXT[], '2026-07-10', 0),
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 750, 17, 12750, ARRAY['194411']::TEXT[], '2026-07-10', 1);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1245429-IN', '2026-07-21', '2026-08-05', '2026-07-16', '1001379', '2026-10-09', 'OPEN', 34000, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 2000, 17, 34000, ARRAY['194418']::TEXT[], '2026-07-16', 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1246968-IN', '2026-07-27', '2026-08-11', '2026-07-21', '1002846', '2026-10-09', 'OPEN', 17510, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 30, 17, 510, ARRAY['194420']::TEXT[], '2026-07-21', 0),
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1000, 17, 17000, ARRAY['194419']::TEXT[], '2026-07-21', 1);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1248444-IN', '2026-07-30', '2026-08-14', '2026-07-24', '1021005', '2026-10-23', 'OPEN', 13175, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 25, 17, 425, ARRAY['194422']::TEXT[], '2026-07-24', 0),
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 750, 17, 12750, ARRAY['194421']::TEXT[], '2026-07-24', 1);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1248468-IN', '2026-07-30', '2026-08-14', '2026-07-27', '1021808', '2026-10-23', 'OPEN', 17000, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1000, 17, 17000, ARRAY['194426']::TEXT[], '2026-07-27', 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1250594-IN', '2026-07-31', '2026-08-15', '2026-07-29', '1022857', '2026-10-23', 'OPEN', 20400, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 1200, 17, 20400, ARRAY['194423']::TEXT[], '2026-07-29', 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1250656-IN', '2026-07-31', '2026-08-15', '2026-07-30', NULL, '2026-10-23', 'OPEN', 12750, 'From your disposal invoice spreadsheet and the vendor''s invoice PDF. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal grease', 'Grease trap waste', 750, 17, 12750, ARRAY['194428']::TEXT[], '2026-07-30', 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1252128-IN', '2026-08-10', '2026-08-25', NULL, NULL, '2026-10-23', 'OPEN', 29750, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 29750, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1252150-IN', '2026-08-10', '2026-08-25', NULL, NULL, '2026-11-06', 'OPEN', 22100, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 22100, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1255475-IN', '2026-08-17', '2026-09-01', NULL, NULL, '2026-11-06', 'OPEN', 14025, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 14025, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1255491-IN', '2026-08-17', '2026-09-01', NULL, NULL, '2026-11-06', 'OPEN', 19550, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 19550, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1255569-IN', '2026-08-17', '2026-09-01', NULL, NULL, '2026-11-06', 'OPEN', 34000, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 34000, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1261253-IN', '2026-08-31', '2026-09-15', NULL, NULL, '2026-11-20', 'OPEN', 34000, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 34000, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1261272-IN', '2026-08-31', '2026-09-15', NULL, NULL, '2026-11-20', 'OPEN', 20400, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 20400, ARRAY[]::TEXT[], NULL, 0);
  END IF;
  bill := gen_random_uuid();
  INSERT INTO "DisposalBill" (id, "facilityId", "vendorInvoiceNumber", "invoiceDate", "dueDate", "serviceDate", "referenceNumber", "scheduledPayDate", status, "totalCents", notes, "createdAt", "updatedAt")
  VALUES (bill, hst, '1261435-IN', '2026-08-31', '2026-09-15', NULL, NULL, '2026-11-20', 'OPEN', 14025, 'From your disposal invoice spreadsheet; line details not on file. Source: Southwaste ''**REPAYMENT PLAN** HURST'' email, 10/7/2026.', now(), now())
  ON CONFLICT ("facilityId", "vendorInvoiceNumber") DO NOTHING;
  IF FOUND THEN
    INSERT INTO "DisposalBillLine" (id, "billId", description, "wasteType", gallons, "ratePerGallonCents", "amountCents", "manifestNumbers", "manifestDate", "sortOrder") VALUES
      (gen_random_uuid(), bill, 'Disposal (per vendor statement)', NULL, NULL, NULL, 14025, ARRAY[]::TEXT[], NULL, 0);
  END IF;
END $$;
