-- Re-run the same-name rename, now treating non-breaking and repeated spaces as one space.
-- Same statement as DISAMBIGUATE_LOCATION_NAMES_SQL in src/server/services/location-names.ts.
WITH live AS (
  SELECT id, name, addr, btrim(regexp_replace(addr, '^\d+[0-9A-Za-z-]*\s+', '')) AS street
  FROM (
    -- Non-breaking and repeated spaces count as one space, so look-alike names match.
    SELECT id, btrim(regexp_replace(translate(name, chr(160), ' '), '\s+', ' ', 'g')) AS name,
           btrim(regexp_replace(translate("addressLine1", chr(160), ' '), '\s+', ' ', 'g')) AS addr
    FROM "ServiceLocation" WHERE "deletedAt" IS NULL
  ) raw
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
