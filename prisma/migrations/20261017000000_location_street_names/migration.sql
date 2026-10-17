-- Locations that share a name get their street added so they can be told apart in pickers and on
-- invoices; when two are on the same street, the full street address is used. Same statement as
-- DISAMBIGUATE_LOCATION_NAMES_SQL in src/server/services/location-names.ts.
WITH live AS (
  SELECT id, btrim(name) AS name, btrim("addressLine1") AS addr,
         btrim(regexp_replace(btrim("addressLine1"), '^\d+[0-9A-Za-z-]*\s+', '')) AS street
  FROM "ServiceLocation" WHERE "deletedAt" IS NULL
), based AS (
  SELECT id, name, addr, street,
         CASE
           WHEN street <> '' AND right(lower(name), length(street) + 3) = ' — ' || lower(street) THEN btrim(left(name, length(name) - length(street) - 3))
           WHEN addr <> '' AND right(lower(name), length(addr) + 3) = ' — ' || lower(addr) THEN btrim(left(name, length(name) - length(addr) - 3))
           ELSE name
         END AS base
  FROM live
), grp AS (
  SELECT *, count(*) OVER (PARTITION BY lower(base)) AS n, count(*) OVER (PARTITION BY lower(base), lower(street)) AS same_street
  FROM based
), wanted AS (
  SELECT id, name, base, CASE WHEN street = '' OR same_street > 1 THEN addr ELSE street END AS tag
  FROM grp WHERE n > 1
)
UPDATE "ServiceLocation" s
SET name = w.base || ' — ' || w.tag, "updatedAt" = now()
FROM wanted w
WHERE s.id = w.id AND w.tag <> '' AND position(lower(w.tag) IN lower(w.base)) = 0 AND w.name <> w.base || ' — ' || w.tag;
